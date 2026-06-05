-- v3.0 다중 운영자 인증 + 그룹사 권한 + 공유 대시보드 위젯
-- 모든 ALTER 는 ADD COLUMN(NULL 허용) 또는 신규 테이블만 사용 → 기존 데이터에 무해.

-- ============================================================
-- 1) users — 단일 계정 정보
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,        -- "saltHex$hashHex" (PBKDF2-SHA256 100k iter, 16B salt)
  display_name    TEXT,
  role            TEXT NOT NULL DEFAULT 'operator',  -- 'admin' | 'operator' | 'system'
  is_active       INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 1,        -- 비번 변경/비활성화 시 ++ (세션 무효화)
  last_login_at   DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username, is_active);

-- ============================================================
-- 2) user_group_companies — 다대다 매핑
--    한 사용자가 여러 그룹사를 담당할 수 있고, 한 그룹사를 여러 사용자가 담당할 수도 있음.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_group_companies (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_company  TEXT NOT NULL,
  PRIMARY KEY (user_id, group_company)
);
CREATE INDEX IF NOT EXISTS idx_ugc_group ON user_group_companies(group_company);

-- ============================================================
-- 3) dashboard_widgets — 공유 위젯 (필터 프리셋 + 노트)
-- ============================================================
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  widget_type         TEXT NOT NULL,    -- 'filter_preset' | 'note'
  title               TEXT NOT NULL,
  config_json         TEXT NOT NULL,    -- {group_company?, category?, min_severity?} 또는 {content, color?}
  widget_order        INTEGER DEFAULT 0,
  is_hidden           INTEGER DEFAULT 0,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_widgets_type_order ON dashboard_widgets(widget_type, widget_order);

-- ============================================================
-- 4) 기존 NULL group_company 백필 → 'system'
--    이후 admin 이 UI 에서 적절히 그룹사로 이관 가능.
-- ============================================================
UPDATE solutions
   SET group_company = 'system'
 WHERE group_company IS NULL
    OR TRIM(group_company) = '';

-- ============================================================
-- 5) 시스템 사용자 부트스트랩 — n8n Bearer 토큰 매핑용
--    password_hash 가 PBKDF2 형식이 아니므로 비번 로그인 불가능 (verifyPassword 실패).
-- ============================================================
INSERT OR IGNORE INTO users (username, password_hash, display_name, role, is_active)
VALUES ('_system_automation', 'disabled$disabled', 'n8n / System Automation', 'system', 1);
