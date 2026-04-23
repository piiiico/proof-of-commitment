-- Package score history for weekly diff tracking
-- Stores weekly snapshots so the digest email can show score changes

CREATE TABLE IF NOT EXISTS package_score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,
  ecosystem TEXT NOT NULL DEFAULT 'npm',
  score INTEGER,
  maintainers INTEGER,
  weekly_downloads INTEGER,
  risk_flags TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["CRITICAL","HIGH","WARN"]
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_psh_pkg_time
  ON package_score_history(package_name, ecosystem, recorded_at DESC);
