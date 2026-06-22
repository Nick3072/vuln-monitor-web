-- v3.5 로그인 보안 강화 → 로그인 시도 감사 로그(login_attempts) 도입
-- IP·계정 단위 실패 누적으로 계정 잠금(15분 윈도우, 5회) 판정 + 90일 보존 후 정리.

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, ip TEXT, user_agent TEXT,
  success INTEGER NOT NULL, reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE INDEX IF NOT EXISTS idx_la_ip_user_time ON login_attempts(ip, username, created_at);
CREATE INDEX IF NOT EXISTS idx_la_time ON login_attempts(created_at);
