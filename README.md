# Proof of Commitment

[![Commitment Score](https://poc-backend.amdal-dev.workers.dev/badge/npm/proof-of-commitment)](https://getcommit.dev/audit?packages=proof-of-commitment)

> **Stars lie. Behavioral signals don't.**

An MCP server and web tool that scores npm packages, PyPI packages, and GitHub repos on **behavioral commitment** — signals that are harder to fake than stars, READMEs, or download counts.

## The supply chain problem

26 of the 91 npm packages with >10M weekly downloads have a **single npm publisher**. Together they account for over 3 billion downloads per week. `npm audit` doesn't surface this. Stars don't either.

Four packages in a typical Node.js project are CRITICAL right now:
- **chalk** — 413M downloads/week, **1 npm publisher**
- **zod** — 163M downloads/week, **1 npm publisher** (30+ GitHub contributors)
- **lodash** — 145M downloads/week, **1 npm publisher**
- **axios** — 99M downloads/week, **1 npm publisher** (attacked March 30, 2026)

They won't appear in your `package.json` either — but these are in almost every project:
- **minimatch** — 562M downloads/week, **1 npm publisher**
- **glob** — 333M downloads/week, **1 npm publisher**
- **cross-spawn** — 190M downloads/week, **1 npm publisher**

Behavioral signals surface this. Stars and READMEs don't.

## Try it now

**Terminal (zero install):**
```bash
npx proof-of-commitment axios zod chalk
# scan your own project:
npx proof-of-commitment --file package.json
# scan ALL transitive dependencies via lock file (finds the hidden CRITICAL packages):
npx proof-of-commitment --file package-lock.json   # npm
npx proof-of-commitment --file yarn.lock           # yarn
npx proof-of-commitment --file pnpm-lock.yaml      # pnpm
# JSON output for CI/CD pipelines (exits 1 if CRITICAL found):
npx proof-of-commitment --file package-lock.json --json | jq '.criticalCount'
# PyPI too:
npx proof-of-commitment --pypi litellm langchain requests
```

**Web demo (no install):** [getcommit.dev/audit](https://getcommit.dev/audit) — paste your packages, see risk scores in seconds.

**MCP server (zero install):**

```json
{
  "mcpServers": {
    "proof-of-commitment": {
      "type": "streamable-http",
      "url": "https://poc-backend.amdal-dev.workers.dev/mcp"
    }
  }
}
```

Add to Claude Desktop, Cursor, Windsurf, or any MCP-compatible AI tool. Then ask:

> "Audit my package.json for supply chain risk"
> "Score axios, zod, chalk, lodash — which is highest risk?"
> "Is vercel/ai actively maintained?"

## GitHub Action

Add supply chain auditing to any CI pipeline in 30 seconds — auto-detects packages from `package.json` or `requirements.txt`, **posts results as a PR comment**, writes to GitHub Step Summary, and optionally fails on CRITICAL packages.

Use the dedicated action at [piiiico/commit-action](https://github.com/piiiico/commit-action):

```yaml
# .github/workflows/supply-chain.yml
name: Supply Chain Audit
on:
  pull_request:
    paths: ['package.json', 'package-lock.json', 'bun.lock']

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: piiiico/commit-action@v1
        with:
          fail-on-critical: true   # blocks merges on CRITICAL packages
          comment-on-pr: true      # posts results as a PR comment
```

When `comment-on-pr: true` (default), the action automatically posts the audit table as a comment on the pull request — and **updates the same comment** on re-run, so you don't get comment spam. Reviewers see the risk table without leaving the PR.

**Inputs:**

| Input | Default | Description |
|-------|---------|-------------|
| `packages` | _(auto)_ | Comma-separated package names (auto-detected from `package.json`/`requirements.txt` if not set) |
| `packages-file` | _(auto)_ | Path to `package.json` or `requirements.txt` (default: auto-detect in workspace root) |
| `fail-on-critical` | `true` | Fail the workflow if CRITICAL packages are found |
| `max-packages` | `20` | Max packages to audit when auto-detecting |
| `include-dev-dependencies` | `false` | Include `devDependencies` from `package.json` |
| `comment-on-pr` | `true` | Post audit results as a PR comment (requires `pull-requests: write` permission) |
| `api-key` | _(none)_ | [Commit Pro](https://getcommit.dev/pricing) API key — enables batch requests and 10K requests/month |
| `api-url` | _(prod)_ | Override API endpoint (useful for self-hosting) |

**Outputs:** `has-critical`, `critical-count`, `audit-summary` (markdown table, also written to Step Summary).

**Free vs Pro:** Without an API key, packages are audited one at a time (with delays to respect rate limits). With a Pro API key, all packages are audited in a single batch request — faster and with higher monthly limits.

Example PR comment / Step Summary output:

```
| Package | Risk        | Score | Publishers | Downloads/wk | Age   |
|---------|-------------|-------|------------|--------------|-------|
| chalk   | 🔴 CRITICAL | 75    | 1          | 380M         | 12.7y |
| zod     | 🔴 CRITICAL | 83    | 1          | 133M         | 6.1y  |
| axios   | 🔴 CRITICAL | 89    | 1          | 93M          | 11.6y |
```

## README Badges

Add a Commit Trust badge to any npm package you maintain or depend on:

```markdown
![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/YOUR-PACKAGE)
```

Examples:

| Package | Badge URL |
|---------|-----------|
| chalk | `![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/chalk)` |
| react | `![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/react)` |
| express | `![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/express)` |
| @babel/core | `![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/@babel/core)` |

Grades: 🟢 OK (75+) · 🟠 WARNING (40–74) · 🔴 CRITICAL (<40 or sole npm publisher with 10M+ weekly downloads)

Badges are cached 1 hour. No API key needed.

Also supports PyPI and the full ecosystem-specific format:

```markdown
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/npm/YOUR-PACKAGE)
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/pypi/YOUR-PACKAGE)
```

## REST API

No API key. No install.

```bash
curl https://poc-backend.amdal-dev.workers.dev/api/audit \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"packages": ["axios", "zod", "chalk", "lodash", "express"]}'
```

```json
{
  "count": 5,
  "results": [
    {
      "name": "chalk",
      "ecosystem": "npm",
      "score": 75,
      "maintainers": 1,
      "weeklyDownloads": 398397580,
      "ageYears": 12.7,
      "trend": "stable",
      "riskFlags": ["CRITICAL"]
    },
    ...
  ]
}
```

## 7 MCP tools

| Tool | Description |
|------|-------------|
| `audit_dependencies` | Batch risk audit for up to 20 npm/PyPI packages |
| `lookup_npm_package` | Single npm package behavioral profile |
| `lookup_pypi_package` | Single PyPI package behavioral profile |
| `lookup_github_repo` | GitHub repo commitment score (longevity, commit frequency, contributor depth) |
| `lookup_business` | Norwegian business register — operating years, employees, financials |
| `lookup_business_by_org` | Same, by org number |
| `query_commitment` | Browser extension behavioral data (unique verified visitors, repeat rate) |

## What the score measures

Each package is scored 0–100 across:

- **Longevity** — How long has the package existed? Abandoned packages get reactivated for attacks.
- **Publisher depth** — Single npm publisher + millions of weekly downloads = the attack surface LiteLLM exploited. (Publisher = person with npm publish access, distinct from GitHub contributors.)
- **Release consistency** — Regular releases signal active oversight. Long gaps = vulnerability accumulation.
- **Download trend** — Growing packages attract more scrutiny (and attacks). Stable = lower profile.

**Risk flags:**
- `CRITICAL` — single npm publisher + >10M weekly downloads (exact LiteLLM/axios attack profile)
- `HIGH` — package <1yr old + rapid adoption
- `WARN` — no release in 12+ months

## Real data points

```
# packages you know about:
chalk       — score 75, 1 publisher, 413M/week  ⚑ CRITICAL
zod         — score 86, 1 publisher, 163M/week  ⚑ CRITICAL  (30+ GitHub contributors)
lodash      — score 81, 1 publisher, 145M/week  ⚑ CRITICAL
axios       — score 86, 1 publisher,  99M/week  ⚑ CRITICAL  (attacked Mar 30 2026)
express     — score 90, 5 publishers, 95M/week

# packages probably not in your package.json, definitely in your lock file:
minimatch   — score 78, 1 publisher, 562M/week  ⚑ CRITICAL
glob        — score 80, 1 publisher, 333M/week  ⚑ CRITICAL
cross-spawn — score 72, 1 publisher, 190M/week  ⚑ CRITICAL

# post-attack:
litellm     — score 74, 1 publisher            ⚑ CRITICAL  (supply chain attack Mar 2026)
```

## Why behavioral signals

The LiteLLM attack (March 2026) and axios attack (March 30, 2026) followed the same pattern: stolen credentials → malicious package pushed → 97M+ machines exposed. Both packages scored CRITICAL by these metrics *before* the attacks.

Declarative signals (stars, README quality, CI badges) don't capture this risk. Behavioral commitment does.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Cloudflare Workers + D1 |
| MCP | Model Context Protocol SDK |
| Data | npm registry, PyPI, GitHub API, Brønnøysund (NO) |
| Landing | Astro + Cloudflare Pages |

## Roadmap

Planned, not promised. The project is early-stage — contributions welcome on any of these.

| Feature | Status | Notes |
|---------|--------|-------|
| **Cargo (Rust) registry support** | Planned | Extend the npm/pypi scoring pattern to crates.io |
| **Go modules support** | Planned | pkg.go.dev API + GitHub backing score |
| **Score breakdown visualization** | Planned | Chart component for the 5 dimensions on getcommit.dev/audit |
| **`--json` flag for CLI** | ✅ Live | `npx proof-of-commitment --file package-lock.json --json \| jq '.criticalCount'` |
| **pnpm workspace monorepo support** | Planned | Detect `pnpm-workspace.yaml`, audit all packages |
| **Historical score tracking** | Planned | Trend charts — was this package getting riskier over time? |
| **Org-level dashboards** | Planned | Aggregate risk view across all repos in a GitHub org |

See [open issues](https://github.com/piiiico/proof-of-commitment/issues) for things you can help with today.

## The broader vision

Supply chain auditing is the first tool. The underlying primitive is a **commitment graph** — behavioral signals that replace content-based trust across any domain.

When content is free to fake (reviews, stars, READMEs), commitment becomes the signal. A publisher who has shipped 847 releases over 12 years is a different kind of commitment than one who published once in 2023.

The same logic applies to websites, businesses, and AI agents. Two card networks have independently named this gap: Mastercard Verifiable Intent §9.2 explicitly lists behavioral trust as "not covered." Visa TAP identifies agents without answering whether to trust them.

Proof of Commitment is the trust layer they're pointing at.

→ [getcommit.dev](https://getcommit.dev)

## Run locally

```bash
bun install
bun run dev:backend     # local server with SQLite
bun run test:e2e        # E2E test with mock World ID
```

Deploy:
```bash
bun run deploy          # deploys to Cloudflare Workers
```
