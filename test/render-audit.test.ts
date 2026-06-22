// 시각 감사용 — login / account 페이지를 HTML 로 렌더해 verify/*.html 생성.
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { LoginPage } from '../src/views/login'
import { AccountPage } from '../src/views/account'

describe('시각 감사 렌더', () => {
  it('로그인 페이지 → verify/preview-login.html', () => {
    const html = String(
      LoginPage({ next: '/', adminContact: 'security@example.com', helpUrl: 'https://example.com/help' }),
    )
    expect(html).toContain('운영자 로그인')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-login.html', html, 'utf-8')
  })

  it('내 계정 페이지 → verify/preview-account.html', () => {
    const html = String(
      AccountPage({
        currentUser: { username: 'sec.kim', role: 'operator', groups: ['본사', '자회사A'] },
        lastLogin: '2026-06-06 18:20',
        activeGroup: '본사',
      }),
    )
    expect(html).toContain('내 계정')
    mkdirSync('verify', { recursive: true })
    writeFileSync('verify/preview-account.html', html, 'utf-8')
  })
})
