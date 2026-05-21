-- Checkout lead capture: store email before Stripe redirect so abandoned
-- checkouts are queryable. Written by POST /api/checkout-intent.

CREATE TABLE IF NOT EXISTS checkout_leads (
  id TEXT PRIMARY KEY,                              -- nanoid
  email_hash TEXT NOT NULL,                         -- SHA-256(email) for dedup/lookup
  email TEXT NOT NULL,                              -- plaintext for admin view
  tier TEXT NOT NULL,                               -- 'pro' | 'developer'
  source TEXT NOT NULL DEFAULT 'pricing-modal',     -- where lead came from
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkout_leads_created_at ON checkout_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_checkout_leads_email_hash ON checkout_leads(email_hash);
