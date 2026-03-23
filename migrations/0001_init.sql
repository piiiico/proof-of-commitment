-- Proof of Commitment — D1 schema
-- Mirrors db.ts (local Bun + SQLite) for production deployment

CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  visit_count INTEGER NOT NULL,
  total_seconds INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_commitments_domain
  ON commitments(domain);

CREATE TABLE IF NOT EXISTS domain_stats (
  domain TEXT PRIMARY KEY,
  unique_commitments INTEGER NOT NULL DEFAULT 0,
  total_visits INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  avg_visits REAL NOT NULL DEFAULT 0,
  avg_seconds REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);
