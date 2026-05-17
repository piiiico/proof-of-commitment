-- Proof of Commitment — Migration 0005
-- Commit Pro: continuous dependency monitoring tables.
-- Spec: /workspace/commit/monitoring-product-spec.md

-- Monitored projects (one per registered collection)
CREATE TABLE IF NOT EXISTS monitored_projects (
  id TEXT PRIMARY KEY,                    -- ULID
  api_key_id TEXT NOT NULL,               -- References api_keys.id
  name TEXT NOT NULL,                     -- User-facing project name
  github_repo TEXT,                       -- 'owner/repo' if auto-imported (NULL for manual)
  alert_webhook TEXT,                     -- POST URL for score change alerts
  alert_email TEXT,                       -- Email for notifications
  threshold_critical INTEGER DEFAULT 30,  -- Score below this = CRITICAL alert
  threshold_warn INTEGER DEFAULT 50,      -- Score below this = WARNING alert
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at TEXT,                         -- Non-null = skip scanning
  UNIQUE(api_key_id, name)
);

-- Individual packages within a project
CREATE TABLE IF NOT EXISTS monitored_packages (
  id TEXT PRIMARY KEY,                    -- ULID
  project_id TEXT NOT NULL REFERENCES monitored_projects(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,             -- e.g. 'express', 'requests'
  ecosystem TEXT NOT NULL,                -- 'npm' | 'pypi'
  current_score INTEGER,                  -- Latest score (NULL before first scan)
  previous_score INTEGER,                 -- Score from previous scan
  risk_level TEXT,                        -- 'HEALTHY' | 'MODERATE' | 'CRITICAL'
  last_scanned_at TEXT,                   -- ISO 8601
  UNIQUE(project_id, package_name, ecosystem)
);

-- Score history for trend analysis
CREATE TABLE IF NOT EXISTS score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id TEXT NOT NULL REFERENCES monitored_packages(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alert log (for debugging and preventing duplicate alerts)
CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES monitored_projects(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  alert_type TEXT NOT NULL,               -- 'score_drop' | 'critical_threshold' | 'recovery'
  old_score INTEGER,
  new_score INTEGER,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_status TEXT DEFAULT 'sent'     -- 'sent' | 'failed' | 'suppressed'
);

-- Indexes for scan performance
CREATE INDEX IF NOT EXISTS idx_mp_project ON monitored_packages(project_id);
CREATE INDEX IF NOT EXISTS idx_sh_package ON score_history(package_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_al_project ON alert_log(project_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_monitored_projects_key ON monitored_projects(api_key_id);
