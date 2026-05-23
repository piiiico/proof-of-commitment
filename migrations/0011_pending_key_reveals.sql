-- Stores the raw API key briefly so the checkout success page can reveal it
-- inline (mirrors the inline-reveal pattern used by /pricing/ waitlist and
-- /get-started/ free signup since 2026-05-23). Written by the Stripe webhook
-- (checkout.session.completed). Read + marked revealed once by
-- GET /api/checkout/session. After reveal, raw_key is nulled.
--
-- Cleanup: rows older than 24h should be pruned by the daily cron — the raw
-- key is no longer useful after the success page has already loaded.

CREATE TABLE IF NOT EXISTS pending_key_reveals (
  session_id TEXT PRIMARY KEY,
  raw_key TEXT,                                      -- nulled on first reveal
  email TEXT NOT NULL,                               -- for audit + email backup
  tier TEXT NOT NULL,                                -- 'pro' | 'developer'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revealed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_key_reveals_created_at ON pending_key_reveals(created_at);
