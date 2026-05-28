-- /api/graph per-IP daily rate limit
--
-- Buyer-journey audit (2026-05-28) diagnosed: /pricing advertises
-- "Dependency graph analysis — 200 req/month" as a Pro ($29/mo) feature,
-- but /api/graph/npm/* was completely unauthenticated and unlimited. The
-- highest-value endpoint (transitive risk graph — reveals hidden CRITICAL
-- deps two levels deep) was being given away to anonymous traffic. This
-- closed the page-vs-implementation gap that was kneecapping conversion
-- pressure from individual devs landing via awesome-mcp-servers (87K stars,
-- merged 2026-05-27).
--
-- Limits (UTC day, reset at 00:00):
--   1   – 2     no CTA, normal response
--   3            response + soft `_cta` field appended (last free shot)
--   4+           hard 429 with upgrade URL pointing at /pricing (Pro tier)
--
-- API key holders (Authorization: Bearer sk_commit_…) bypass entirely —
-- their tier quota in TIER_LIMITS governs total /api/* usage. A future
-- migration can split per-endpoint quotas for paid tiers; v1 just plugs
-- the anonymous leak.
--
-- See: monetization-strategy.md (Apr 19), buyer-journey-2026-05-28.

CREATE TABLE IF NOT EXISTS graph_rate_limits (
  ip TEXT NOT NULL,
  date TEXT NOT NULL,     -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, date)
);

CREATE INDEX IF NOT EXISTS idx_graph_rate_limits_date ON graph_rate_limits(date);
