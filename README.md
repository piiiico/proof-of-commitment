# Proof of Commitment

> **Content is free to fake. Commitment is not.**

A browser extension that captures verifiable behavioral data — proof that real people spend real time at real businesses. Anonymous, cryptographically verified, AI-queryable.

## The Problem

Reviews are fake. Ratings are gamed. Any content-based signal can be manufactured at scale.

But commitment cannot be faked cheaply. A person who visits the same restaurant 12 times in 30 days is a real signal — harder to fake than a thousand five-star reviews.

**Proof of Commitment replaces opinion with behavior.**

## Demo

![Proof of Commitment — E2E Demo](demo.gif)

*World ID identity → commitment submission → aggregated stats → MCP tool output*

## Architecture

```
Browser Extension (Chrome Manifest V3)
  ├── World ID login      — proof of unique person (1 human = 1 account)
  ├── Passive tracking    — domain visits + time (stored locally first)
  └── Anonymous submit    — behavioral signals sent without linking identity

Backend (Cloudflare Workers + D1)
  ├── POST /api/commit    — receive anonymized behavioral data
  └── GET  /api/domain/:domain — return aggregate: unique visitors, repeat rate, avg time

MCP Server
  └── query_commitment({ domain }) — AI agents can ask "how many real humans visit X?"
```

No user IDs stored. No surveillance. Signal without identity.

## What gets proven

When a user submits a commitment, the backend stores:
- `domain`: the website visited
- `visitCount`: number of visits in the window
- `totalSeconds`: total time spent
- `firstSeen` / `lastSeen`: timestamps

What it does **not** store: user IDs, World ID sub values, IP addresses, browsing history, or any cross-domain linkage.

The result: **"6 verified unique visitors, 47 total visits, 87% repeat rate"** — a trust signal that's structurally harder to fake than any review.

## Quick Start

```bash
# Install dependencies
bun install

# Run the E2E test (verifies the full flow with mock World ID)
bun run test:e2e
```

The E2E test proves the architecture without external dependencies:

1. **Mock World ID** — starts a local OIDC provider that issues signed JWTs (RSA-256)
2. **Identity verification** — creates 5 verified unique persons, verifies JWT signatures
3. **Behavioral simulation** — simulates browsing patterns across domains
4. **Commitment submission** — posts anonymized data to the backend
5. **Aggregation query** — queries per-domain stats via REST API
6. **MCP tool** — same query surface available to AI models
7. **Architecture check** — confirms anonymity properties hold

All 7 steps should pass. The only missing piece for production is a real World ID `app_id`.

## Running the demo

```bash
# Run the demo script (used to generate demo.gif)
bash demo.sh

# Or use asciinema to record it yourself
asciinema rec --command "bash demo.sh" demo.cast
```

## MCP Integration

Add to your MCP config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "proof-of-commitment": {
      "command": "bun",
      "args": ["run", "/path/to/proof-of-commitment/src/mcp/server.ts"],
      "env": {
        "BACKEND_URL": "https://poc-backend.amdal-dev.workers.dev"
      }
    }
  }
}
```

Then ask your AI:
> "How many real people regularly visit peppes-pizza.no?"

The `query_commitment` tool returns:
```
Domain: peppes-pizza.no
Verified unique visitors: 6
Total visits: 47
Repeat visit rate: 87%
Average time per visitor: 3 minutes
```

## Deployment

```bash
# Deploy backend to Cloudflare Workers
bun run deploy

# Backend URL: https://poc-backend.amdal-dev.workers.dev
```

## Production Blocker

The Chrome extension requires a real World ID `app_id`:

1. Go to [developer.worldcoin.org](https://developer.worldcoin.org)
2. Create an app → get `app_id`
3. Set redirect URI to `chrome.identity.getRedirectURL('/callback')`
4. Replace `app_PLACEHOLDER` in `src/extension/auth.ts`

Until then, the extension tracks domain visits without identity verification. The E2E test uses a mock World ID that proves the architecture works.

## Stack

| Layer | Technology |
|-------|-----------|
| Identity | World ID (OIDC, RSA-256 JWTs) |
| Browser | Chrome Manifest V3 extension |
| Backend | Hono + Bun (dev), Cloudflare Workers + D1 (prod) |
| AI interface | MCP (Model Context Protocol) |
| ZK (future) | Reclaim Protocol (zkTLS), Semaphore V4 |

## Roadmap

- [x] Backend aggregation (CF Workers + D1)
- [x] E2E test with mock World ID
- [x] MCP server
- [ ] Real World ID `app_id` (needs browser registration)
- [ ] Chrome extension packaging
- [ ] zkTLS proofs for purchase verification (Reclaim Protocol)
- [ ] Unlinkable submissions via Semaphore V4
