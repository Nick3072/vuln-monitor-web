CREATE TABLE IF NOT EXISTS solutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  category TEXT NOT NULL,
  current_version TEXT NOT NULL,
  hostname TEXT,
  owner TEXT,
  notes TEXT,
  is_vulnerable INTEGER DEFAULT 0,
  last_matched_cve TEXT,
  last_matched_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matched_vulns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solution_id INTEGER REFERENCES solutions(id) ON DELETE CASCADE,
  cve_id TEXT,
  source TEXT,
  severity TEXT,
  title TEXT,
  description TEXT,
  url TEXT,
  published DATE,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT,
  target_table TEXT,
  target_id INTEGER,
  actor TEXT,
  payload_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_solutions_vuln ON solutions(is_vulnerable);
CREATE INDEX IF NOT EXISTS idx_solutions_vendor ON solutions(vendor, product);
CREATE INDEX IF NOT EXISTS idx_matched_cve ON matched_vulns(cve_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);