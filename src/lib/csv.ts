// 의존성 없는 RFC 4180 호환 CSV 파서
// - 헤더 행 1개 필수
// - 쌍따옴표 둘러싼 셀, 셀 내 쉼표/개행/이중따옴표("") 지원
// - BOM(U+FEFF) 자동 제거
// - 빈 행은 무시
//
// Workers 런타임에 외부 라이브러리(csv-parse 등) 추가 없이 인라인 처리.

export interface CsvParseResult {
  headers: string[]
  rows: Array<Record<string, string>>
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvParseError'
  }
}

export function parseCsv(text: string): CsvParseResult {
  const stripped = text.replace(/^﻿/, '')
  const records = tokenize(stripped)

  // 후행 빈 행 제거
  while (records.length > 0 && isBlankRow(records[records.length - 1])) {
    records.pop()
  }

  if (records.length === 0) {
    throw new CsvParseError('CSV is empty')
  }

  const headers = records[0].map((h) => h.trim())
  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    throw new CsvParseError('CSV header row is empty')
  }

  const dataRows = records.slice(1).filter((r) => !isBlankRow(r))
  const rows = dataRows.map((cells) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim()
    })
    return obj
  })

  return { headers, rows }
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.length === 0)
}

function tokenize(input: string): string[][] {
  const records: string[][] = []
  let current: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        // RFC 4180: "" 는 escape 된 따옴표
        if (input[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      current.push(cell)
      cell = ''
      i++
      continue
    }
    if (ch === '\r') {
      // CRLF 또는 단독 CR 모두 행 종료로 취급
      current.push(cell)
      cell = ''
      records.push(current)
      current = []
      i++
      if (input[i] === '\n') i++
      continue
    }
    if (ch === '\n') {
      current.push(cell)
      cell = ''
      records.push(current)
      current = []
      i++
      continue
    }
    cell += ch
    i++
  }

  // 마지막 셀/행 flush
  if (cell.length > 0 || current.length > 0) {
    current.push(cell)
    records.push(current)
  }

  return records
}

// 헤더의 `attr.*` 접두사 컬럼들을 단일 JSON 객체로 합친다.
// - 값이 비어있는 attr.* 는 제외
// - 객체에 항목이 하나도 없으면 null 반환
export function extractCategoryAttributes(
  row: Record<string, string>,
): Record<string, unknown> | null {
  const attrs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith('attr.')) continue
    const trimmed = value.trim()
    if (trimmed.length === 0) continue
    const name = key.slice('attr.'.length)
    if (name.length === 0) continue

    // 숫자/불리언 자동 캐스팅 시도
    if (trimmed === 'true') attrs[name] = true
    else if (trimmed === 'false') attrs[name] = false
    else if (/^-?\d+$/.test(trimmed)) attrs[name] = Number(trimmed)
    else if (/^-?\d+\.\d+$/.test(trimmed)) attrs[name] = Number(trimmed)
    else attrs[name] = trimmed
  }
  return Object.keys(attrs).length > 0 ? attrs : null
}
