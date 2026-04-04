# Commit

## What this is
A browser extension that captures and surfaces real trust signals. Your browsing behavior proves trust — time spent, repeat visits, engagement patterns. Anonymous, verified by World ID. The output: commitment data that AI and humans can query instead of relying on reviews and content.

## The thesis
Content is free to fake. Commitment is not. A repeat customer is a stronger signal than a thousand five-star reviews. We prove commitment without revealing identity.

## Architecture (v0.2)
```
Browser extension (Chrome Manifest V3, branded "Commit")
  ├── World ID login (proof of unique person)
  ├── Site-contextual popup (trust signals for current domain)
  ├── Content script (trust badge injected on pages with data)
  ├── Passive: tracks page visits + time (stored locally)
  ├── Contributing toggle (user controls data sharing)
  ├── Brreg integration (Norwegian business registry, .no domains)
  ├── Active: zkTLS proof on order confirmations / bookings (v0.3)
  ├── Semaphore: anonymous submission (unlinkable per business) (v0.3)
  └── Backend: aggregates per business → API / MCP server
```

### Key decisions
- **Site-contextual UI**: Popup shows trust data for the current tab's domain, not a personal dashboard. Your data + network data together.
- **Contribute/consume duality**: Extension both captures your commitments AND surfaces trust from other verified humans.
- **Contributing toggle**: Users control whether their data syncs to the network. Default on, can be turned off.
- **Brreg as ONE feature**: Norwegian business registry data surfaces on .no domains. Not the product — one enrichment source.
- **Unlinkable claims**: Semaphore nullifiers scoped per business (v0.3).
- **Live data, not historical**: Extension captures behavior as it happens.
- **No blockchain for v1**: Simple backend aggregation.
- **World ID for MVP**: Free, global, SDK ready. BankID as upgrade path.

## Deployment (2026-03-23)
- **Backend**: Cloudflare Workers + D1 (SQLite). URL: `https://poc-backend.amdal-dev.workers.dev`
- **D1 database**: `poc-commits` (ID: `6ef7b6a9-1d09-4a0f-9ddd-c869a0582460`)
- **Deploy**: `bun run deploy` (builds worker, uploads via CF REST API — bypasses wrangler silent-failure)
- **Local dev**: `bun run dev:backend` (uses `src/backend/server.ts` + `db.ts` with bun:sqlite)
- **Production**: `src/backend/worker.ts` (CF Workers + D1 bindings, same API surface)
- **MCP server (local)**: `bun run start:mcp` (stdio, queries prod backend)
- **MCP server (remote)**: `https://poc-backend.amdal-dev.workers.dev/mcp` (Streamable HTTP, stateless)

### World ID
- `src/extension/auth.ts` configured with real app_id: `app_a2868bad17534bb7e8bc82de8df73773`
- Redirect URI still needs to be set in World ID Developer Portal to `chrome.identity.getRedirectURL('/callback')` after extension is loaded in Chrome
- Extension tracks time + syncs to backend without auth, but World ID verifies unique personhood

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
