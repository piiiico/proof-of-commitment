# Proof of Commitment

[![Commitment Score](https://poc-backend.amdal-dev.workers.dev/badge/npm/proof-of-commitment)](https://getcommit.dev/audit?packages=proof-of-commitment)
[![npm downloads](https://img.shields.io/npm/dw/proof-of-commitment)](https://www.npmjs.com/package/proof-of-commitment)
[![Mentioned in Awesome MCP Servers](https://awesome.re/mentioned-badge.svg)](https://github.com/punkpeye/awesome-mcp-servers)

> **Stars lie. Behavioral signals don't.**

An MCP server and web tool that scores npm packages, PyPI packages, Rust crates, Go modules, and GitHub repos on **behavioral commitment** — signals that are harder to fake than stars, READMEs, or download counts.

## The supply chain problem

26 of the 91 npm packages with >10M weekly downloads have a **single npm publisher**. Together they account for over 3 billion downloads per week. `npm audit` doesn't surface this. Stars don't either.

Four packages in a typical Node.js project are CRITICAL right now:
- **chalk** — 432M downloads/week, **1 npm publisher**
- **zod** — 185M downloads/week, **1 npm publisher** (30+ GitHub contributors)
- **lodash** — 156M downloads/week, **1 npm publisher**
- **axios** — 113M downloads/week, **1 npm publisher** (attacked March 30, 2026)

They won't appear in your `package.json` either — but these are in almost every project:
- **minimatch** — 625M downloads/week, **1 npm publisher**
- **glob** — 366M downloads/week, **1 npm publisher**
- **cross-spawn** — 215M downloads/week, **1 npm publisher**

Behavioral signals surface this. Stars and READMEs don't.

## Quick install (MCP)

No login required. Add to any MCP-compatible AI tool and start querying supply chain risk.

**Claude Desktop**

Open `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS ([config file reference](https://modelcontextprotocol.io/quickstart/user)) or `%APPDATA%\Claude\claude_desktop_config.json` on Windows, then add:

```json
{
  "mcpServers": {
    "commit": {
      "type": "streamable-http",
      "url": "https://poc-backend.amdal-dev.workers.dev/mcp"
    }
  }
}
```

Restart Claude Desktop. A tool icon appears in the chat input — ask it to audit your `package.json`.

**Cursor**

Open `~/.cursor/mcp.json` ([Cursor MCP docs](https://cursor.com/docs/mcp)) and add:

```json
{
  "mcpServers": {
    "commit": {
      "type": "streamable-http",
      "url": "https://poc-backend.amdal-dev.workers.dev/mcp"
    }
  }
}
```

**Smithery** (once indexed)

```bash
npx -y @smithery/cli install proof-of-commitment --client claude
```

---

## Try it now

**Terminal (zero install):**
```bash
# New in v1.8.0: zero-arg auto-detect — cd into any project, run once:
npx proof-of-commitment
# Picks the highest-coverage manifest in cwd (package-lock.json > yarn.lock >
# pnpm-lock.yaml > pnpm-workspace.yaml > package.json; requirements.txt;
# Cargo.toml; go.sum > go.mod). When multiple ecosystems are present, the
# file with the most recent mtime wins.

# Explicit package list still works:
npx proof-of-commitment axios zod chalk

# Or point at a specific file:
npx proof-of-commitment --file package.json
npx proof-of-commitment --file package-lock.json   # npm (transitive)
npx proof-of-commitment --file yarn.lock           # yarn
npx proof-of-commitment --file pnpm-lock.yaml      # pnpm
npx proof-of-commitment --file pnpm-workspace.yaml # pnpm monorepo
npx proof-of-commitment --pypi litellm langchain requests
npx proof-of-commitment --cargo serde tokio reqwest
npx proof-of-commitment --golang github.com/gin-gonic/gin golang.org/x/net
npx proof-of-commitment --file go.mod
npx proof-of-commitment --file go.sum              # full transitive Go set

# JSON output for downstream tools:
npx proof-of-commitment --file package-lock.json --json | jq '.criticalCount'
```

### CI integration (v1.8.0+)

`--fail-on=<level>` turns the CLI into a one-line CI gate. No GitHub Action required.

```yaml
# .github/workflows/supply-chain.yml
name: Supply Chain
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx -y proof-of-commitment --fail-on=critical
```

Levels:

| `--fail-on` | Exit 1 when… |
|---|---|
| `critical` | any package is flagged CRITICAL (publish-access concentration) |
| `risky` | any package is CRITICAL **or** HIGH (score < 40) |
| `none` | never — report only |

Defaults: `critical` in CI (when `CI=true` is set, which every major CI runner does) and for `--json` output. Interactive (TTY, non-CI) keeps the v1.7 default of **exit 0** — running locally won't break your shell habits.

The dedicated [`piiiico/commit-action@v1`](https://github.com/piiiico/commit-action) is still the right choice when you want PR comments and step summaries; `--fail-on` is for minimal pipelines that just need a yes/no answer.

### SARIF output for GitHub Code Scanning (v1.26.0+)

`--sarif` outputs [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) — the standard format for static analysis results. Upload it to GitHub Code Scanning and Commit findings appear in the Security tab alongside CodeQL and Snyk.

```yaml
# .github/workflows/supply-chain.yml
name: Supply Chain
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx -y proof-of-commitment --file package-lock.json --sarif --fail-on=none > results.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: results.sarif
          category: commit-supply-chain
```

CRITICAL and HIGH packages show as alerts in the repo's Security tab. Compromised packages (in the Commit incident registry) get a separate alert. `--fail-on` still controls the exit code independently — use `--fail-on=critical` to also block the PR.

**Web demo (no install):** [getcommit.dev/audit](https://getcommit.dev/audit) — paste your packages, see risk scores in seconds.

## IDE Hooks (Cursor + Claude Code + Windsurf)

`poc hook` installs a supply chain gate for **Cursor** ([`beforeShellExecution`](https://docs.cursor.com/context/hooks)), **Claude Code** ([`PreToolUse`](https://code.claude.com/docs/en/hooks)), and **Windsurf** ([`pre_run_command`](https://docs.windsurf.com/windsurf/cascade/hooks)) in one command. The same hook script intercepts package installs from any agent, auto-detects which client called it, and blocks CRITICAL packages before they run.

```bash
# Install for the current project (writes .cursor/hooks.json + .claude/settings.json + .windsurf/hooks.json):
poc hook

# Or protect every project for your user:
poc hook --global

# Narrow to one client:
poc hook --cursor          # only .cursor/hooks.json
poc hook --claude-code     # only .claude/settings.json
poc hook --windsurf        # only .windsurf/hooks.json

# Remove (cleans all three):
poc hook --uninstall
```

The hook writes `.cursor/hooks.json`, `.claude/settings.json`, and `.windsurf/hooks.json` (project) or the equivalents under `~/` (with `--global`). When Cursor, Claude Code, or Windsurf runs `npm install axios`, `pip install litellm`, `cargo add serde`, or `go get github.com/gin-gonic/gin`, the hook calls the Commit API and either blocks, warns, or allows — in under 500ms.

**What gets intercepted:**

| Package manager | Example command |
|---|---|
| npm / npx | `npm install <pkg>`, `npm add <pkg>` |
| pnpm | `pnpm add <pkg>` |
| yarn | `yarn add <pkg>` |
| pip / pip3 / uv | `pip install <pkg>` |
| cargo | `cargo add <pkg>`, `cargo install <pkg>` |
| go | `go get <module>`, `go install <module>` |

**Why this matters:** Supply chain attacks now happen in minutes. The Shai-Hulud worm (May 2026) compromised 637 packages in 39 minutes and specifically targeted AI coding assistants — planting persistence hooks in `.claude/settings.json` and `.vscode/tasks.json`. When your AI assistant installs a dependency, it bypasses the human review that used to be the last line of defense. `poc hook` puts a gate back in — same gate, whether Cursor, Claude Code, or Windsurf is driving.

**Default behavior:** CRITICAL packages (sole npm publisher + >10M downloads/week — the exact LiteLLM/axios attack profile) are blocked. HIGH packages trigger an "ask user" prompt (Cursor/Claude Code) or are blocked with a message (Windsurf). Set `COMMIT_HOOK_SEVERITY_BLOCK=HIGH` to block both.

**With an API key:** `poc login sk_commit_…` before running `poc hook` — the key is embedded in the hook config and lifts the rate limit.

---

## Get notified before the next attack

The CLI tells you what's risky today. A free API key unlocks **monitoring** — score recomputation across the packages you depend on, with alerts when one degrades (publisher drops, release stalls, score falls ≥10 points).

- **Open (free):** Watch 3 packages · weekly digest every Monday
- **Developer ($15/mo):** Watch 15 packages · daily scans · instant email alerts

[**Get a free API key →**](https://getcommit.dev/get-started?ref=readme-monitoring) (no card, 30 seconds · 200 audits/day included)

```bash
npm install -g proof-of-commitment   # then:
poc watch axios --email you@company.com  # free key + monitoring in one step
poc watch chalk                          # add more packages (3 free)
poc init                                 # add CI gate to this repo
```

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

Also supports PyPI, Cargo, Go modules, and the full ecosystem-specific format:

```markdown
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/npm/YOUR-PACKAGE)
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/pypi/YOUR-PACKAGE)
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/cargo/YOUR-CRATE)
![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/golang/github.com/owner/repo)
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
      "riskFlags": ["CRITICAL"],
      "scorecardScore": 3.6,        // null if no GitHub repo
      "hasDangerousWorkflow": false  // null if no Scorecard data
    },
    ...
  ]
}
```

## 11 MCP tools

| Tool | Description |
|------|-------------|
| `audit_dependencies` | Batch risk audit for up to 20 npm/PyPI/Cargo/Go packages |
| `audit_github_repo` | Fetch a repo's package.json/requirements.txt and audit every dep |
| `audit_dependency_tree` | Map an npm package's full dependency tree (incl. transitive CRITICAL deps) |
| `lookup_npm_package` | Single npm package behavioral profile |
| `lookup_pypi_package` | Single PyPI package behavioral profile |
| `lookup_cargo_crate` | Single Rust crate behavioral profile (crates.io) |
| `lookup_go_module` | Single Go module behavioral profile (proxy.golang.org + GitHub) |
| `lookup_github_repo` | GitHub repo commitment score (longevity, commit frequency, contributor depth) |
| `lookup_business` | Norwegian business register — operating years, employees, financials |
| `lookup_business_by_org` | Same, by org number |
| `query_commitment` | Browser extension behavioral data (unique verified visitors, repeat rate) |

Anonymous: 15 requests/IP/UTC day across both `/mcp` and `/api/audit`. Free key (no card, 30s signup at https://getcommit.dev/get-started): 200/day. Higher tiers at https://getcommit.dev/pricing.

## What the score measures

Each package is scored 0–100 across:

- **Longevity** — How long has the package existed? Abandoned packages get reactivated for attacks.
- **Publisher depth** — Single npm publisher + millions of weekly downloads = the attack surface LiteLLM exploited. (Publisher = person with npm publish access, distinct from GitHub contributors.)
- **Release consistency** — Regular releases signal active oversight. Long gaps = vulnerability accumulation.
- **Download trend** — Growing packages attract more scrutiny (and attacks). Stable = lower profile.
- **OpenSSF Scorecard** — Process security (code review enforcement, branch protection, CI/CD safety). Separate from behavioral signals. High Scorecard ≠ safe from credential theft attacks.

> Both axios (8.1/10 Scorecard) and chalk (3.6/10 Scorecard) score CRITICAL on behavioral signals. They measure different attack surfaces — Scorecard catches process gaps, behavioral signals catch publisher concentration.

**Risk flags:**
- `CRITICAL` — single npm publisher + >10M weekly downloads (exact LiteLLM/axios attack profile)
- `HIGH` — package <1yr old + rapid adoption
- `WARN` — no release in 12+ months

## Real data points

```
# packages you know about:
chalk       — score 75, 1 publisher, 432M/week  ⚑ CRITICAL
zod         — score 83, 1 publisher, 185M/week  ⚑ CRITICAL  (30+ GitHub contributors)
lodash      — score 81, 1 publisher, 156M/week  ⚑ CRITICAL
axios       — score 88, 1 publisher, 113M/week  ⚑ CRITICAL  (attacked Mar 30 2026)
express     — score 90, 5 publishers, 95M/week

# packages probably not in your package.json, definitely in your lock file:
minimatch   — score 78, 1 publisher, 625M/week  ⚑ CRITICAL
glob        — score 80, 1 publisher, 366M/week  ⚑ CRITICAL
cross-spawn — score 72, 1 publisher, 215M/week  ⚑ CRITICAL

# post-attack:
litellm     — score 74, 1 publisher            ⚑ CRITICAL  (supply chain attack Mar 2026)

# Rust crates (new in v1.3.0):
serde       — score 78, 1 owner,  13M/week  ⚑ CRITICAL  (dtolnay sole owner)
tokio       — score 89, 2 owners, 10M/week
reqwest     — score 85, 1 owner,   8M/week  ⚑ HIGH
```

## Why behavioral signals

The LiteLLM attack (March 2026) and axios attack (March 30, 2026) followed the same pattern: stolen credentials → malicious package pushed → 97M+ machines exposed. Both packages scored CRITICAL by these metrics *before* the attacks.

Declarative signals (stars, README quality, CI badges) don't capture this risk. Behavioral commitment does.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Cloudflare Workers + D1 |
| MCP | Model Context Protocol SDK |
| Data | npm registry, PyPI, crates.io, proxy.golang.org, deps.dev, GitHub API, Brønnøysund (NO) |
| Landing | Astro + Cloudflare Pages |

## Roadmap

Planned, not promised. The project is early-stage — contributions welcome on any of these.

| Feature | Status | Notes |
|---------|--------|-------|
| **Cargo (Rust) registry support** | ✅ Live | MCP tool, REST API, badge endpoint — `ecosystem: "cargo"` |
| **Go modules support** | ✅ Live | proxy.golang.org + deps.dev + GitHub-primary scoring — `ecosystem: "golang"` |
| **Score breakdown visualization** | Planned | Chart component for the 5 dimensions on getcommit.dev/audit |
| **`--json` flag for CLI** | ✅ Live | `npx proof-of-commitment --file package-lock.json --json \| jq '.criticalCount'` |
| **pnpm workspace monorepo support** | ✅ Live | `--file pnpm-workspace.yaml` or auto-detected from `pnpm-lock.yaml` |
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

## Releasing

Publish is triggered automatically when a tag `v*` is pushed, or manually via GitHub Actions `workflow_dispatch`.

### Funnel smoke gate

Before `npm publish` runs, the CI workflow executes `scripts/funnel-smoke.sh` — a local-mock pre-publish check that exercises four key funnel paths:

| Path | What it tests | Bug class caught |
|------|--------------|-----------------|
| A | CLI audit with `COMMIT_API_KEY` set → 200 + results | v1.20.0: missing `Authorization` header → 0 paid conversions |
| B | CLI audit anonymous, 429 → message + `instant_key_url` | 429 handling / CTA surfacing |
| C | cursor-hook (Cursor stdin) 429 → `permission: ask` + signup URL | v1.21.0: silent `allow` on 429 → security gap + 0 conversions |
| D | cursor-hook (Claude Code `PreToolUse` stdin) 429 → `hookSpecificOutput.permissionDecision: ask` + `claude-code-hook-429` attribution | v1.22.0: wrong-shape reply when Claude Code drives → silent allow / mis-attributed conversion |

Any path failure blocks the release. The gate runs a local Python mock server so it's deterministic in CI and doesn't depend on production rate-limit state.

**Optional CI secret:** Set `COMMIT_TEST_API_KEY` in GitHub repo secrets to use a real API key for Path A. Falls back to a mock key that the local server accepts unconditionally.

**Run locally:**
```bash
bash scripts/funnel-smoke.sh
```
