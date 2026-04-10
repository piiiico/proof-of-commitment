# Proof of Commitment

> **Stars lie. Behavioral signals don't.**

An MCP server and web tool that scores npm packages, PyPI packages, and GitHub repos on **behavioral commitment** — signals that are harder to fake than stars, READMEs, or download counts.

## The supply chain problem

Three packages in a typical Node.js project are CRITICAL right now:
- **chalk** — 399M downloads/week, **1 maintainer**
- **zod** — 139M downloads/week, **1 maintainer**
- **axios** — 96M downloads/week, **1 maintainer** (attacked April 1st, 2026)

Stars and README quality don't surface this. Behavioral signals do.

## Try it now

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

Add supply chain auditing to any CI pipeline — auto-detects packages from `package.json` or `requirements.txt`, **posts results as a PR comment**, writes to GitHub Step Summary, and optionally fails on CRITICAL packages.

```yaml
# .github/workflows/supply-chain-audit.yml
name: Supply Chain Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write   # needed for PR comments
    steps:
      - uses: actions/checkout@v4
      - uses: piiiico/proof-of-commitment@main
        with:
          fail-on-critical: false   # set true to block merges
          comment-on-pr: true       # posts audit table directly on the PR
```

When `comment-on-pr: true` (default), the action automatically posts the audit table as a comment on the pull request — and **updates the same comment** on re-run, so you don't get comment spam. Reviewers see the risk table without leaving the PR.

**Inputs:**

| Input | Default | Description |
|-------|---------|-------------|
| `packages` | _(auto)_ | Comma-separated package names (auto-detected from `package.json`/`requirements.txt` if not set) |
| `fail-on-critical` | `true` | Fail the workflow if CRITICAL packages are found |
| `max-packages` | `20` | Max packages to audit when auto-detecting |
| `comment-on-pr` | `true` | Post audit results as a PR comment (requires `pull-requests: write` permission) |

**Outputs:** `has-critical`, `critical-count`, `audit-summary` (markdown table, also written to Step Summary).

Example PR comment / Step Summary output:

```
| Package | Risk        | Score | Maintainers | Downloads/wk | Age   |
|---------|-------------|-------|-------------|--------------|-------|
| chalk   | 🔴 CRITICAL | 75    | 1           | 380M         | 12.7y |
| zod     | 🔴 CRITICAL | 83    | 1           | 133M         | 6.1y  |
| axios   | 🔴 CRITICAL | 89    | 1           | 93M          | 11.6y |
```

## README Badges

Add a commitment score badge to any package you maintain or depend on:

```markdown
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/npm/YOUR-PACKAGE)
```

Examples:

| Package | Badge URL |
|---------|-----------|
| axios | `![commit](https://poc-backend.amdal-dev.workers.dev/api/badge/npm/axios)` |
| zod | `![commit](https://poc-backend.amdal-dev.workers.dev/api/badge/npm/zod)` |
| litellm | `![commit](https://poc-backend.amdal-dev.workers.dev/api/badge/pypi/litellm)` |

Colors: 🟢 healthy (75+) · 🟡 good (60–74) · 🟡 moderate (40–59) · 🟠 high risk (<40) · 🔴 CRITICAL (single maintainer + >10M downloads/week)

Badges are cached 5 minutes at Cloudflare's edge. No API key needed.

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
- **Maintainer depth** — Single maintainer + millions of weekly downloads = the attack surface LiteLLM exploited.
- **Release consistency** — Regular releases signal active oversight. Long gaps = vulnerability accumulation.
- **Download trend** — Growing packages attract more scrutiny (and attacks). Stable = lower profile.

**Risk flags:**
- `CRITICAL` — single maintainer + >10M weekly downloads (exact LiteLLM/axios attack profile)
- `HIGH` — package <1yr old + rapid adoption
- `WARN` — no release in 12+ months

## Real data points

```
chalk     — score 75, 1 maintainer, 399M/week  ⚑ CRITICAL
zod       — score 83, 1 maintainer, 139M/week  ⚑ CRITICAL
axios     — score 89, 1 maintainer,  96M/week  ⚑ CRITICAL (attacked Apr 1 2026)
lodash    — score 88, 3 maintainers, 68M/week
express   — score 91, 5 maintainers, 35M/week
litellm   — score 74, 1 maintainer           ⚑ CRITICAL (supply chain attack Mar 2026)
```

## Why behavioral signals

The LiteLLM attack (March 2026) and axios attack (April 2026) followed the same pattern: stolen credentials → malicious package pushed → 97M+ machines exposed. Both packages scored CRITICAL by these metrics *before* the attacks.

Declarative signals (stars, README quality, CI badges) don't capture this risk. Behavioral commitment does.

## Listed in the official MCP registry

```
registry.modelcontextprotocol.io → io.github.piiiico/proof-of-commitment
```

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Cloudflare Workers + D1 |
| MCP | Model Context Protocol SDK |
| Data | npm registry, PyPI, GitHub API, Brønnøysund (NO) |
| Landing | Astro + Cloudflare Pages |

## The broader vision

Supply chain auditing is the first tool. The underlying primitive is a **commitment graph** — behavioral signals that replace content-based trust across any domain.

When content is free to fake (reviews, stars, READMEs), commitment becomes the signal. A maintainer who has shipped 847 releases over 12 years is a different kind of commitment than one who published once in 2023.

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
