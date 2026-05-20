-- /api/audit per-IP daily rate limit
--
-- v1.13–1.14 added inline signup + MCP soft-CTA, but /api/audit (the CLI's
-- primary endpoint) remained anonymous-unlimited. Despite advertising
-- "X-RateLimit-Limit: 200" in response headers, no IP-based enforcement
-- existed on /api/audit. Result: CLI users — including the heavy ones
-- most likely to convert — never felt upgrade pressure.
--
-- Mirrors mcp_rate_limits exactly (table shape + threshold semantics).
-- Tiers (UTC day, reset at 00:00):
--   1   – 40    no CTA, normal response
--   41  – 80    response + soft `_cta` field appended
--   81  – 100   response + stronger `_cta` field
--   101 +       hard 429 with upgrade URL
--
-- API key holders (Authorization: Bearer sk_commit_…) bypass entirely.
--
-- See diagnosis: /workspace/commit/conversion-gap-diagnosis-2026-05-20.md

CREATE TABLE IF NOT EXISTS audit_rate_limits (
  ip TEXT NOT NULL,
  date TEXT NOT NULL,     -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, date)
);

CREATE INDEX IF NOT EXISTS idx_audit_rate_limits_date ON audit_rate_limits(date);
