/**
 * src/lib/scenario.manual-vuln.test.ts
 *
 * 감독관(Supervisor) 종단 시나리오 테스트 — 수동 취약점 상태 오버라이드 전체 생명주기.
 * node:sqlite D1 shim + 실제 마이그레이션(0001~0007) 사용.
 *
 * 시나리오 (a → e):
 *   a. markVulnerable (cve_id 없음) → source='manual' 행 삽입, is_vulnerable=1
 *   b. markResolved → is_vulnerable=0, manual_status='resolved', 이력 보존
 *   c. n8n 동일 CVE 재전송 (INSERT OR IGNORE, changes=0) → resolved 유지
 *   d. n8n 신규 CVE 탐지 (INSERT OR IGNORE, changes=1) → resolved 해제, is_vulnerable=1
 *   e. clearManualStatus (수동-취약 상태) → manual row 삭제, is_vulnerable 재계산=0
 */

import { describe, it, expect } from 'vitest'
import { createD1ShimWithRaw, applyMigrations } from '../../test/d1-shim'
import type { D1DatabaseShim } from '../../test/d1-shim'
import { markVulnerable, markResolved, clearManualStatus } from './vuln-status'

// D1Database 타입 캐스팅 헬퍼
function asDb(shim: D1DatabaseShim): D1Database {
  return shim as unknown as D1Database
}

/** solutions 행 삽입 → id 반환 */
async function seedSolution(db: D1DatabaseShim): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO solutions
         (vendor, product, category, current_version, group_company, is_vulnerable,
          cpe_part, cpe_version_range, aliases, vendor_normalized, product_normalized,
          cpe_uri, category_attributes, source, embedding_status)
       VALUES ('ACME', 'Router', 'FW', '2.0', null, 0,
               NULL, NULL, '[]', 'acme', 'router', NULL, NULL, 'test', 'pending')`,
    )
    .run()
  return res.meta.last_row_id
}

/** matched_vulns 직접 삽입 (vulns.ts /match 에뮬레이션) → { changes } */
async function n8nInsertCve(
  db: D1DatabaseShim,
  solutionId: number,
  cveId: string,
): Promise<{ changes: number }> {
  const insRes = await db
    .prepare(
      `INSERT OR IGNORE INTO matched_vulns
         (solution_id, cve_id, source, severity, detected_at, first_seen_at)
       VALUES (?, ?, 'nvd', 'high', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(solutionId, cveId)
    .run()
  return { changes: insRes.meta.changes }
}

/**
 * vulns.ts POST /match 의 UPDATE solutions 로직 재현:
 *   - is_vulnerable = 1
 *   - manual_status: 'resolved' → NULL, 그 외 유지
 * changes=1 일 때만 호출해야 한다 (삽입 성공한 경우).
 */
async function n8nFlagSolution(db: D1DatabaseShim, solutionId: number, cveId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE solutions
          SET is_vulnerable = 1,
              last_matched_cve = ?,
              last_matched_at = CURRENT_TIMESTAMP,
              manual_status = CASE
                WHEN manual_status = 'resolved' THEN NULL
                ELSE manual_status
              END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(cveId, solutionId)
    .run()
}

describe('수동 취약점 상태 오버라이드 — 전체 생명주기 종단 시나리오', () => {
  it('a~e 전체 생명주기를 순서대로 검증한다', async () => {
    const shim = createD1ShimWithRaw()
    applyMigrations(shim)
    const db = asDb(shim)

    // ── 초기 시드 ──────────────────────────────────────────────
    const solId = await seedSolution(shim)
    const initial = await shim
      .prepare('SELECT is_vulnerable, manual_status FROM solutions WHERE id = ?')
      .bind(solId)
      .first<{ is_vulnerable: number; manual_status: string | null }>()
    expect(initial!.is_vulnerable).toBe(0)
    expect(initial!.manual_status).toBeNull()

    // ── (a) markVulnerable (cve_id 없음) ──────────────────────
    console.log('\n[a] markVulnerable (cve_id 없음) 호출...')
    await markVulnerable(db, solId, 'operator', {
      note: 'n8n 미검출 — 수동 확인',
    })

    const afterA = await shim
      .prepare(
        'SELECT is_vulnerable, manual_status, last_matched_cve FROM solutions WHERE id = ?',
      )
      .bind(solId)
      .first<{ is_vulnerable: number; manual_status: string | null; last_matched_cve: string | null }>()
    expect(afterA!.is_vulnerable).toBe(1)
    expect(afterA!.manual_status).toBe('vulnerable')
    expect(afterA!.last_matched_cve).toMatch(/^MANUAL-\d+-\d+$/)

    const manualCveId = afterA!.last_matched_cve!

    const manualRow = await shim
      .prepare("SELECT source, cve_id FROM matched_vulns WHERE solution_id = ? AND source = 'manual'")
      .bind(solId)
      .first<{ source: string; cve_id: string }>()
    expect(manualRow).not.toBeNull()
    expect(manualRow!.source).toBe('manual')
    expect(manualRow!.cve_id).toBe(manualCveId)

    console.log(`    is_vulnerable=1, manual_status='vulnerable', cve_id=${manualCveId}  → PASS`)

    // ── (b) markResolved ──────────────────────────────────────
    console.log('[b] markResolved 호출...')
    await markResolved(db, solId, 'operator', '패치 적용 완료 (수동 확인)')

    const afterB = await shim
      .prepare(
        'SELECT is_vulnerable, manual_status, status_note FROM solutions WHERE id = ?',
      )
      .bind(solId)
      .first<{ is_vulnerable: number; manual_status: string | null; status_note: string | null }>()
    expect(afterB!.is_vulnerable).toBe(0)
    expect(afterB!.manual_status).toBe('resolved')
    expect(afterB!.status_note).toBe('패치 적용 완료 (수동 확인)')

    // 이력(manual matched_vulns 행)은 보존되어야 함
    const historyRow = await shim
      .prepare("SELECT id FROM matched_vulns WHERE solution_id = ? AND source = 'manual'")
      .bind(solId)
      .first<{ id: number }>()
    expect(historyRow).not.toBeNull()

    console.log(`    is_vulnerable=0, manual_status='resolved', history row preserved  → PASS`)

    // ── (c) n8n 동일 CVE 재전송 (이미 존재 → INSERT OR IGNORE, changes=0) ──
    console.log('[c] n8n 동일 CVE 재전송 (INSERT OR IGNORE 중복)...')
    const { changes: changesC } = await n8nInsertCve(shim, solId, manualCveId)
    expect(changesC).toBe(0) // UNIQUE 충돌 → 무시

    // changes=0 이므로 UPDATE solutions 진입 안 함 → resolved 유지
    const afterC = await shim
      .prepare('SELECT is_vulnerable, manual_status FROM solutions WHERE id = ?')
      .bind(solId)
      .first<{ is_vulnerable: number; manual_status: string | null }>()
    expect(afterC!.is_vulnerable).toBe(0)
    expect(afterC!.manual_status).toBe('resolved')

    console.log(`    changes=0, is_vulnerable=0, manual_status='resolved' 유지  → PASS`)

    // ── (d) n8n 신규 CVE 탐지 (changes=1) → resolved 해제 ────
    const newCveId = 'CVE-2025-99999'
    console.log(`[d] n8n 신규 CVE ${newCveId} 탐지 (INSERT OR IGNORE, changes=1)...`)
    const { changes: changesD } = await n8nInsertCve(shim, solId, newCveId)
    expect(changesD).toBe(1) // 실제 신규 삽입

    // changes=1 이면 vulns.ts 의 UPDATE solutions 실행
    await n8nFlagSolution(shim, solId, newCveId)

    const afterD = await shim
      .prepare(
        'SELECT is_vulnerable, manual_status, last_matched_cve FROM solutions WHERE id = ?',
      )
      .bind(solId)
      .first<{ is_vulnerable: number; manual_status: string | null; last_matched_cve: string | null }>()
    expect(afterD!.is_vulnerable).toBe(1)      // 신규 CVE → 재-취약 표시
    expect(afterD!.manual_status).toBeNull()   // 'resolved' → NULL (해제)
    expect(afterD!.last_matched_cve).toBe(newCveId)

    console.log(`    changes=1, is_vulnerable=1, manual_status=NULL (resolved 해제)  → PASS`)

    // ── (e) clearManualStatus (is_vulnerable=1, manual_status='vulnerable' 상태로 초기화 후 테스트) ──
    // 별도 픽스처: 수동 취약 상태만 있는 컴포넌트에서 clearManualStatus 호출
    console.log('[e] clearManualStatus — 수동-취약만 있는 상태에서 AUTO 복귀...')
    const shim2 = createD1ShimWithRaw()
    applyMigrations(shim2)
    const db2 = asDb(shim2)
    const solId2 = await seedSolution(shim2)

    await markVulnerable(db2, solId2, 'op', { cve_id: 'MANUAL-E-TEST', note: '테스트' })
    const beforeClear = await shim2
      .prepare('SELECT is_vulnerable, manual_status FROM solutions WHERE id = ?')
      .bind(solId2)
      .first<{ is_vulnerable: number; manual_status: string | null }>()
    expect(beforeClear!.is_vulnerable).toBe(1)
    expect(beforeClear!.manual_status).toBe('vulnerable')

    await clearManualStatus(db2, solId2, 'admin')

    const afterE = await shim2
      .prepare(
        'SELECT is_vulnerable, manual_status, last_matched_cve FROM solutions WHERE id = ?',
      )
      .bind(solId2)
      .first<{ is_vulnerable: number; manual_status: string | null; last_matched_cve: string | null }>()
    expect(afterE!.is_vulnerable).toBe(0)      // 수동 행만 있었으므로 재계산 → 0
    expect(afterE!.manual_status).toBeNull()
    expect(afterE!.last_matched_cve).toBeNull()

    // source='manual' 행 삭제 확인
    const deletedManual = await shim2
      .prepare("SELECT id FROM matched_vulns WHERE solution_id = ? AND source = 'manual'")
      .bind(solId2)
      .first<{ id: number }>()
    expect(deletedManual).toBeNull()

    console.log(`    source='manual' row deleted, is_vulnerable=0, manual_status=NULL  → PASS`)
    console.log('\n[시나리오 완료] a~e 전 단계 PASS\n')
  })
})
