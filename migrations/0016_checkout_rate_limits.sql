-- /api/checkout and /api/checkout-intent per-IP hourly rate limit
--
-- Bot analysis (2026-05-28): ~100 Stripe checkout sessions/day from automated
-- requests hitting poc-backend.amdal-dev.workers.dev/api/checkout directly,
-- bypassing the getcommit.dev proxy. Bot creates sessions in bursts of 3,
-- from multiple IPs (4 IPs observed in single-hour peak at 08:00 UTC).
-- Each fake open session creates noise; the bot appears to be evaluating
-- whether the checkout flow exists, not attempting real purchases.
--
-- Limit: 3 checkout sessions per IP per 1-hour sliding window.
-- reset_at stores when the current window expires (first_request + 1 hour).
-- Schema uses reset_at expiry pattern (vs calendar-hour bucketing) because
-- D1's SQLite dialect reserves common column names (hour, window, date)
-- in the context of CREATE INDEX.
--
-- Behaviour:
--   count <= 3  → pass through (redirect to Stripe)
--   count > 3   → HTTP 429, redirect to /pricing?error=rate_limit_exceeded
--
-- No soft CTA — checkout is the conversion step, not a free-tier feature.
-- Old rows auto-expire logically (reset_at check); no pruning required
-- for correctness, but can DELETE WHERE reset_at < datetime('now', '-2 days').
--
-- See: bot-analysis-2026-05-28, working memory checkout-bot-sessions.

CREATE TABLE IF NOT EXISTS checkout_rate_limits (
  ip       TEXT NOT NULL PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);
