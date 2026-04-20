-- API Keys table for self-serve conversion flow
-- Phase 0: email + API key, no Stripe yet

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,                              -- nanoid
  key_hash TEXT NOT NULL UNIQUE,                    -- SHA-256 of full key (hex)
  key_prefix TEXT NOT NULL,                         -- "sk_commit_a1b2c3d4e5f6" for display (first 12 chars)
  email TEXT NOT NULL,                              -- owner email
  tier TEXT NOT NULL DEFAULT 'free',                -- 'free' | 'pro' | 'enterprise'
  requests_this_period INTEGER NOT NULL DEFAULT 0,  -- usage counter
  period_reset_at TEXT NOT NULL,                    -- ISO timestamp for counter reset
  stripe_customer_id TEXT,                          -- NULL until Stripe connected
  stripe_subscription_id TEXT,                      -- NULL until subscribed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,                                -- track activity
  revoked_at TEXT                                   -- soft delete
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);
CREATE INDEX IF NOT EXISTS idx_api_keys_stripe ON api_keys(stripe_customer_id);

-- IP rate limiting table for key creation (3 per IP per day)
CREATE TABLE IF NOT EXISTS key_creation_rate_limits (
  ip TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL,
  PRIMARY KEY (ip)
);
