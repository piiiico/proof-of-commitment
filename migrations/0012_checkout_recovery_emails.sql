-- Abandonment-recovery email dedupe. One row per Stripe session_id where
-- checkout.session.expired fired and we sent a recovery email. Webhook uses
-- INSERT OR IGNORE → if rowcount=0, recovery was already sent (idempotent
-- across Stripe webhook retries).

CREATE TABLE IF NOT EXISTS checkout_recovery_emails (
  session_id TEXT PRIMARY KEY,                       -- Stripe cs_live_* / cs_test_*
  email TEXT NOT NULL,                               -- plaintext (matches checkout_leads.email)
  tier TEXT NOT NULL,                                -- 'pro' | 'developer'
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkout_recovery_emails_sent_at ON checkout_recovery_emails(sent_at);
