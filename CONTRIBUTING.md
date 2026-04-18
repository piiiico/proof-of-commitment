# Contributing to Proof of Commitment

Thanks for your interest. The project is early-stage (1 star, ~200 dl/wk), so contributions move fast and get noticed.

## Stack

- **Runtime:** Bun 1.x + TypeScript
- **Backend:** Cloudflare Workers + D1 (SQLite)
- **Extension:** Chrome Manifest V3
- **MCP:** Model Context Protocol SDK

## Run locally

```bash
git clone https://github.com/piiiico/proof-of-commitment
cd proof-of-commitment
bun install
bun run dev:backend     # local server on port 3000, uses in-process SQLite
bun run test:e2e        # E2E test against local server
```

The backend exposes the same API surface locally and in production — all `src/backend/server.ts` routes work out of the box.

## How scoring works

Each package is scored 0–100 across 5 dimensions in `src/backend/{npm,pypi,github}.ts`:

| Dimension | Points | Source |
|-----------|--------|--------|
| Longevity | 25 | First release date |
| Download momentum | 25 | Recent weekly downloads + trend |
| Release consistency | 20 | Version count + publish cadence |
| Maintainer depth | 15 | Number of active maintainers |
| GitHub backing | 15 | Linked repo commit frequency |

## Add a new scoring dimension

1. Pick the registry file (`src/backend/npm.ts` or `src/backend/pypi.ts`)
2. Add your dimension to the `scoreBreakdown` interface
3. Compute the score in `buildNpmCommitmentProfile()` / `buildPyPICommitmentProfile()`
4. Adjust total weight so the 5 dimensions still sum to ≤100
5. Update the `summary` string to mention your dimension if relevant

Keep it a public API signal — no auth, no scraping.

## Add a new registry

The pypi and npm implementations are the canonical pattern:

1. Copy `src/backend/pypi.ts` → `src/backend/<registry>.ts`
2. Implement `build<Registry>CommitmentProfile(name: string)` with the same 5 dimensions
3. Export the profile type and function
4. Wire it into `src/backend/server.ts` under a new `/api/registry/<name>` route
5. Add an MCP tool in `src/mcp/server.ts` following the existing pattern
6. Add a test case in `src/test/e2e.ts`

Good first registry to add: **Cargo** (see [issue #1](https://github.com/piiiico/proof-of-commitment/issues)).

## Test

```bash
bun run test:e2e        # hits local server, checks scoring + API shape
```

No unit test framework yet — the e2e test is the single source of truth.

## Submit a PR

- Small, focused PRs preferred
- Include a before/after example (`npx proof-of-commitment <package>`) if the change affects scoring output
- Don't bump versions — releases are manual

## API docs

Full REST API and MCP tool reference: [getcommit.dev](https://getcommit.dev)

## Questions

Open an issue or ping the backend directly:

```bash
curl https://poc-backend.amdal-dev.workers.dev/api/audit \
  -X POST -H "Content-Type: application/json" \
  -d '{"packages": ["your-package"]}'
```
