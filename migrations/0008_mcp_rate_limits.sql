-- MCP per-IP daily rate limit
--
-- The remote MCP endpoint at /mcp serves anonymous queries (Cursor / Claude
-- Desktop / Cline clients). v1.13 had no rate limit — power users could pull
-- value indefinitely without ever signing up. v1.14 introduces a soft CTA at
-- 41+ queries/day/IP and a hard block at 101+ to convert MCP traffic into
-- API key signups (source='mcp-soft-cta').
--
-- Limits (UTC day, reset at 00:00):
--   1   – 40    no CTA, normal response
--   41  – 80    response + soft CTA appended
--   81  – 100   response + stronger CTA appended
--   101 +       hard block with API-key URL
--
-- API key holders (Authorization: Bearer sk_commit_…) bypass these limits.

CREATE TABLE IF NOT EXISTS mcp_rate_limits (
  ip TEXT NOT NULL,
  date TEXT NOT NULL,     -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, date)
);

CREATE INDEX IF NOT EXISTS idx_mcp_rate_limits_date ON mcp_rate_limits(date);
