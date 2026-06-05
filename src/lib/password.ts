// v3.0 비밀번호 해싱/검증 — Workers Web Crypto 표준 (PBKDF2-SHA256, 100k iterations, 16B salt).
// 저장 형식: "<saltHex>$<derivedKeyHex>" (단일 컬럼)
// bcrypt 같은 네이티브 라이브러리는 Workers 환경에서 사용 불가능.

const ITERATIONS = 100_000
const KEY_LEN_BITS = 256 // 32 bytes
const SALT_LEN_BYTES = 16
const HASH_NAME = 'SHA-256' as const

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  for (let i = 0; i < arr.length; i++) {
    const h = arr[i].toString(16)
    out += h.length === 1 ? '0' + h : h
  }
  return out
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return out
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
      hash: HASH_NAME,
    },
    passwordKey,
    KEY_LEN_BITS,
  )
}

/**
 * 신규 비밀번호 해싱. 새 salt 16바이트 생성 후 PBKDF2 유도.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length === 0) {
    throw new Error('password cannot be empty')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN_BYTES))
  const derived = await deriveBits(plaintext, salt)
  return `${bytesToHex(salt)}$${bytesToHex(derived)}`
}

/**
 * 저장된 해시와 plaintext 비교 (상수 시간).
 * 잘못된 형식의 stored 입력(예: 'disabled$disabled' 시스템 사용자)도 안전하게 false 반환.
 */
export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  if (!plaintext || !stored) return false
  const idx = stored.indexOf('$')
  if (idx <= 0 || idx === stored.length - 1) return false

  const saltHex = stored.slice(0, idx)
  const hashHex = stored.slice(idx + 1)

  let salt: Uint8Array
  let expectedHashHex: string
  try {
    salt = hexToBytes(saltHex)
    expectedHashHex = hashHex
    // PBKDF2 출력은 KEY_LEN_BITS/8 = 32 bytes = 64 hex chars.
    // 저장된 해시 길이가 안 맞으면 즉시 false (잘못된 형식).
    if (salt.length !== SALT_LEN_BYTES || expectedHashHex.length !== KEY_LEN_BITS / 4) {
      return false
    }
  } catch {
    return false
  }

  const derived = await deriveBits(plaintext, salt)
  const derivedHex = bytesToHex(derived)
  return timingSafeEqual(derivedHex, expectedHashHex)
}

/**
 * 상수 시간 문자열 비교 — 길이가 다르면 false 지만 그래도 한 번은 순회.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // 길이가 다르면 false 지만 타이밍 누출 방지 위해 동일 길이까지 순회
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}
