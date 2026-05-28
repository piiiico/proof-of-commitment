-- /api/audit/github per-IP daily rate limit
--
-- Buyer-journey audit (2026-05-28, second pass after the /api/graph fix in
-- migration 0014) found another paid-feature leak. The /pricing page lists
-- "GitHub repo audit — 50 req/month" under Developer ($15/mo) and
-- "GitHub repo audit — 500 req/month" under Pro ($29/mo). It is NOT in the
-- Open free tier feature list. But POST /api/audit/github was completely
-- unauthenticated and unlimited — anyone with the worker URL could fetch a
-- whole-repo dependency audit (package.json + requirements.txt walk, scored
-- via the slow path) without ever seeing a paywall.
--
-- Same shape as graph_rate_limits (migration 0014) and audit_rate_limits
-- (migration 0009). Tighter ceiling than graph because the github endpoint
-- is even more clearly paid: free tier has no mention at all, vs the graph
-- endpoint at least implies an interactive-discovery story.
--
-- Limits (UTC day, reset at 00:00):
--   1   – 2     normal response
--   3+         hard 429 with upgrade URL pointing at /pricing (Developer tier)
--
-- No soft-CTA tier — at 2 free repos/day the value is already demonstrated;
-- the third call should hit the wall, not a nag. Mirrors the rationale in
-- worker.ts (GITHUB_AUDIT_* constants).
--
-- API key holders (Authorization: Bearer sk_commit_…) bypass entirely.
-- Pages SSR bypass via X-SSR-Token matches ADMIN_SECRET.
--
-- See: monetization-strategy.md (Apr 19), buyer-journey-2026-05-28,
-- migration 0014_graph_rate_limits.sql.

CREATE TABLE IF NOT EXISTS github_audit_rate_limits (
  ip TEXT NOT NULL,
  date TEXT NOT NULL,     -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, date)
);

CREATE INDEX IF NOT EXISTS idx_github_audit_rate_limits_date ON github_audit_rate_limits(date);
