# Proof of Commitment

## What this is
A browser extension that captures verifiable behavioral data — proof that real people spend real time and money at real businesses. Anonymous, cryptographically verified, aggregated. The output: trust signals that AI can query instead of relying on reviews and content.

## The thesis
Content is free to fake. Commitment is not. A repeat customer is a stronger signal than a thousand five-star reviews. We prove commitment without revealing identity.

## Architecture (v1)
```
Browser extension (Chrome Manifest V3)
  ├── World ID login (proof of unique person)
  ├── Passive: tracks page visits + time (stored locally)
  ├── Active: zkTLS proof on order confirmations / bookings
  ├── Semaphore: anonymous submission (unlinkable per business)
  └── Backend: aggregates per business → API / MCP server
```

### Key decisions (2026-03-22)
- **Unlinkable claims**: Semaphore nullifiers scoped per business. No cross-business patterns. No de-anonymization risk. No graph needed for v1.
- **Live data, not historical**: Extension captures behavior as it happens. No PSD2/bank API dependency.
- **No blockchain for v1**: Simple backend aggregation via Prio/DAP or equivalent.
- **No PageRank for v1**: Simple aggregates ("147 verified repeat customers") are already more trustworthy than anything existing.
- **World ID for MVP**: Free, global, SDK ready. BankID as upgrade path for Norwegian market.

## Deployment (2026-03-23)
- **Backend**: Cloudflare Workers + D1 (SQLite). URL: `https://poc-backend.amdal-dev.workers.dev`
- **D1 database**: `poc-commits` (ID: `6ef7b6a9-1d09-4a0f-9ddd-c869a0582460`)
- **Deploy**: `bun run deploy` (builds worker, uploads via CF REST API — bypasses wrangler silent-failure)
- **Local dev**: `bun run dev:backend` (uses `src/backend/server.ts` + `db.ts` with bun:sqlite)
- **Production**: `src/backend/worker.ts` (CF Workers + D1 bindings, same API surface)
- **MCP server**: `bun run start:mcp` (queries prod backend by default)

### World ID blocker
- `src/extension/auth.ts` has `WORLD_ID_APP_ID = "app_PLACEHOLDER"` — not functional yet
- Håkon needs to register at https://developer.worldcoin.org (browser auth required)
- Steps: Create app → get `app_id` → set redirect URI to `chrome.identity.getRedirectURL('/callback')` → replace placeholder in auth.ts
- Extension tracks time + syncs to backend without auth, but World ID is needed for verified person proof

## Tech stack
- **Runtime**: Bun + TypeScript
- **Extension**: Chrome Manifest V3
- **Identity**: World ID (OIDC)
- **ZK proofs**: Reclaim Protocol (zkTLS), Semaphore V4 (anonymity)
- **Backend**: CF Workers + D1 (prod), Bun + SQLite (dev)

## Conventions
- Small commits, often
- Both Håkon and Pico push to main
- Always `git pull` before working
- Read files before editing — codebase may have changed
- `knowledge/` folder is an Obsidian vault — use `[[wikilinks]]` in docs

## Don't
- Don't add blockchain/token infrastructure yet
- Don't over-engineer aggregation — simple counts first
- Don't build graph computation — that's v2
- Don't add bank/PSD2 integration — live extension data first
