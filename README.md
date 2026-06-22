# vuln-monitor-web

> **보안 솔루션 취약점(CVE) 모니터링 멀티테넌트 웹 애플리케이션**
> Cloudflare Workers 위에서 동작하며, 운영자가 등록한 장비·소프트웨어 인벤토리를 CVE와 자동 매칭해 "어떤 자산이 어떤 취약점에 노출됐는지"를 추적합니다. n8n 자동화 워크플로와 API로 연동됩니다.

---

## 목차

1. [한눈에 보기](#1-한눈에-보기)
2. [무엇을 해결하는가](#2-무엇을-해결하는가)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [주요 기능](#4-주요-기능)
5. [기술 스택](#5-기술-스택)
6. [핵심 개념: 자산 · 컴포넌트 · 영향시스템](#6-핵심-개념-자산--컴포넌트--영향시스템)
7. [취약점 매칭이 동작하는 방식](#7-취약점-매칭이-동작하는-방식)
8. [데이터 모델](#8-데이터-모델)
9. [화면(UI) 구성](#9-화면ui-구성)
10. [API 레퍼런스](#10-api-레퍼런스)
11. [보안 모델: 인증 · 권한 · 멀티테넌시](#11-보안-모델-인증--권한--멀티테넌시)
12. [설치 및 배포 가이드](#12-설치-및-배포-가이드)
13. [운영 가이드](#13-운영-가이드)
14. [개발 및 테스트](#14-개발-및-테스트)
15. [디렉터리 구조](#15-디렉터리-구조)
16. [버전 히스토리](#16-버전-히스토리)

---

## 1. 한눈에 보기

| 항목 | 내용 |
|------|------|
| **무엇인가** | 보유 자산(장비/소프트웨어)을 CVE 취약점과 매칭·추적하는 웹 서비스 |
| **누가 쓰는가** | 보안 운영자(operator), 관리자(admin), 외부 자동화(n8n / system) |
| **어디서 도는가** | Cloudflare Workers (서버리스 엣지). 별도 서버·VM 불필요 |
| **데이터 저장소** | Cloudflare D1 (SQLite 호환) |
| **취약점 수집** | n8n 워크플로가 NVD·KEV·EPSS·OpenCVE 등에서 평일 09:00 수집 |
| **매칭 방식** | ① CPE/별칭 기반 결정적 매칭 + ② 벡터 임베딩 기반 의미 매칭(보완) |
| **멀티테넌시** | 그룹사(group_company) 단위로 데이터 분리 및 권한 스코핑 |
| **외부 연동** | n8n 웹훅(트리거) ↔ Worker API(매칭 결과 수신) |

**핵심 가치**: 운영자는 "벤더 + 모델 + Hostname + OS 버전"만 입력하면, 시스템이 자동으로 구성요소를 분해하고 CPE를 추천하며 과거/신규 CVE와 매칭해 취약 여부를 알려줍니다.

---

## 2. 무엇을 해결하는가

보안 운영자는 수백 대의 장비와 소프트웨어를 관리하지만, "내 장비 중 무엇이 이번에 발표된 CVE에 취약한가"를 수작업으로 추적하기는 어렵습니다.

이 시스템은 그 과정을 자동화합니다.

- **인벤토리 등록**: 장비/솔루션을 등록하면 OS·DB·미들웨어·암호 라이브러리 등 구성요소로 자동 분해
- **자동 매칭**: n8n이 매일 새 CVE를 수집하고, 등록된 자산과 자동으로 대조
- **취약 현황 가시화**: 대시보드에서 그룹사·영향시스템·카테고리별 취약 현황을 한눈에 확인
- **조치 추적**: 운영자가 수동으로 "취약/조치완료"를 표시하고, 조치 이력을 감사 로그로 보존
- **멀티테넌시**: 그룹사별로 데이터와 권한을 분리해 담당자는 본인 그룹사만, 관리자는 전체를 관리

---

## 3. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│                        사용자 / 외부 시스템                            │
│   운영자(브라우저)        관리자(브라우저)        n8n 자동화           │
└─────────┬───────────────────┬──────────────────────┬──────────────────┘
          │ 세션 쿠키          │ 세션 쿠키             │ Bearer API_KEY
          ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Cloudflare Worker (Hono + JSX)                        │
│                                                                        │
│   [공개]  /api/health · /login · /logout                              │
│   [보호]  sessionOrBearerAuth 게이트 통과 후:                         │
│           · 웹 UI  : / · /solutions · /history · /select-group        │
│                      /admin/* · /account · /dashboard/widgets         │
│           · JSON API: /api/solutions · /api/vulns · /api/match        │
│                       /api/cpe  (외부 자동화용)                       │
│                                                                        │
│   [Cron]  매일 03:00(KST) login_attempts 90일 초과분 정리            │
└───┬───────────────┬────────────────┬───────────────────┬─────────────┘
    │ D1            │ Workers AI      │ Vectorize         │ Webhook
    ▼               ▼                 ▼                   ▼
┌─────────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐
│   D1    │  │ @cf/baai/   │  │  vuln-       │  │  n8n (별도 Docker) │
│ SQLite  │  │ bge-m3      │  │  monitor-    │  │  · 평일 09:00 수집 │
│ 10 테이블│  │ (768차원    │  │  solutions   │  │  · NVD/KEV/EPSS    │
│         │  │  임베딩)    │  │ (코사인유사도)│  │  · 매칭 → 결과 적재│
└─────────┘  └─────────────┘  └──────────────┘  └────────────────────┘
```

**요청 처리 흐름**

1. 모든 HTTP 요청은 `handler.fetch` → Hono 라우터로 진입
2. 공개 경로(`/api/health`, `/login`, `/logout`)는 인증 없이 처리
3. 그 외 모든 경로는 `sessionOrBearerAuth` 미들웨어 통과 필요
   - **세션 쿠키**(운영자) 검증을 먼저 시도, 실패 시 **Bearer 토큰**(자동화)으로 폴백
   - 둘 다 실패: `/api/*` 경로 또는 `Accept: application/json`(only) 요청은 `401 JSON`, 그 외(브라우저)는 `302 /login`
4. 인증 통과 후 라우트 내부에서 **역할(RBAC) + 그룹사 스코핑**을 다시 적용(이중 방어)
5. 모든 응답은 일관된 JSON 봉투 `{ success, data?, error?, meta? }` 또는 HTML

---

## 4. 주요 기능

### 자산 인벤토리 관리
- **장비 단위 등록**: 벤더/모델/Hostname/OS 버전만 입력하면 OS·HW·DB·OpenSSL·WEB·WAS 등 구성요소로 자동 분해
- **CSV 일괄 등록**: 한 행 = 한 장비. 최대 500행. 샘플 템플릿 제공
- **부모 자산(asset) ↔ 구성요소(solution) 2계층 모델**: 장비 1대가 여러 컴포넌트를 소유
- **CPE 자동 추천**: NVD CPE Dictionary에서 표준 식별자를 자동 채움(7일 캐시)

### 취약점 매칭 및 추적
- **자동 매칭**: n8n이 수집한 CVE를 등록 자산과 대조
- **의미 기반 보완 매칭**: 키워드/CPE가 놓치는 케이스를 벡터 유사도로 보완(다국어 임베딩)
- **수동 상태 오버라이드**: 운영자가 직접 "취약 표시 / 조치완료 / 자동복귀" 지정
- **조치 이력**: 조치 방식(수동 조치 / 버전 업데이트)과 담당자를 감사 로그로 보존

### 대시보드 및 가시화
- 통계 카드(총 자산 / 취약 자산 / 최근 매칭 시각)
- 영향시스템 분포 도넛 차트 + 그룹사별 취약/정상 스택 막대 차트
- 영향시스템·카테고리별 드릴다운, 최근 매칭 취약점 목록
- 공유 대시보드 위젯(필터 프리셋 / 공유 노트)

### 멀티테넌시 및 운영
- 그룹사 단위 데이터 분리 및 권한 스코핑
- 사용자/권한 관리(관리자 전용)
- 본인 비밀번호 변경(전 세션 자동 무효화)
- 로그인 보안(레이트리밋·계정 잠금·감사 로그)

---

## 5. 기술 스택

| 영역 | 기술 | 비고 |
|------|------|------|
| 런타임 | Cloudflare Workers | 서버리스 엣지, `compatibility_date: 2026-04-22`, `nodejs_compat` |
| 웹 프레임워크 | [Hono](https://hono.dev) `^4.12.14` | 경량 라우터 + 서버사이드 JSX 렌더링 |
| 언어 | TypeScript `^6` | `strict: true`, ESNext |
| 데이터베이스 | Cloudflare D1 (SQLite) | 10개 테이블, 12개 마이그레이션 |
| 임베딩 모델 | Workers AI `@cf/baai/bge-m3` | 768차원, 다국어(한/영) |
| 벡터 검색 | Cloudflare Vectorize | 인덱스 `vuln-monitor-solutions`, 코사인 유사도 |
| UI 스타일 | Tabler CSS + Tabler Icons + ApexCharts | CDN 로드, 서버 렌더 HTML |
| 테스트 | Vitest `^4` (단위/통합) + Playwright (E2E/스크린샷) | Node 환경에서 실행 |
| 배포 도구 | Wrangler `^4` | `wrangler deploy --minify` |

> 런타임 의존성은 `hono` **단 하나**입니다. CSV 파서·정규화·임베딩 등은 외부 라이브러리 없이 직접 구현되어 Workers 번들을 가볍게 유지합니다.

---

## 6. 핵심 개념: 자산 · 컴포넌트 · 영향시스템

이 시스템을 이해하는 핵심은 **3계층 데이터 모델**과 **2개의 직교 분류축**입니다.

### 3계층 모델

```
assets (부모 자산 = 장비 1대)
  └─ solutions (컴포넌트 = OS, DB, 미들웨어, 라이브러리 …)
       └─ matched_vulns (매칭된 CVE)
```

- **assets (자산)**: 운영자가 관리하는 물리/논리 단위. 자연키는 `(group_company, hostname)`. 취약 여부나 카테고리를 직접 저장하지 않고 소속 컴포넌트에서 **파생**합니다.
- **solutions (컴포넌트)**: 실제 CVE 매칭 대상. 한 장비를 OS/HW/DB/Crypto/WEB/WAS 등으로 분해한 행. 벤더·제품·버전과 매칭 메타데이터(CPE, 별칭, 임베딩)를 보유합니다.
- **matched_vulns (매칭 결과)**: 컴포넌트에 매칭된 CVE. `source`로 자동(n8n/시맨틱)과 수동(manual)을 구분합니다.

### 2개의 직교 분류축

| 분류축 | 위치 | 값 | 의미 |
|--------|------|----|----|
| **category (카테고리)** | solutions | OS·DB·HW·WEB·WAS·FW·WAF·IPS·IDS·DDoS·VPN·EDR·SIEM·Crypto·Library·SW·Other (총 17종) | 컴포넌트가 "무엇인지"(기술 종류) |
| **impact_system (영향시스템)** | assets | PC · SERVER · WEBWAS · DATABASE · NETWORK · APPLICATION (6종) | 자산이 "어떤 업무 시스템인지"(회사 공식 분류) |

영향시스템은 컴포넌트 구성으로 자동 추론됩니다. **추론에는 우선순위가 있습니다**:

1. 네트워크 장비(FW/WAF/IPS/IDS/DDoS/VPN)가 하나라도 있으면 다른 컴포넌트가 있어도 → `NETWORK`
2. WEB 또는 WAS → `WEBWAS`
3. DB → `DATABASE`
4. OS 보유 시 → `PC`(EDR+PC성 카테고리만) 또는 `SERVER`
5. OS 없이 SW/Library → `APPLICATION`
6. EDR 단독 → `PC`

즉, 방화벽과 WEB 컴포넌트를 동시에 가진 자산은 `WEBWAS`가 아니라 `NETWORK`로 분류됩니다(보안팀 워크로드 가정). 운영자가 수동으로 확정하면(`manual`) 이후 자동 추론이 그 값을 덮어쓰지 않습니다.

---

## 7. 취약점 매칭이 동작하는 방식

매칭은 **두 갈래 보완 전략**입니다. 결정적 매칭은 주로 시스템 밖(n8n + 정규화 규칙)에서, 의미 매칭은 이 코드베이스가 담당합니다.

### ① CPE / 별칭 기반 결정적 매칭 (1차, 고정밀)

- **정규화 규칙(SSOT)**: `src/lib/normalize.ts`가 벤더/제품명을 소문자화하고 공백·하이픈을 제거해 표준화합니다. 예: `"Palo Alto Networks"` ↔ `"paloaltonetworks"`. **이 규칙은 D1 백필 SQL, n8n Pre-Match Filter, Worker 등록 경로 3곳에서 동일하게 적용**되어 규칙 불일치(drift)를 방지합니다.
- **별칭 확장**: `generateAliases()`가 벤더 변형(forti ↔ fortinet), 카테고리 동의어(FW ↔ 방화벽 ↔ ngfw), 제품 패밀리(FortiGate → FortiOS)를 펼쳐 매칭 후보를 넓힙니다.
- **CPE 자동 추천**: `src/lib/cpe.ts`가 NVD CPE Dictionary를 조회해 표준 CPE 식별자를 채웁니다(D1 7일 캐시, NVD 장애 시 빈 결과로 graceful 처리).

### ② 벡터 임베딩 기반 의미 매칭 (2차, 보완)

CPE/키워드가 놓치는 케이스(표기 불일치, 설명문 기반 CVE)를 **의미 유사도**로 보완합니다.

- 컴포넌트 등록/수정 시 `Vendor/Product/Category/Aliases/Notes`를 한 문장으로 조립해 `@cf/baai/bge-m3`(768차원, 다국어)로 임베딩 → Vectorize에 `sol-<id>`로 저장
- n8n의 "Pre-Match Filter" 노드가 `POST /api/match/semantic`를 호출하면, CVE 텍스트를 같은 모델로 벡터화해 Vectorize에서 유사 컴포넌트를 검색
- **임계값(threshold) 0.65 이상**만 매칭 후보로 반환(기본 top_k=5)

### 전체 매칭 사이클

```
n8n Schedule (평일 09:00)
  → NVD/KEV/EPSS/OpenCVE 에서 신규 CVE 수집
  → D1 의 등록 컴포넌트 조회
  → CPE/별칭 매칭 + (보완) POST /api/match/semantic 의미 매칭
  → POST /api/vulns/match 로 매칭 결과 적재
       · matched_vulns 에 INSERT OR IGNORE (중복 방지)
       · 해당 컴포넌트 is_vulnerable=1, last_matched_cve/at 갱신
  → 신규 취약점 발생 시 Teams 알림
```

> 신규 컴포넌트를 등록하면 Worker가 n8n에 `triggerRematch` 웹훅을 쏘아 "이 컴포넌트를 과거 365일 CVE와 매칭하라"고 즉시 요청합니다(`waitUntil` 백그라운드 처리).

---

## 8. 데이터 모델

### 테이블 목록 (10개)

| 테이블 | 역할 | 도입 |
|--------|------|------|
| `solutions` | 컴포넌트(소프트웨어/장비 구성요소) — 매칭 대상 핵심 엔티티 | 0001 |
| `matched_vulns` | 컴포넌트별 매칭된 CVE (1:N) | 0001 |
| `audit_log` | 감사 로그 / 조치 이력(`/history`) 백엔드 | 0001 |
| `cpe_cache` | NVD CPE 후보 캐시(7일 TTL) | 0003 |
| `users` | 운영자 계정(PBKDF2 해시, 역할, 세션 버전) | 0005 |
| `user_group_companies` | 사용자 ↔ 그룹사 다대다 매핑 | 0005 |
| `dashboard_widgets` | 공유 대시보드 위젯(필터 프리셋 / 노트) | 0005 |
| `assets` | 부모 자산(장비) 엔티티 + 영향시스템 분류 | 0006 |
| `login_attempts` | 로그인 시도 감사(계정 잠금 판정, 90일 보존) | 0010 |
| `group_companies` | 그룹사 정규 레지스트리(존재하는 그룹사 권위 목록) | 0011 |

> **참고**: `/history`(조치 이력) 페이지는 별도 테이블이 아니라 `audit_log`를 조회하는 파생 뷰입니다.

### 관계 (텍스트 ERD)

```
users ──1:N(CASCADE)── user_group_companies ──(group_company 문자열)── group_companies
  ├─1:N(SET NULL)── dashboard_widgets
  └─1:N(SET NULL)── group_companies.created_by_user_id

assets ──1:N(soft FK: asset_id)── solutions ──1:N(CASCADE)── matched_vulns
   │                                  │
   └──(group_company 문자열 키)───────┴──→ group_companies (정규 레지스트리)

cpe_cache       (독립: NVD 캐시)
audit_log       (독립: actor/target 문자열) → /history 페이지가 조회
login_attempts  (독립: username 문자열)
```

- **실제 외래키(CASCADE/SET NULL)**: `matched_vulns→solutions`, `user_group_companies→users`, `dashboard_widgets→users`, `group_companies→users`
- **Soft FK(앱 레벨 무결성)**: `solutions.asset_id → assets.id` — D1 FK CASCADE 불안정성 회피를 위해 삭제 cascade를 코드(`deleteAssetCascade`)가 직접 처리
- **문자열 키 조인**: `group_company` TEXT 값이 `solutions`·`assets`·`user_group_companies`를 가로지르는 사실상의 테넌시 조인 키. `group_companies`가 그 권위 목록(단, DB FK로 강제하진 않음)

### 마이그레이션 연대기

| # | 파일 | 버전 | 핵심 변경 |
|---|------|------|----------|
| 0001 | `init` | — | 초기 스키마: solutions, matched_vulns, audit_log |
| 0002 | `groups_and_dedup` | v2.3 | 멀티테넌시 키(`group_company`) 도입 + 중복 정리 후 UNIQUE 제약 |
| 0003 | `matching_metadata` | v2.4 | CPE/별칭/정규화/임베딩 추적 컬럼 + cpe_cache 테이블 |
| 0004 | `multi_category_support` | v2.5 | CPE 2.3 URI + 카테고리 속성 JSON + 등록 출처(source) |
| 0005 | `multi_user_auth` | v3.0 | 인증/멀티테넌시: users, user_group_companies, dashboard_widgets |
| 0006 | `assets` | v3.1 | 부모 자산 엔티티 + `solutions.asset_id`(soft FK) |
| 0007 | `manual_vuln_status` | v3.2 | 수동 취약 상태 오버라이드 컬럼 |
| 0008 | `impact_system` | v3.3 | 영향시스템 분류축(6종) + 추론/수동 출처 |
| 0009 | `manager` | v3.4 | 부서(owner)/담당자(manager) 분리 |
| 0010 | `login_security` | v3.5 | 로그인 시도 추적 테이블(계정 잠금) |
| 0011 | `group_companies` | v3.6 | 그룹사 정규 레지스트리 |
| 0012 | `audit_action_index` | v3.7 | `/history` 성능용 복합 인덱스 |

---

## 9. 화면(UI) 구성

모든 화면은 **서버에서 HTML로 렌더**됩니다(Hono JSX). 클라이언트 상호작용은 인라인 스크립트로만 주입됩니다.

**사용자 진입 순서**: 로그인 → (강제) 그룹사 선택 → 대시보드

| 화면 | 경로 | 접근 권한 | 설명 |
|------|------|----------|------|
| 로그인 | `/login` | 공개 | 운영자 로그인. 비번 표시 토글·Caps Lock 경고·레이트리밋 안내 |
| 그룹사 선택 | `/select-group` | 로그인 전체 | 담당 그룹사 카드 선택. admin은 전체 보기·미분류 버킷 표시 |
| 대시보드 | `/` | 로그인 전체(스코핑) | 통계 카드·차트·영향시스템/카테고리 드릴다운·공유 위젯·최근 매칭 |
| 솔루션/자산 관리 | `/solutions` | 로그인 전체(스코핑/쓰기검증) | 자산 카드/평면 목록, 등록·수정·삭제·상태변경·CSV 업로드 |
| 조치 이력 | `/history` | 로그인 전체(스코핑) | 조치완료 이력(방식·담당자·재취약 여부). admin만 그룹사 컬럼 |
| 사용자 관리 | `/admin/users` | **admin 전용** | 사용자 CRUD, 권한·그룹사 배정 |
| 내 계정 | `/account` | 로그인 본인 | 프로필 + 본인 비밀번호 변경 |

> 로그인·그룹사 선택 화면은 공유 레이아웃을 의도적으로 쓰지 않습니다(게이트 루프 회피, 0그룹 운영자도 로그아웃 가능).

---

## 10. API 레퍼런스

응답은 모두 JSON 봉투 `{ success, data?, error?, meta? }` 형식입니다.

### 공개 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스체크(상태·환경·타임스탬프). 모니터링용 |

### 외부 자동화(n8n)용 JSON API — `/api/*`

> 세션 쿠키 **또는** Bearer 토큰(`Authorization: Bearer <API_KEY>`)으로 호출. n8n은 Bearer 토큰을 사용합니다.

#### 매칭 수신 — `/api/vulns` (`routes/vulns.ts`)

| 메서드 | 경로 | 권한 | 설명 |
|--------|------|------|------|
| POST | `/api/vulns/match` | **system/admin** | n8n이 매칭 결과를 대량 적재. `INSERT OR IGNORE`로 중복 방지, 신규 시 `is_vulnerable=1` 갱신. 응답에 `first_seen_count` 포함(알림 판단용) |
| POST | `/api/vulns/clear` | **system/admin** | 전역 취약 플래그 초기화(파괴적) |
| GET | `/api/vulns/history/:id` | 세션/Bearer + IDOR 가드 | 컴포넌트의 매칭 CVE 이력 |

#### 의미 매칭 — `/api/match` (`routes/match.ts`)

| 메서드 | 경로 | 권한 | 설명 |
|--------|------|------|------|
| POST | `/api/match/semantic` | 세션/Bearer | n8n Pre-Match Filter가 호출. CVE 텍스트로 Vectorize 유사도 검색(threshold 0.65) |
| POST | `/api/match/embed/:id` | `canWriteGroup` | 컴포넌트 임베딩 강제 재생성 |

#### 솔루션 CRUD — `/api/solutions` (`routes/solutions.ts`)

| 메서드 | 경로 | 권한 | 설명 |
|--------|------|------|------|
| GET | `/api/solutions` | 읽기 스코프 | 솔루션 목록(그룹사 스코핑) |
| GET | `/api/solutions/groups` | 스코프 | 그룹별 집계(총계/취약) |
| GET | `/api/solutions/:id` | IDOR 가드 | 단건 조회 |
| POST | `/api/solutions` | 쓰기 검증 | 컴포넌트 등록(별칭/CPE/자산/영향시스템 자동 처리) |
| POST | `/api/solutions/:id/vuln-status` | 쓰기 검증 | 수동 취약 상태 변경(vulnerable/resolved/auto) |
| POST | `/api/solutions/:id/rematch` | 쓰기 검증 | 단건 rematch 트리거(5분 내 중복 시 429) |
| PUT | `/api/solutions/:id` | 쓰기 검증 | 수정(임베딩 재생성) |
| DELETE | `/api/solutions/:id` | 쓰기 검증 | 삭제(Vectorize 인덱스도 제거) |

#### 대량 등록 / CPE 추천

| 메서드 | 경로 | 권한 | 설명 |
|--------|------|------|------|
| POST | `/api/solutions/bulk` | 행별 쓰기 검증 | CSV/JSON 일괄 등록(최대 500행). 장비/레거시 모드 자동 감지. 전건 성공 201, 부분 실패 207 |
| GET | `/api/cpe/suggest` | 세션/Bearer | NVD 기반 CPE 자동완성(`q` ≥ 2자) |

### 웹 UI 라우트 (세션 전용)

`/`, `/solutions*`, `/history`, `/select-group*`, `/groups*`, `/admin/*`, `/dashboard/widgets/*`, `/account*`, `/login`, `/logout` — HTML 또는 PRG(303 리다이렉트) 응답.

---

## 11. 보안 모델: 인증 · 권한 · 멀티테넌시

### 인증 (이중 방식)

| 방식 | 대상 | 메커니즘 |
|------|------|----------|
| **세션 쿠키** | 운영자(사람) | `vuln_session` HMAC 서명 쿠키(`SESSION_SECRET`), TTL 8시간, `httpOnly`·`secure`·`sameSite=Lax` |
| **Bearer 토큰** | 자동화(n8n) | `Authorization: Bearer <API_KEY>`, 상수시간 비교. 가상 사용자 `_system_automation`(role=`system`)으로 매핑 |

**세션 즉시 무효화**: 사용자 레코드의 `session_version`을 매 요청 DB와 대조합니다. 비밀번호 변경·계정 비활성화 시 `session_version++` → 기존 발급 쿠키가 전부 무효화됩니다(별도 세션 저장소 없이 폐기형 토큰 구현).

### 역할(RBAC)

| 역할 | 권한 |
|------|------|
| `admin` | 모든 그룹사 + 전체 집계 뷰 + 사용자 관리(`/admin/*`) |
| `operator` | 본인 매핑 그룹사만. 쓰기 시 활성 그룹 강제, 읽기 스코프 강제, IDOR 가드 |
| `system` | 외부 자동화(Bearer). 모든 그룹사 읽기/쓰기, 파괴적·교차그룹 라우트 허용 |

권한 판정은 `src/middleware/permissions.ts`의 순수 헬퍼(`requireAdmin`, `canWriteGroup`, `canReadRowGroup`, `resolveEffectiveGroup`, `resolveWriteGroup` 등)에 집중되어 있고, 인증 미들웨어 통과 후 라우트 내부에서 호출됩니다(이중 방어).

### 멀티테넌시 스코핑

- **활성 그룹 쿠키**(`vuln_active_group`): HMAC 서명 + 발급 대상 `uid` 포함(공유 PC에서 타 사용자 쿠키 재사용 차단). 값 자체는 신뢰하지 않고 매 요청 소유/존재 권한을 재검증
- **읽기 스코핑**(`resolveEffectiveGroup`): operator는 본인 그룹 강제, admin은 선택/전체, system은 무제한
- **쓰기 스코핑 SSOT**(`resolveWriteGroup`): **operator가 폼으로 보낸 그룹 값을 무시하고 활성 그룹 쿠키로 강제** → hidden 필드 위조 차단
- **IDOR 가드**(`canReadRowGroup`): 타 그룹 행 접근 시 404 반환(리소스 존재 노출 회피)

### 비밀번호 및 로그인 보안

- **해싱**: PBKDF2-SHA256, 100,000 iterations, salt-per-password, 상수시간 비교(Web Crypto)
- **정책**: 최소 10자 + 문자군 4종(소문자/대문자/숫자/특수) 중 3종 이상
- **로그인 잠금**: 최근 15분 내 5회 실패 시 `(IP, username)` 쌍 단위로 잠금
- **열거/타이밍 방어**: 미존재 계정에도 디코이 해시로 응답 시간 균일화, 단일 에러 메시지
- **CSRF 완화**: 로그아웃은 POST 전용

> ⚠️ **운영 주의(설계상 한계)**
> - 잠금 키가 `(IP, username)` 쌍이라 분산 IP 크리덴셜 스터핑은 막지 못합니다(코드에 명시).
> - `API_KEY`(role=system)는 단일 키로 전 그룹사 접근/수정이 가능하므로, **유출 시 영향이 광범위**합니다. 키 로테이션과 n8n 측 보관 보안이 중요합니다.
> - RBAC·테넌시 강제는 라우트 핸들러의 가드 호출에 의존하므로, 신규 라우트 추가 시 가드 누락에 유의해야 합니다.

---

## 12. 설치 및 배포 가이드

### 사전 준비

```bash
git clone https://github.com/Nick3072/vuln-monitor-web.git
cd vuln-monitor-web
npm install
```

### 1) Cloudflare 리소스 생성

| 리소스 | 바인딩 | 설명 |
|--------|--------|------|
| D1 데이터베이스 | `DB` | `vuln-monitor-db` (`d1_databases` 항목에 `remote: true`로 원격 D1 직접 사용) |
| Workers AI | `AI` | 임베딩 생성 |
| Vectorize 인덱스 | `VECTORIZE` | `vuln-monitor-solutions` |

```bash
# D1 생성 (생성 후 출력되는 database_id 를 wrangler.jsonc 에 반영)
npx wrangler d1 create vuln-monitor-db

# Vectorize 인덱스 생성 (bge-m3 와 동일한 768차원, 코사인 메트릭)
npx wrangler vectorize create vuln-monitor-solutions --dimensions=768 --metric=cosine
```

> ⚠️ `wrangler.jsonc`에는 원 개발 계정의 `account_id`와 D1 `database_id`가 들어 있습니다. **새 환경에 배포하려면 이 두 값을 본인 Cloudflare 계정/신규 D1 리소스 값으로 반드시 교체**하세요. `account_id`를 명시하는 이유는 OAuth 토큰이 다중 계정에 접근 가능해 비대화형(CI) 배포 시 잘못된 계정에 배포되는 것을 막기 위함입니다.

### 2) 시크릿 등록

```bash
npx wrangler secret put API_KEY            # /api/* Bearer 토큰 (n8n 연동)        [필수]
npx wrangler secret put SESSION_SECRET     # 세션 쿠키 HMAC 키, 32자+ 랜덤        [필수]
npx wrangler secret put N8N_REMATCH_WEBHOOK_URL    # n8n 재매칭 웹훅            [연동 시]
npx wrangler secret put N8N_BACKFILL_WEBHOOK_URL   # n8n 전체 백필 웹훅         [연동 시]
npx wrangler secret put N8N_REMATCH_SECRET         # x-rematch-secret 공유값   [연동 시]
npx wrangler secret put NVD_API_KEY                # NVD rate limit 상향        [선택]
npx wrangler secret list                            # 확인
```

`SESSION_SECRET` 생성 예시:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| 시크릿 | 필수 | 용도 |
|--------|------|------|
| `API_KEY` | ✅ | `/api/*` Bearer 인증(n8n/외부 자동화) |
| `SESSION_SECRET` | ✅ | 세션·활성그룹 쿠키 HMAC 서명. **미설정 시 로그인 자체 불가** |
| `N8N_REMATCH_WEBHOOK_URL` | 연동 시 | 개별 컴포넌트 재매칭 웹훅 |
| `N8N_BACKFILL_WEBHOOK_URL` | 연동 시 | 전체 백필 웹훅 |
| `N8N_REMATCH_SECRET` | 연동 시 | Worker→n8n 호출 시 `x-rematch-secret` 헤더 공유 시크릿 |
| `NVD_API_KEY` | 선택 | NVD CPE 조회 rate limit 상향(5→50 req/30s) |
| `ADMIN_CONTACT` / `HELP_URL` | 선택 | 로그인 화면 관리자 연락처 / 도움말 링크 |

### 3) 마이그레이션 적용

> ⚠️ **`wrangler d1 migrations apply`를 사용하지 마세요.** 원격 D1의 마이그레이션 추적 테이블(`d1_migrations`)이 비어 있을 경우 0001부터 전체 재적용을 시도할 수 있습니다. **개별 SQL 파일을 직접 실행**하세요(모든 DDL은 멱등하게 작성됨).

```bash
# 원격(프로덕션) — 0001 부터 0012 까지 순서대로
npx wrangler d1 execute vuln-monitor-db --remote --file=migrations/0001_init.sql
npx wrangler d1 execute vuln-monitor-db --remote --file=migrations/0002_groups_and_dedup.sql
# … 0003 ~ 0012 동일하게 순서대로 …

# 로컬 개발 DB 는 --local 사용
npx wrangler d1 execute vuln-monitor-db --local --file=migrations/0001_init.sql
```

### 4) 배포

```bash
npm run deploy          # = wrangler deploy --minify
```

### 5) 최초 관리자 부트스트랩 (1회성)

마이그레이션·배포 후, **admin 계정이 0명일 때만** 최초 1회 admin을 생성합니다(이미 admin이 있으면 `409` 거부). 세션 또는 Bearer 인증을 통과한 호출자가 사용할 수 있으며, 보통 아직 운영자 세션이 없으므로 아래처럼 Bearer 토큰(API_KEY)으로 호출합니다.

```bash
curl -X POST https://<your-worker-url>/admin/bootstrap \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<강한-비밀번호>","display_name":"System Admin","groups":["system"]}'
```

---

## 13. 운영 가이드

### Cron 스케줄

```jsonc
"triggers": { "crons": ["0 18 * * *"] }   // UTC 18:00 = KST 03:00
```

- **하는 일**: `login_attempts` 테이블에서 90일 초과분을 일일 정리(`cleanupOldAttempts`)
- **하지 않는 일**: ❗ **CVE 수집·매칭은 이 Cron이 하지 않습니다.** CVE 수집은 n8n Schedule Trigger(평일 09:00)가 담당합니다.

### n8n 연동

```
n8n Schedule(평일 09:00) ──pull──► NVD/KEV/EPSS/OpenCVE 수집
                                    │
                                    ▼
                       POST /api/vulns/match (매칭 결과 적재)
                                    ▲
Worker(신규 등록/개별 rematch) ──push──┘ (triggerRematch 웹훅, x-rematch-secret 헤더)
```

- **운영 모델**: n8n이 스스로 깨어나는 **pull(스케줄)** 이 주, Worker→n8n **push(웹훅 트리거)** 가 보조
- **시크릿 일치 필수**: Worker의 `N8N_REMATCH_SECRET`과 n8n Docker `.env` 값이 같아야 push 트리거가 통과합니다(불일치 시 신규 등록해도 매칭이 안 도는 대표 증상). 시크릿 회전 시 n8n 컨테이너 재기동 필요.

### Graceful degradation (장애 내성)

- **NVD/CPE 외부 호출**: 실패 시 빈 결과 반환 → 등록 흐름을 막지 않음(7일 캐시)
- **AI/Vectorize 부재**: `embedding_status='unavailable'`로 기록하고 계속 진행, 의미 매칭은 빈 결과
- **감사 로그·로그인 잠금**: 실패해도 throw하지 않음(fail-safe). 단, 잠금은 fail-open이므로 `login_attempts` 테이블 존재를 모니터링해야 보호가 보장됨

### 운영 체크리스트

- [ ] `SESSION_SECRET`·`API_KEY` 설정 확인(미설정 시 로그인/연동 불가)
- [ ] 마이그레이션 0001~0012를 `d1 execute --file --remote`로 적용(`migrations apply` 금지)
- [ ] 최초 admin 부트스트랩 완료
- [ ] Vectorize 인덱스 768차원·코사인으로 생성
- [ ] n8n `N8N_REMATCH_SECRET` ↔ Worker 시크릿 값 일치
- [ ] `API_KEY` 로테이션 정책 수립(전 그룹사 접근 권한)

---

## 14. 개발 및 테스트

```bash
npm run dev          # 로컬 개발 서버 (wrangler dev)
npm test             # 단위/통합 테스트 (vitest run)
npm run cf-typegen   # 바인딩 타입 생성
```

- 테스트는 Node 환경에서 실행됩니다(`node:sqlite` 사용 — Node 22+ 필요).
- 단위/통합 테스트: `src/**/*.test.ts`, `test/**/*.test.ts`
- E2E·스크린샷 검증: Playwright (`verify/` 디렉터리 스크립트)

---

## 15. 디렉터리 구조

```
vuln-monitor-web/
├── src/
│   ├── index.ts              # Worker 엔트리: 라우트 마운트 + Cron 핸들러
│   ├── types.ts              # Bindings(Env) + 도메인 타입 정의
│   ├── middleware/
│   │   ├── auth.ts           # 세션/Bearer 인증 게이트
│   │   └── permissions.ts    # RBAC + 그룹사 스코핑 헬퍼
│   ├── routes/               # HTTP 핸들러
│   │   ├── auth.tsx          # 로그인/로그아웃
│   │   ├── web.tsx           # 대시보드/솔루션/이력 (HTML)
│   │   ├── groups.tsx        # 그룹사 선택/생성/삭제
│   │   ├── admin.tsx         # 사용자 관리 + 부트스트랩
│   │   ├── account.tsx       # 내 계정/비밀번호 변경
│   │   ├── solutions.ts      # 솔루션 CRUD (/api/solutions)
│   │   ├── bulk.ts           # 대량 등록 (/api/solutions/bulk)
│   │   ├── vulns.ts          # 매칭 수신 (/api/vulns)
│   │   ├── match.ts          # 의미 매칭 (/api/match)
│   │   ├── cpe.ts            # CPE 추천 (/api/cpe)
│   │   └── widgets.ts        # 대시보드 위젯
│   ├── lib/                  # 도메인 로직 + D1 헬퍼
│   │   ├── assets.ts         # 부모 자산 CRUD/backfill/집계
│   │   ├── asset-mapping.ts  # 장비 → 컴포넌트 자동 분해
│   │   ├── impact-system.ts  # 영향시스템 추론
│   │   ├── normalize.ts      # 매칭 키 정규화 + 별칭 생성 (SSOT)
│   │   ├── cpe.ts            # NVD CPE 조회/캐시
│   │   ├── embeddings.ts     # bge-m3 임베딩 + Vectorize
│   │   ├── rematch.ts        # n8n 웹훅 트리거
│   │   ├── vuln-status.ts    # 수동 취약 상태 관리
│   │   ├── history.ts        # 조치 이력 조회
│   │   ├── users.ts          # 사용자 + 그룹사 매핑
│   │   ├── password.ts       # PBKDF2 해싱
│   │   ├── password-policy.ts# 비밀번호 정책
│   │   ├── login-attempts.ts # 로그인 잠금/정리
│   │   ├── active-group.ts   # 활성 그룹 쿠키
│   │   ├── group-companies.ts# 그룹사 레지스트리
│   │   ├── audit.ts          # 감사 로그
│   │   ├── csv.ts            # CSV 파서(RFC 4180)
│   │   └── widgets.ts        # 위젯 CRUD
│   └── views/                # Hono JSX 화면 컴포넌트
├── migrations/               # D1 마이그레이션 0001 ~ 0012
├── docs/                     # 운영 플레이북 + 설계 스펙
├── test/                     # 통합/렌더 테스트
├── verify/                   # Playwright 스크린샷 검증
├── wrangler.jsonc            # Worker 설정(바인딩/Cron/시크릿 주석)
└── package.json
```

---

## 16. 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| v2.3 | 멀티테넌시 키 도입 + 매칭 중복 제거 |
| v2.4 | Workers AI + Vectorize 의미 매칭 도입 |
| v2.5 | 다중 카테고리 + CPE 2.3 URI 지원 |
| v3.0 | 다중 사용자 인증 + 그룹사 권한 + 대시보드 위젯 |
| v3.1 | 부모 자산(asset) 2계층 모델 |
| v3.2 | 수동 취약 상태 오버라이드 |
| v3.3 | 영향시스템 분류축(6종) |
| v3.4 | 부서/담당자 분리 + UI premium polish |
| v3.5 | 로그인 보안(레이트리밋·잠금) + Cron 정리 |
| v3.6 | 그룹사 정규 레지스트리 + 선택 화면 |
| v3.7 | 조치 이력 성능 인덱스 |

---

<sub>본 문서는 코드베이스(`src/`, `migrations/`, `wrangler.jsonc`) 분석을 기반으로 작성되었습니다. 보안 운영 환경에서 사용하기 전 시크릿 설정과 멀티테넌시 스코핑을 반드시 검증하세요.</sub>
