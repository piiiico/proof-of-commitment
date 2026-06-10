-- Self-hosted pageview tracking — replaces broken CF Web Analytics.
--
-- Why this migration exists
-- ─────────────────────────
-- 2026-06-10: confirmed Cloudflare Web Analytics is silently producing zero
-- data account-wide. POST /cdn-cgi/rum returns 404 on the live beacon; only
-- 20 visits ingested across the whole account in 30 days (none for
-- getcommit.dev, despite npm downloads at ~1,120/wk and 75 API keys created).
-- The daily commit-report has been showing "0 visits today/7d" for weeks
-- while reality is unknown — exactly the silently-hides-data failure mode
-- called out in CLAUDE.md "operator can't diagnose what they can't see."
--
-- This table is the replacement substrate. A tiny first-party beacon on the
-- landing pages POSTs to /api/v1/visit on poc-backend; that handler writes
-- one row here. Coupled with utm_campaign on the four 2026-06-10 surfaces
-- (audit-overshoot, audit-compromised-key, audit-web-compromised, key-upgrade),
-- this restores funnel-attribution visibility before the pricing-friction-v1
-- 30-day measurement (task 05b4b20aa57ddd09) is due 2026-06-20.
--
-- Privacy: ip_hash is SHA-256(ip || daily_salt). Daily salt rotation means
-- hashes can't be joined across days — supports unique-visitor counts within
-- a day without storing reversible PII across days. No raw IPs, no cookies,
-- no fingerprinting.

CREATE TABLE IF NOT EXISTS pageviews (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  host          TEXT NOT NULL,          -- request host (e.g. getcommit.dev)
  path          TEXT NOT NULL,          -- pathname only (no query)
  referrer_host TEXT,                   -- parsed hostname from Referer
  utm_source    TEXT,
  utm_campaign  TEXT,
  utm_medium    TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  ua_browser    TEXT,                   -- coarse bucket: chrome/firefox/safari/edge/other
  ua_device     TEXT,                   -- desktop/mobile/tablet/bot
  country       TEXT,                   -- CF cf.country (2-letter)
  ip_hash       TEXT                    -- SHA-256(ip || YYYY-MM-DD-salt) hex
);

CREATE INDEX IF NOT EXISTS idx_pageviews_created_at  ON pageviews(created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_host        ON pageviews(host);
CREATE INDEX IF NOT EXISTS idx_pageviews_utm_campaign ON pageviews(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_pageviews_path        ON pageviews(path);
