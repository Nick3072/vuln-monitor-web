import { Hono } from 'hono'
import type {
  Bindings,
  BulkImportResult,
  BulkImportRowError,
  BulkSource,
  Solution,
  SolutionInput,
} from '../types'
import { validateSolutionInput } from './solutions'
import { parseCsv, CsvParseError, extractCategoryAttributes } from '../lib/csv'
import { generateAliases } from '../lib/normalize'
import { suggestCpe } from '../lib/cpe'
import { upsertSolutionEmbedding } from '../lib/embeddings'
import { triggerRematch } from '../lib/rematch'
import { writeAudit } from '../lib/audit'
import {
  isEquipmentCsvHeader,
  csvRowToEquipmentRaw,
  validateEquipmentInput,
  mapEquipmentToSolutions,
} from '../lib/asset-mapping'
import { canWriteGroup, resolveWriteGroup } from '../middleware/permissions'
import { getAuthContext } from '../middleware/auth'
import { resolveOrCreateAsset, deriveAssetName, applyDerivedImpactSystem } from '../lib/assets'

const app = new Hono<{ Bindings: Bindings }>()

const MAX_INPUT_ROWS = 500

type BulkKind = 'legacy' | 'equipment'

/**
 * POST /api/solutions/bulk
 *
 * 두 가지 입력 모드(자동 감지):
 *   - "legacy"     : 한 row = 한 솔루션 (vendor, product, category, current_version)
 *   - "equipment"  : 한 row = 한 장비 (vendor, model, hostname, os_version + 선택 컴포넌트)
 *                     백엔드가 OS/HW/DB/Crypto/WEB/WAS 컴포넌트로 분해해 N개 솔루션 INSERT
 *
 * 감지 규칙:
 *   - CSV: 헤더에 `model` 컬럼 존재 (그리고 `product` 없음) → equipment
 *   - JSON: 각 객체에 `model` 키 존재 → equipment
 *
 * 전송 모드:
 *   1) multipart/form-data 의 `file` 필드 (CSV)
 *   2) application/json 배열
 */
app.post('/', async (c) => {
  const contentType = c.req.header('content-type') ?? ''
  let source: BulkSource = 'json'
  let kind: BulkKind = 'legacy'
  // candidates: equipment 모드면 한 raw 가 SolutionInput[] 으로 미리 분해되어 들어옴
  let candidates: Array<{ row: number; raws: Array<{ raw: unknown; tag: string }> }> = []

  try {
    if (contentType.includes('multipart/form-data')) {
      source = 'csv'
      const form = await c.req.formData().catch(() => null)
      if (!form) {
        return c.json({ success: false, error: 'Failed to read multipart body' }, 400)
      }
      const file = form.get('file')
      if (file === null || typeof file === 'string') {
        return c.json({ success: false, error: 'Missing `file` field (CSV)' }, 400)
      }
      const text = await (file as { text(): Promise<string> }).text()
      const { headers, rows } = parseCsv(text)

      if (isEquipmentCsvHeader(headers)) {
        kind = 'equipment'
        candidates = rows.map((row, idx) => ({
          row: idx + 2, // header is row 1
          raws: expandEquipmentToSolutionRaws(csvRowToEquipmentRaw(row)),
        }))
      } else {
        kind = 'legacy'
        candidates = rows.map((row, idx) => ({
          row: idx + 2,
          raws: [{ raw: csvRowToInput(row), tag: row.product ?? '' }],
        }))
      }
    } else if (contentType.includes('application/json')) {
      source = 'json'
      const body = await c.req.json().catch(() => null)
      if (!Array.isArray(body)) {
        return c.json({ success: false, error: 'JSON body must be an array' }, 400)
      }
      // 첫 객체에 `model` 키가 있으면 equipment 로 인식
      const firstObj =
        body.length > 0 && typeof body[0] === 'object' && body[0] !== null
          ? (body[0] as Record<string, unknown>)
          : null
      const isEquipmentJson = firstObj !== null && typeof firstObj.model === 'string'
      kind = isEquipmentJson ? 'equipment' : 'legacy'
      candidates = body.map((raw, idx) => ({
        row: idx + 1,
        raws:
          kind === 'equipment'
            ? expandEquipmentToSolutionRaws(raw as Record<string, unknown>)
            : [{ raw, tag: typeof (raw as Record<string, unknown>)?.product === 'string' ? String((raw as Record<string, unknown>).product) : '' }],
      }))
    } else {
      return c.json(
        {
          success: false,
          error:
            'Content-Type must be multipart/form-data (with `file` field) or application/json',
        },
        400,
      )
    }
  } catch (err) {
    const msg =
      err instanceof CsvParseError
        ? `CSV parse error: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Failed to read request body'
    return c.json({ success: false, error: msg }, 400)
  }

  if (candidates.length === 0) {
    return c.json({ success: false, error: 'No rows to import' }, 400)
  }
  if (candidates.length > MAX_INPUT_ROWS) {
    return c.json(
      {
        success: false,
        error: `Too many rows (${candidates.length} > ${MAX_INPUT_ROWS}); split your file`,
      },
      400,
    )
  }

  const db = c.env.DB
  const errors: BulkImportRowError[] = []
  const insertedIds: number[] = []
  let componentsExpanded = 0

  for (const { row, raws } of candidates) {
    componentsExpanded += raws.length

    // equipment 모드에서 한 장비 라도 OS 필수가 빠지면 expandEquipmentToSolutionRaws 가
    // synthesized 에러 raw 1건만 넣음 — 그 raw 의 validateSolutionInput 이 실패 메시지를 그대로 반환.

    // v3.1: equipment 모드 — 같은 장비의 컴포넌트들은 하나의 asset 을 공유.
    // 미리 유효한 컴포넌트 목록을 검증한 뒤 asset 을 resolve/create 한다.
    let candidateAssetId: number | null = null

    if (kind === 'equipment') {
      // 모든 raws 를 검증
      const validatedComponents: { input: SolutionInput; raw: unknown; tag: string }[] = []
      let hasError = false
      for (const { raw, tag } of raws) {
        const validated = validateSolutionInput(raw)
        if (!validated.ok) {
          errors.push({
            row,
            vendor: extractField(raw, 'vendor'),
            product: extractField(raw, 'product') ?? tag,
            error: validated.error,
          })
          hasError = true
          continue
        }
        // v3.6 그룹 쓰기 SSOT — operator 는 활성 그룹 강제(폼/payload 값 무시),
        //   admin 진입그룹/전체거부, system 은 requested 신뢰. 같은 장비의 모든 컴포넌트가
        //   동일 활성 그룹으로 통일되어 자산-컴포넌트 그룹 불일치/오병합을 차단한다.
        const wg = await resolveWriteGroup(c, validated.value.group_company)
        if (!wg.ok) {
          errors.push({ row, vendor: validated.value.vendor, product: validated.value.product, error: wg.error })
          hasError = true
          continue
        }
        validated.value.group_company = wg.group
        const perm = canWriteGroup(c, validated.value.group_company)
        if (!perm.ok) {
          errors.push({ row, vendor: validated.value.vendor, product: validated.value.product, error: perm.error })
          hasError = true
          continue
        }
        validatedComponents.push({ input: validated.value, raw, tag })
      }
      if (hasError || validatedComponents.length === 0) continue

      // 대표 컴포넌트에서 공유 메타 추출 (첫 번째 컴포넌트에서 hostname/group/owner 가져옴)
      const firstInput = validatedComponents[0].input
      const sharedHostname = firstInput.hostname
      const sharedGroup = firstInput.group_company
      const sharedOwner = firstInput.owner
      const sharedManager = firstInput.manager

      // asset 이름 결정: deriveAssetName 으로 HW>OS>FW 우선순위 적용
      const assetName = deriveAssetName(
        validatedComponents.map((v) => ({
          category: v.input.category,
          product: v.input.product,
          vendor: v.input.vendor,
        })),
        sharedHostname,
      )

      try {
        candidateAssetId = await resolveOrCreateAsset(db, {
          name: assetName,
          vendor: firstInput.vendor,
          hostname: sharedHostname,
          group_company: sharedGroup,
          owner: sharedOwner,
          manager: sharedManager,
        })
      } catch (err) {
        errors.push({ row, vendor: firstInput.vendor, product: assetName, error: `asset 생성 실패: ${err instanceof Error ? err.message : ''}` })
        continue
      }

      // 각 컴포넌트 INSERT (모두 같은 candidateAssetId)
      for (const { input } of validatedComponents) {
        try {
          const id = await insertBulkSolution(c.env, input, 'bulk_equipment', candidateAssetId)
          insertedIds.push(id)
        } catch (err) {
          errors.push({
            row,
            vendor: input.vendor,
            product: input.product,
            error: err instanceof Error ? err.message : 'INSERT failed',
          })
        }
      }
      // v3.3 장비 전체 컴포넌트 반영해 영향시스템 자동 분류 (manual 보존)
      if (candidateAssetId != null) await applyDerivedImpactSystem(db, candidateAssetId)
      continue
    }

    // ─ legacy 모드 ─────────────────────────────────────────
    for (const { raw, tag } of raws) {
      const validated = validateSolutionInput(raw)
      if (!validated.ok) {
        errors.push({
          row,
          vendor: extractField(raw, 'vendor'),
          product: extractField(raw, 'product') ?? tag,
          error: validated.error,
        })
        continue
      }

      // v3.6 그룹 쓰기 SSOT — operator 는 활성 그룹 강제(CSV group_company 컬럼 무시),
      //   admin 은 진입그룹/전체면 컬럼값 존중, system(n8n) 은 컬럼값 신뢰.
      const wg = await resolveWriteGroup(c, validated.value.group_company)
      if (!wg.ok) {
        errors.push({
          row,
          vendor: validated.value.vendor,
          product: validated.value.product,
          error: wg.error,
        })
        continue
      }
      validated.value.group_company = wg.group
      const perm = canWriteGroup(c, validated.value.group_company)
      if (!perm.ok) {
        errors.push({
          row,
          vendor: validated.value.vendor,
          product: validated.value.product,
          error: perm.error,
        })
        continue
      }

      // v3.1 legacy: 행마다 단독 asset (hostname 없으면 항상 신규)
      let legacyAssetId: number | null = null
      try {
        legacyAssetId = await resolveOrCreateAsset(db, {
          name: validated.value.hostname?.trim()
            ? validated.value.hostname.trim()
            : `${validated.value.vendor} ${validated.value.product}`,
          vendor: validated.value.vendor,
          hostname: validated.value.hostname,
          group_company: validated.value.group_company,
          owner: validated.value.owner,
          manager: validated.value.manager,
        })
      } catch {
        // asset 생성 실패 시 asset_id=null 로 계속 진행
      }

      try {
        const id = await insertBulkSolution(c.env, validated.value, 'bulk_csv', legacyAssetId)
        insertedIds.push(id)
        // v3.3 영향시스템 자동 분류 (manual 보존)
        if (legacyAssetId != null) await applyDerivedImpactSystem(db, legacyAssetId)
      } catch (err) {
        errors.push({
          row,
          vendor: validated.value.vendor,
          product: validated.value.product,
          error: err instanceof Error ? err.message : 'INSERT failed',
        })
      }
    }
  }

  // 등록된 행에 대해 임베딩 + rematch 트리거 (비동기, 응답 지연 없음)
  if (insertedIds.length > 0) {
    c.executionCtx.waitUntil(
      backgroundEnrichAndRematch(c.env, insertedIds, source, kind),
    )
  }

  const auditActor = getAuthContext(c)?.user.username ??
    (kind === 'equipment'
      ? 'bulk_equipment'
      : source === 'csv'
        ? 'bulk_csv'
        : 'bulk_json')
  await writeAudit(
    db,
    'bulk_import',
    'solutions',
    0,
    auditActor,
    {
      kind,
      input_rows: candidates.length,
      components_expanded: componentsExpanded,
      created: insertedIds.length,
      error_count: errors.length,
    },
  )

  const result: BulkImportResult = {
    total: candidates.length,
    created: insertedIds.length,
    errors,
    source,
    kind,
    componentsExpanded,
  }

  const httpStatus = errors.length === 0 ? 201 : 207
  return c.json({ success: errors.length === 0, data: result }, httpStatus)
})

export default app

// === helpers ===

function extractField(raw: unknown, key: string): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const v = (raw as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

// CSV row(헤더→문자열 맵) → 레거시 SolutionInput 형태(검증 전)로 변환
function csvRowToInput(row: Record<string, string>): Record<string, unknown> {
  const attrs = extractCategoryAttributes(row)
  const obj: Record<string, unknown> = {
    vendor: row.vendor ?? '',
    product: row.product ?? '',
    category: row.category ?? '',
    current_version: row.current_version ?? '',
    hostname: row.hostname ?? null,
    owner: row.owner ?? null,
    manager: row.manager ?? null,
    notes: row.notes ?? null,
    group_company: row.group_company ?? null,
    cpe_part: row.cpe_part ?? null,
    cpe_version_range: row.cpe_version_range ?? null,
    cpe_uri: row.cpe_uri ?? null,
    aliases: row.aliases ?? null,
    category_attributes: attrs,
  }
  return obj
}

/**
 * equipment 입력(검증 전 raw) → 솔루션 raw 배열로 분해.
 * 검증 실패(필수 누락 등)는 각 솔루션의 validateSolutionInput 단계에서 에러로 보고된다.
 */
function expandEquipmentToSolutionRaws(
  raw: unknown,
): Array<{ raw: unknown; tag: string }> {
  const validated = validateEquipmentInput(raw)
  if (!validated.ok) {
    // 검증 실패는 빈 raw 1건을 만들어 솔루션 검증 단계에서 동일 에러 메시지가 떨어지도록.
    // (vendor/product 추출 가능하면 표시)
    const r = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>
    return [
      {
        raw: {
          vendor: r.vendor ?? '',
          product: r.model ?? '',
          category: '',
          current_version: '',
          hostname: r.hostname ?? null,
          group_company: r.group_company ?? null,
        },
        tag: typeof r.model === 'string' ? r.model : '',
      },
    ]
  }
  const solutions = mapEquipmentToSolutions(validated.value)
  return solutions.map((s) => ({
    raw: s as unknown,
    tag: `${s.product} (${s.category})`,
  }))
}

async function insertBulkSolution(
  env: Bindings,
  input: SolutionInput,
  sourceTag: 'bulk_csv' | 'bulk_equipment',
  assetId: number | null = null,
): Promise<number> {
  const db = env.DB

  const { aliases: autoAliases, vendorNorm, productNorm } = generateAliases({
    vendor: input.vendor,
    product: input.product,
    category: input.category,
  })
  const mergedAliases = Array.from(
    new Set([...(input.aliases ?? []).map((s) => s.trim()), ...autoAliases]),
  )

  let cpePart = input.cpe_part
  if (!cpePart && !input.cpe_uri) {
    try {
      const suggestions = await suggestCpe(env, `${input.vendor} ${input.product}`, 5)
      const best = suggestions.find((s) => !s.deprecated) ?? suggestions[0]
      cpePart = best?.cpe_part ?? null
    } catch {
      // 무시 — cpe_part 는 null 로 진행
    }
  }

  const categoryAttrsJson = input.category_attributes
    ? JSON.stringify(input.category_attributes)
    : null

  // v3.1: asset_id 포함 INSERT
  const result = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, hostname, owner, manager, notes, group_company,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status, asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      input.vendor,
      input.product,
      input.category,
      input.current_version,
      input.hostname,
      input.owner,
      input.manager,
      input.notes,
      input.group_company,
      cpePart,
      input.cpe_version_range,
      JSON.stringify(mergedAliases),
      vendorNorm,
      productNorm,
      input.cpe_uri,
      categoryAttrsJson,
      sourceTag,
      assetId,
    )
    .run()

  return Number(result.meta.last_row_id)
}

async function backgroundEnrichAndRematch(
  env: Bindings,
  ids: number[],
  source: BulkSource,
  kind: BulkKind,
): Promise<void> {
  const db = env.DB
  const actor = kind === 'equipment' ? 'bulk_equipment' : source === 'csv' ? 'bulk_csv' : 'bulk_json'
  for (const id of ids) {
    const row = await db
      .prepare('SELECT * FROM solutions WHERE id = ?')
      .bind(id)
      .first<Solution>()
    if (row) {
      await upsertSolutionEmbedding(env, row).catch(() => undefined)
    }
    const result = await triggerRematch(env, id).catch(() => ({
      ok: false as const,
      error: 'rematch threw',
    }))
    await writeAudit(
      db,
      result.ok ? 'rematch_requested' : 'rematch_request_failed',
      'solutions',
      id,
      actor,
      { solution_id: id, window_days: 365, result, bulk: true, kind },
    )
  }
}
