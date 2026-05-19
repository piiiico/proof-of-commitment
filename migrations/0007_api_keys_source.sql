-- API Keys: source attribution for funnel measurement
--
-- Tracks where each API key was created from:
--   'web'           — getcommit.dev signup form (default)
--   'cli'           — inline CLI signup (v1.13.x — TTY prompt after CRITICAL finding)
--   'mcp-soft-cta'  — MCP power user converted via /mcp soft CTA (v1.14.x)
--   'api'           — programmatic creation
--
-- History: This ALTER was applied directly to the production D1 (poc-commits)
-- on 2026-05-19 ahead of source commit. This file captures the schema state
-- so new D1 instances built from `migrations/` will match production.
-- SQLite has no `ALTER TABLE ... IF NOT EXISTS` — applying twice on the same
-- DB will fail with "duplicate column name: source". Either apply once to a
-- fresh DB, or skip on prod (already applied).

ALTER TABLE api_keys ADD COLUMN source TEXT NOT NULL DEFAULT 'web';

CREATE INDEX IF NOT EXISTS idx_api_keys_source ON api_keys(source);
