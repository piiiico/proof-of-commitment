-- Watchlist email subscriptions
-- Users subscribe to receive weekly supply chain risk alerts for their packages

CREATE TABLE IF NOT EXISTS watchlist_subscriptions (
  id TEXT PRIMARY KEY,                              -- nanoid
  email TEXT NOT NULL UNIQUE,                       -- subscriber email (one record per email)
  packages TEXT NOT NULL DEFAULT '[]',              -- JSON array of package names
  verified INTEGER NOT NULL DEFAULT 1,              -- 1 = confirmed (simple opt-in for now)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at TEXT                                 -- NULL until first digest sent
);

CREATE INDEX IF NOT EXISTS idx_watchlist_email ON watchlist_subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_watchlist_verified ON watchlist_subscriptions(verified);
