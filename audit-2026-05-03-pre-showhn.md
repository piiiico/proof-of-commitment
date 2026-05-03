# Pre-Show-HN Adapter Audit — 2026-05-03

Audit of all three registry adapters (`npm.ts`, `pypi.ts`, `github.ts`) for
the bug class surfaced by the 14:46 reflection: **metadata-date masquerading
as event-date, summary-count masquerading as item-count, default-fallback
masking real values.**

Show HN ships 2026-05-04 14:00 CEST. This audit is the pre-flight.

## Headline finding

**Source/production divergence.** The fix for `daysSinceLastPublish` (use
`pkg.time[latestVersion]` instead of `pkg.time["modified"]`) was deployed to
the live worker but **never committed to the source tree**. Local
`dist/worker.js`, when rebuilt, would have re-introduced the bug on the next
deploy. The fix is now in `src/backend/npm.ts` and re-deployed.

This is the same pattern as the 2026-05-03 reflection's blog-post-source-loss
surprise: production state outliving the git tree.

## Findings per adapter

### npm.ts — 1 critical bug fixed

**Bug:** `daysSinceLastPublish` used `pkg.time["modified"]` (npm metadata
last-modification time — refreshes on owner changes, deprecation flags,
security advisories) instead of `pkg.time[latestVersion]` (actual publish
event of the latest version).

**Impact:** Packages with no recent publish but recent metadata refresh
showed misleading freshness. `once` showed `daysSinceLastPublish=63` when the
last publish (1.4.0) was 2016-09-06 — actual ~3527 days. For an audit tool
whose value is calling out unmaintained dependencies, this is the central
metric being wrong.

**Fix:** `npm.ts:290–305` — use `pkg.time[latestVersion]` with fallback to
`pkg.time["modified"]` only if the latest-version timestamp is missing.

**Verification:** Post-deploy `/api/audit` on lodash, express, react, once,
escape-html — all `daysSinceLastPublish` values match the ground-truth
`time[latestVersion]` from the npm registry.

**Other npm.ts checks (no fix needed):**
- `versionCount` filters `created`/`modified`/`unpublished` keys — may still
  include prerelease version timestamps. Acceptable: scoring threshold ≥100
  versions for max points; over-counting biases up, not toward false-CRITICAL.
- `maintainerCount` defaults to 1 if `maintainers` is undefined. npm always
  has maintainers in practice; defensive default. Acceptable.
- `created` time can predate the first useful version (namespace squatting).
  Acceptable; ageYears is a coarse signal.

### pypi.ts — clean

PyPI adapter computes `daysSinceLastPublish` correctly: iterates
`releases[*]`, filters yanked files, takes max `upload_time`. This is a
first-class event date, not a metadata field.

`versionCount` uses `nonYankedVersionCount` — counts only versions with at
least one non-yanked file. Correct.

`maintainerCount` uses unique users in `ownership.roles` when present, falls
back to comma-counting maintainer/author email strings. Acceptable heuristic.

`ageYears` uses earliest non-yanked release upload — accurate.

**No bugs found.** Verified against requests, flask, django, numpy
post-deploy: scores and dates align with PyPI registry ground truth.

### github.ts — 1 medium bug fixed

**Bug:** `releaseCount` fetched only the latest 10 releases (`per_page=10`),
then filtered out prereleases. Repos with high prerelease cadence under-
report stable releases:
- `tj/commander.js`: 8 stable visible in last 10 → reported as 8; actual ≥67.
- `sindresorhus/got`: ≥9 stable visible → reported ≤9; actual ≥91.

Score impact is bounded (threshold for max is ≥10 stable releases), but the
displayed `releaseCount` value misrepresents the project. For an audit API
that surfaces these numbers, accuracy matters.

**Fix:** `github.ts:188–202` — `per_page=100` (GitHub max). Gives accurate
counts up to 100, which exceeds our scoring threshold.

**Other github.ts checks (no fix):**
- `pushed_at` is updated by any push, including dependabot/CI bot commits.
  Could overstate "maintenance." Standard signal across all GitHub-based
  trust tools; out of scope.
- `contributorCount` returns "30+" via the magic value `35` when first page
  is full (per_page=30). Display layer renders "30+" — not hidden. Acceptable.
- `contributorCount` defaults to 1 on fetch error. Silent fallback. For an
  error case it understates community; marginal. Acceptable.
- Recent commits cap at 100 (per_page=100). Threshold is ≥50 = max score, so
  truncation doesn't affect scoring.

## Class-pattern check (all 3 adapters)

| Bug class | npm | pypi | github |
|---|---|---|---|
| metadata-date masking event-date | ✅ FIXED (`time.modified` → `time[latestVersion]`) | clean | clean (`pushed_at` is acceptable proxy) |
| summary-count masking item-count | clean (versionCount counts time keys, not a summary) | clean (counts non-yanked versions) | ✅ FIXED (`per_page=10` → `per_page=100`) |
| default-fallback masking real values | maintainerCount=1 (acceptable) | clean | contributorCount=1 on error (acceptable) |

## Deployment

Both fixes built and deployed to `poc-backend.amdal-dev.workers.dev` on
2026-05-03. Pre/post curl verification shows the npm fix produces correct
values for `once` (3526), `escape-html` (3897), `lodash` (32), `react` (25),
`express` (153). PyPI sample (`requests`, `flask`, `django`, `numpy`) and
GitHub-deps audit (`tj/commander.js` deps) work normally.

## Process note

The npm bug existed in source AFTER it was fixed in production. This means
either (a) source was reverted post-deploy, or (b) the fix went straight
into `dist/worker.js` without touching source. Either way, the next clean
build would have re-introduced the bug.

Action item already covered by 2026-05-03 reflection: production state
should not outlive the git tree. Pre-deploy hook to compare source-built
artifact against deployed artifact would catch this class of drift.
