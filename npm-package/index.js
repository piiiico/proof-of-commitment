#!/usr/bin/env node
/**
 * proof-of-commitment CLI v1.19.0
 * Scores npm/PyPI/Cargo/Go packages on behavioral commitment signals.
 * Usage: npx proof-of-commitment [packages...] [options]
 */

const API = 'https://poc-backend.amdal-dev.workers.dev/api/audit';
const KEYS_API = 'https://poc-backend.amdal-dev.workers.dev/api/keys';
const WATCHLIST_API = 'https://poc-backend.amdal-dev.workers.dev/api/watchlist';
const WEB = 'https://getcommit.dev/audit';

// Backend uses Accept header to decide JSON vs plain-text body on 429
// (added 2026-05-22 so v1.14.0 CLI, which sends the fetch default `*/*`,
// gets a readable text body inside its Error wrapper instead of a JSON
// dump). v1.17.0+ explicitly opts into JSON so handle429() can parse
// shared_ip_hint, retry_after_seconds, etc. Default fetch in Node 20+
// sends `Accept: */*` — without this header the backend would assume
// the legacy raw-dump path.
const JSON_API_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// ANSI color helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  magenta: '\x1b[35m',
};

const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;

// Synchronous API key check for upsell messaging (avoids async in printTable)
let _cachedHasKey = false;
try {
  const _os = await import('os');
  const _fs = await import('fs');
  const _path = await import('path');
  const _cfg = _fs.readFileSync(_path.join(_os.homedir(), '.commit', 'config'), 'utf-8');
  _cachedHasKey = /^api_key\s*=\s*.+$/m.test(_cfg);
} catch {}

function clr(code, text) {
  if (NO_COLOR) return text;
  return `${code}${text}${c.reset}`;
}

/**
 * Renders a human-readable rate-limit message to stderr and exits with code 1.
 * Parses JSON body from a 429 response.
 *
 * v1.17.0: reads structured `shared_ip_hint` / `instant_key_url` /
 * `packages_already_scored` / `retry_after_seconds` fields (see /api/audit
 * 429 response). Older backends just return `message` + `upgrade_url`;
 * the helper degrades gracefully. Single CTA only — paid upgrade is removed
 * here because dogfood (2026-05-21) found that splitting attention between
 * "free key" and "paid upgrade" lowers free-key conversion on the rescue
 * step. The user is hitting the *free* wall — surface the free fix.
 */
async function handle429(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON fallback — leave data as {}
  }

  const message = data.message || 'Daily free audit limit reached on this network IP.';
  const instantKeyUrl =
    data.instant_key_url ||
    data.upgrade_url ||
    'https://getcommit.dev/get-started?ref=audit-cli-429';
  const partial = Array.isArray(data.packages_already_scored)
    ? data.packages_already_scored
    : [];
  const retryAfter = Number.isFinite(data.retry_after_seconds)
    ? data.retry_after_seconds
    : null;

  // Forward-compat: if backend ever returns partial scoring on 429,
  // print what we have BEFORE the rescue message. Falls back to JSON
  // dump if the row shape isn't a complete table row.
  if (partial.length > 0) {
    try {
      console.log();
      console.log(clr(c.dim, `  Partial results scored before the limit hit (${partial.length}):`));
      printTable(partial, { totalScanned: partial.length });
    } catch {
      console.log(JSON.stringify(partial, null, 2));
    }
  }

  console.error('');
  console.error(clr(c.yellow + c.bold, `⚠  ${message}`));
  if (data.shared_ip_hint) {
    console.error(
      clr(
        c.dim,
        '   Heads up: corporate NAT, CI runners, and dev containers all share egress IPs,'
      )
    );
    console.error(
      clr(c.dim, '   so the free-tier counter ticks faster than your personal usage suggests.')
    );
  }
  console.error('');
  console.error(clr(c.cyan + c.bold, `   → Free API key in 30 seconds (no card): ${instantKeyUrl}`));
  if (retryAfter && retryAfter > 0) {
    const hours = Math.floor(retryAfter / 3600);
    const mins = Math.floor((retryAfter % 3600) / 60);
    const resetIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    console.error(clr(c.dim, `     or wait — free-tier resets in ${resetIn} (00:00 UTC).`));
  }
  console.error('');
  process.exit(1);
}

/** Check if riskFlags array contains a CRITICAL-level flag (handles both "CRITICAL" and "CRITICAL: ..." formats) */
function hasCritical(flags) {
  return flags && flags.some(f => typeof f === 'string' && f.startsWith('CRITICAL'));
}

function riskColor(flags, score) {
  if (hasCritical(flags)) return c.red + c.bold;
  if (score < 40) return c.yellow + c.bold;
  if (score < 60) return c.yellow;
  return c.green;
}

function riskLabel(flags, score) {
  if (hasCritical(flags)) return '🔴 CRITICAL';
  if (score < 40) return '🟠 HIGH';
  if (score < 60) return '🟡 MODERATE';
  if (score < 75) return '🟡 GOOD';
  return '🟢 HEALTHY';
}

function fmtDownloads(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B/wk';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M/wk';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K/wk';
  return n + '/wk';
}

function padEnd(str, len) {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  return str + ' '.repeat(Math.max(0, len - visible.length));
}

function printTable(results, { totalScanned, totalCritical, lockfile } = {}) {
  const isNpm = !results[0] || results[0].ecosystem !== 'golang';
  const COL = {
    name: 20, risk: 14, score: 7, maintainers: 12, downloads: 12, age: 8, provenance: 10,
  };

  const headerParts = [
    padEnd(clr(c.bold, 'Package'), COL.name),
    padEnd(clr(c.bold, 'Risk'), COL.risk),
    padEnd(clr(c.bold, 'Score'), COL.score),
    padEnd(clr(c.bold, 'Publishers'), COL.maintainers),
    padEnd(clr(c.bold, 'Downloads'), COL.downloads),
    padEnd(clr(c.bold, 'Age'), COL.age),
  ];

  // Show Provenance column for npm packages
  if (isNpm) {
    headerParts.push(padEnd(clr(c.bold, 'Provenance'), COL.provenance));
  }

  const header = headerParts.join('  ');
  const divWidth = COL.name + COL.risk + COL.score + COL.maintainers + COL.downloads + COL.age + (isNpm ? COL.provenance + 2 : 0) + 10;
  const divider = '─'.repeat(divWidth);

  console.log('\n' + divider);
  if (lockfile && totalScanned && results.length < totalScanned) {
    console.log(clr(c.dim, `  Top ${results.length} highest-risk of ${totalScanned} packages scanned`));
    console.log(divider);
  }
  console.log(header);
  console.log(divider);

  let criticalInDisplay = 0;
  let provenanceCount = 0;

  for (const pkg of results) {
    const rc = riskColor(pkg.riskFlags, pkg.score);
    const label = riskLabel(pkg.riskFlags, pkg.score);
    if (hasCritical(pkg.riskFlags)) criticalInDisplay++;
    if (pkg.hasProvenance) provenanceCount++;

    // Go modules have no download data
    const isGo = pkg.ecosystem === 'golang';
    const dlDisplay = isGo ? '—' : fmtDownloads(pkg.weeklyDownloads || 0);
    const maintDisplay = pkg.maintainers === 35 ? '30+' : String(pkg.maintainers || '?');

    // Provenance indicator
    const provDisplay = pkg.hasProvenance
      ? clr(c.green, '🔐 verified')
      : clr(c.dim, '—');

    const rowParts = [
      padEnd(pkg.name, COL.name),
      padEnd(clr(rc, label), COL.risk),
      padEnd(String(pkg.score), COL.score),
      padEnd(maintDisplay, COL.maintainers),
      padEnd(dlDisplay, COL.downloads),
      padEnd((pkg.ageYears || '?').toString().replace(/(\.\d).*/, '$1') + 'y', COL.age),
    ];

    if (isNpm) {
      rowParts.push(padEnd(provDisplay, COL.provenance));
    }

    console.log(rowParts.join('  '));

    // Show GitHub contributor context for CRITICAL packages with active communities
    if (hasCritical(pkg.riskFlags) && pkg.githubContributors && pkg.githubContributors > 1) {
      const ghCount = pkg.githubContributors === 35 ? '30+' : pkg.githubContributors;
      console.log(clr(c.dim, `  ↳ ${ghCount} GitHub contributors — publish-access concentration risk despite active community`));
    }

    // Score breakdown if available
    if (pkg.scoreBreakdown) {
      const b = pkg.scoreBreakdown;
      const breakdown = isGo
        ? clr(c.dim,
            `  └ longevity=${b.longevity} releases=${b.releaseConsistency} ` +
            `contributors=${b.maintainerDepth} github=${b.githubBacking} stars=${b.popularityProxy}`
          )
        : clr(c.dim,
            `  └ longevity=${b.longevity} momentum=${b.downloadMomentum} ` +
            `releases=${b.releaseConsistency} publishers=${b.maintainerDepth} github=${b.githubBacking}` +
            (b.trustedPublishing ? ` provenance=${b.trustedPublishing}` : '')
          );
      console.log(breakdown);
    }
  }

  console.log(divider);

  const effectiveCritical = totalCritical !== undefined ? totalCritical : criticalInDisplay;
  if (effectiveCritical > 0) {
    const suffix = totalScanned ? ` (in ${totalScanned} packages scanned)` : '';
    console.log('\n' + clr(c.red + c.bold, `⚠  ${effectiveCritical} CRITICAL package${effectiveCritical > 1 ? 's' : ''} found${suffix}.`));
    console.log(clr(c.dim, '   CRITICAL = sole npm publisher + >10M weekly downloads (publish-access concentration risk)'));
    if (provenanceCount > 0 && provenanceCount < results.length) {
      console.log(clr(c.cyan, `   🔐 ${provenanceCount}/${results.length} use Trusted Publishing (OIDC provenance) — partial mitigation`));
    }
  } else {
    const suffix = totalScanned ? ` (${totalScanned} packages scanned)` : '';
    console.log('\n' + clr(c.green, `✓  No CRITICAL packages found${suffix}.`));
  }

  // Footer with web link + CI integration CTA
  const topPkgs = results.slice(0, 10).map(r => r.name).join(',');
  const utm = 'utm_source=cli&utm_medium=audit';
  console.log(clr(c.cyan, `\n  🔗 Full report: ${WEB}?packages=${encodeURIComponent(topPkgs)}&${utm}`));
  console.log(clr(c.cyan, `  🤖 GitHub Action: github.com/piiiico/commit-action — block CRITICAL packages in CI`));
  console.log(clr(c.dim, `  📋 Add to this project: `) + clr(c.cyan, `poc init`) + clr(c.dim, ` — creates workflow + README badge`));

  // Per-package profile URLs — drive traffic to permanent, indexable pages
  const ecoPath = { npm: 'npm', pypi: 'pypi', cargo: 'cargo', golang: 'go' };
  const profilePkgs = results.slice(0, 5).filter(r => r.name && ecoPath[r.ecosystem || 'npm']);
  if (profilePkgs.length > 0) {
    console.log(clr(c.dim, `\n  📄 Package profiles:`));
    for (const r of profilePkgs) {
      const eco = ecoPath[r.ecosystem || 'npm'];
      const name = encodeURIComponent(r.name).replace(/%40/g, '@').replace(/%2F/g, '/');
      console.log(clr(c.dim, `     getcommit.dev/${eco}/${name}`));
    }
  }

  // Contextual upsell — show when findings make monitoring relevant.
  // In TTY mode, inlineSignup() handles the CRITICAL/risky upsell interactively — skip static text there.
  const hasKey = !!process.env.COMMIT_API_KEY || _cachedHasKey;
  if (effectiveCritical > 0) {
    if (hasKey) {
      console.log(clr(c.dim, `\n  📊 Monitor ${effectiveCritical === 1 ? 'this package' : 'these packages'}: `) +
        clr(c.cyan, `poc watch ${results.find(r => hasCritical(r.riskFlags))?.name || results[0]?.name}`));
    } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
      // Non-TTY (CI, piped): show static URL since interactive prompt won't work
      console.log(clr(c.dim, `\n  📊 Monitor ${effectiveCritical === 1 ? 'this' : 'these ' + effectiveCritical} CRITICAL ${effectiveCritical === 1 ? 'package' : 'packages'} — get alerted when scores change.`));
      console.log(clr(c.dim, '     Get a free API key: ') + clr(c.cyan, 'https://getcommit.dev/get-started?utm_source=cli'));
      console.log(clr(c.dim, '     Then run: ') + clr(c.cyan, 'poc login'));
    }
    // else: TTY mode — inlineSignup() will prompt interactively after printTable
  } else if (!hasKey && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    // HEALTHY case + no saved key + non-TTY (CI/piped): static baseline CTA.
    // In TTY mode, inlineSignup() now prompts interactively for healthy results
    // too — the dim text below converted 0/621 weekly downloads. Keep static
    // text only in CI/piped output where interactive prompts can't fire.
    // ref=audit-baseline distinguishes this funnel from audit-cli-429
    // (rate-limit rescue) and from the static utm_source=cli help-line.
    console.log(clr(c.dim, '\n  📊 Save this scan as your baseline. Re-run anytime with a free key:'));
    console.log(clr(c.dim, '     ') + clr(c.cyan, 'https://getcommit.dev/get-started?ref=audit-baseline&utm_source=cli') + clr(c.dim, '  (200/day free; push alerts on Developer $15/mo)'));
  }
  console.log();
}

/**
 * Inline signup: after any real audit, offer one-step email→key flow.
 * Collapses 6-step funnel (visit site → email → check inbox → copy key → login → watch)
 * into a single CLI prompt.
 *
 * v1.19: Triggers on healthy results too (≥3 packages). The dim "Save this scan
 * as your baseline" footer line converted 0/621 weekly downloads — replacing it
 * with an interactive prompt at the moment of audit success captures more
 * intent. Copy adapts to context: degradation alerts (CRITICAL) vs baseline
 * lock-in (healthy). Quick lookups (<3 packages) still skip the prompt.
 */
async function inlineSignup(results) {
  // Only prompt in interactive TTY when no key saved
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const hasKey = !!process.env.COMMIT_API_KEY || _cachedHasKey;
  if (hasKey) return;
  const critPkgs = results.filter(r => hasCritical(r.riskFlags));
  const lowScorePkgs = results.filter(r => typeof r.score === 'number' && r.score < 60);
  // Gate: ≥3 packages scanned (real audit, not a one-off `npx poc somepkg` check)
  if (results.length < 3) return;

  const hasFindings = critPkgs.length >= 1 || lowScorePkgs.length >= 2;
  // Copy adapts to context. Findings → degradation framing.
  // Healthy → baseline-lock framing (still real value: alert me if any score drops).
  const heading = hasFindings
    ? '  🔔 Lock in this audit. Get alerted if these packages get worse.'
    : '  🔔 Lock in this baseline. Get alerted if any of these packages degrade.';

  console.log(clr(c.dim, '  ─────────────────────────────────────────────'));
  console.log(clr(c.bold, heading));
  console.log(clr(c.dim, '     Free, no card, 10 seconds. Saves to ~/.commit/config.\n'));

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const email = await new Promise(resolve => {
    rl.question(clr(c.dim, '  Your email (Enter to skip): '), answer => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!email) return;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log(clr(c.red, '  Invalid email. Skipped.'));
    return;
  }

  process.stdout.write(clr(c.dim, '  Creating key...'));

  try {
    const res = await fetch('https://poc-backend.amdal-dev.workers.dev/api/keys/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'cli' }),
    });

    const data = await res.json();

    if (data.key) {
      await writeApiKey(data.key);
      _cachedHasKey = true;
      console.log(clr(c.green, ' ✓ Saved to ~/.commit/config'));
      console.log(clr(c.dim, `     Backup sent to ${email}`));
      console.log();
      console.log(clr(c.bold, '  Next steps:'));
      console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc status') + clr(c.dim, '       — check your account'));
      // Surface a concrete watch target. CRITICAL first (highest urgency);
      // otherwise pick the lowest-score package as the most-likely-to-degrade.
      const watchTarget = critPkgs[0]?.name
        || results.slice().sort((a, b) => (a.score || 100) - (b.score || 100))[0]?.name;
      if (watchTarget) {
        console.log(clr(c.dim, '    • ') + clr(c.cyan, `poc watch ${watchTarget}`) + clr(c.dim, '  — start monitoring (Developer $15/mo)'));
      }
      console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc init') + clr(c.dim, '          — add CI gate to this project'));
    } else if (data.message) {
      console.log(clr(c.green, ` ✓ ${data.message}`));
    } else {
      console.log(clr(c.red, ` Failed: ${JSON.stringify(data)}`));
    }
  } catch (err) {
    console.log(clr(c.red, ` Error: ${err.message}`));
  }

  console.log();
}

function printHelp() {
  console.log(`
${clr(c.bold, 'proof-of-commitment')} v1.19.0 — supply chain risk scorer

${clr(c.bold, 'Usage:')}
  npx proof-of-commitment                            Auto-detect manifest in current dir
  npx proof-of-commitment [packages...]              Score npm packages
  npx proof-of-commitment --pypi [pkgs...]           Score PyPI packages
  npx proof-of-commitment --cargo [crates...]        Score Rust crates
  npx proof-of-commitment --golang [modules...]      Score Go modules (full path required)
  npx proof-of-commitment --file package.json        Audit direct dependencies
  npx proof-of-commitment --file package-lock.json   Audit ALL dependencies (lock file)
  npx proof-of-commitment --file yarn.lock           Audit from yarn lock file
  npx proof-of-commitment --file pnpm-lock.yaml      Audit from pnpm lock file
  npx proof-of-commitment --file requirements.txt    Audit Python packages
  npx proof-of-commitment --file Cargo.toml          Audit Rust direct dependencies
  npx proof-of-commitment --file go.mod              Audit Go direct + indirect deps
  npx proof-of-commitment --file go.sum              Audit Go full transitive set

${clr(c.bold, 'Setup:')}
  poc init            Add a GitHub Action + README badge to the current project
                      Auto-detects ecosystem. Blocks CRITICAL packages on every PR.

${clr(c.bold, 'Reports:')}
  poc report          Scan and generate a shareable HTML report + Markdown snippet
  poc report [pkgs]   Same flags as scan — packages, --pypi, --cargo, --file, etc.
                      Saves audit-report.html to cwd + prints Markdown for GitHub issues

${clr(c.bold, 'Account:')}
  poc login [key]     Save and validate your API key (interactive or direct)
  poc status          Show current tier, usage, and limits
  poc logout          Remove saved API key

${clr(c.bold, 'Monitoring (Developer $15/mo+):')}
  poc watch <package> [--ecosystem npm|pypi|cargo|golang]
                      Add a package to daily monitoring
  poc watchlist       List monitored packages with current scores + risk
  poc unwatch <pkg>   Remove a package from monitoring

  Get a free key:        https://getcommit.dev/get-started?utm_source=cli
  Enable monitoring:     https://getcommit.dev/pricing?utm_source=cli&utm_campaign=help

${clr(c.bold, 'Options:')}
  --json              Output results as JSON
  --fail-on=<level>   Exit 1 when findings meet the threshold. Levels:
                        critical  any CRITICAL package (publish-access concentration)
                        risky     any CRITICAL or HIGH (score < 40) package
                        none      always exit 0
                      Defaults: 'critical' in CI (env CI=true) and for --json output;
                      'none' for interactive table output (backward-compatible).
  --pypi              Score PyPI packages instead of npm
  --cargo             Score Rust crates from crates.io
  --golang            Score Go modules from proxy.golang.org (use full path: github.com/owner/repo)
  --file, -f          Read packages from package.json, lock file, requirements.txt, Cargo.toml, or go.mod/go.sum

${clr(c.bold, 'Auto-detect (no args):')}
  Running 'npx proof-of-commitment' with no arguments scans the most-recently-modified
  manifest in the current directory. Detection order (highest transitive coverage first):
    npm:    package-lock.json · yarn.lock · pnpm-lock.yaml · pnpm-workspace.yaml · package.json
    pypi:   requirements.txt
    cargo:  Cargo.toml
    golang: go.sum · go.mod
  When multiple ecosystems are present, the file with the most recent mtime wins.

${clr(c.bold, 'Examples:')}
  npx proof-of-commitment                              # scans cwd manifest
  npx proof-of-commitment axios zod chalk
  npx proof-of-commitment --pypi litellm langchain requests
  npx proof-of-commitment --cargo serde tokio reqwest
  npx proof-of-commitment --golang github.com/gin-gonic/gin golang.org/x/net
  npx proof-of-commitment --file package-lock.json     # scans ALL transitive deps
  npx proof-of-commitment --file go.sum                # scans full Go module graph
  npx proof-of-commitment axios chalk --json | jq '.criticalCount'
  npx proof-of-commitment --fail-on=critical           # CI-friendly hard gate

${clr(c.bold, 'CI integration (GitHub Actions):')}
  # .github/workflows/supply-chain.yml
  jobs:
    audit:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20' }
        - run: npx -y proof-of-commitment --fail-on=critical

  # Block PRs when a dependency hits CRITICAL.
  # Use --fail-on=risky to also block HIGH-risk (score < 40) packages.
  # Alternative: piiiico/commit-action@v1 (annotated PR checks).

${clr(c.bold, 'Score meaning:')}
  🔴 CRITICAL  Sole publisher + >10M downloads/wk (publish-access concentration risk)
  🟠 HIGH      Score < 40
  🟡 MODERATE  Score 40–59
  🟡 GOOD      Score 60–74
  🟢 HEALTHY   Score 75+

${clr(c.bold, 'Provenance (npm):')}
  🔐 verified  Package uses Trusted Publishing (OIDC provenance from CI — not a human credential)
  —            No provenance attestation detected

${clr(c.bold, 'Score dimensions (npm/PyPI/Cargo):')} longevity · download momentum · release consistency · publisher depth · GitHub backing · provenance
${clr(c.bold, 'Score dimensions (Go):')} longevity · release consistency · maintainer depth · GitHub backing · stars

${clr(c.bold, 'MCP:')} https://poc-backend.amdal-dev.workers.dev/mcp — connect from Claude Desktop / Cursor / Cline.
       Free tier: 100 queries/IP/UTC day. Power users: API key for 200/day. ${clr(c.dim, '(Authorization: Bearer sk_commit_…)')}

${clr(c.bold, 'Web:')}  ${WEB}
  `);
}

/**
 * Parse package-lock.json (npm lockfileVersion 2 or 3)
 */
function parseLockNpm(content) {
  const lock = JSON.parse(content);
  const pkgs = new Set();

  if (lock.packages) {
    for (const key of Object.keys(lock.packages)) {
      if (!key || key === '') continue;
      const parts = key.split('node_modules/');
      const pkgPath = parts[parts.length - 1];
      if (pkgPath) pkgs.add(pkgPath);
    }
  } else if (lock.dependencies) {
    for (const name of Object.keys(lock.dependencies)) {
      pkgs.add(name);
    }
  }

  return [...pkgs];
}

/**
 * Parse yarn.lock (v1 format)
 */
function parseLockYarn(content) {
  const pkgs = new Set();
  const headerRe = /^"?(@?[^@\s"]+)@/gm;
  let match;
  while ((match = headerRe.exec(content)) !== null) {
    pkgs.add(match[1]);
  }
  return [...pkgs];
}

/**
 * Parse pnpm-lock.yaml (v6+)
 */
function parseLockPnpm(content) {
  const pkgs = new Set();
  const pkgRe = /^\s+\/?(@?[^@\s/]+(?:\/[^@\s]+)?)@/gm;
  let match;
  while ((match = pkgRe.exec(content)) !== null) {
    pkgs.add(match[1]);
  }
  return [...pkgs];
}

/**
 * Parse pnpm-workspace.yaml — find all workspace packages and aggregate their deps.
 * Expects format:
 *   packages:
 *     - "packages/*"
 *     - "apps/*"
 */
async function parsePnpmWorkspace(content, filePath) {
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.dirname(filePath);
  const pkgs = new Set();

  // Extract glob patterns from YAML
  const patterns = [];
  const lines = content.split('\n');
  let inPackages = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'packages:') { inPackages = true; continue; }
    if (inPackages && line.startsWith('-')) {
      const pattern = line.replace(/^-\s*["']?/, '').replace(/["']?\s*$/, '');
      patterns.push(pattern);
    } else if (inPackages && !line.startsWith('#') && line !== '') {
      break;
    }
  }

  // For each pattern, look for package.json files
  for (const pattern of patterns) {
    const globDir = path.join(dir, pattern.replace('/*', '').replace('/**', ''));
    try {
      const entries = fs.readdirSync(globDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgJsonPath = path.join(globDir, entry.name, 'package.json');
        try {
          const pkgContent = fs.readFileSync(pkgJsonPath, 'utf-8');
          const pkg = JSON.parse(pkgContent);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const name of Object.keys(deps)) pkgs.add(name);
        } catch {}
      }
    } catch {}
  }

  // Also check root package.json
  try {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    const deps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
    for (const name of Object.keys(deps)) pkgs.add(name);
  } catch {}

  return [...pkgs];
}

async function readPackagesFromFile(filePath) {
  const fs = await import('fs');
  const path = await import('path');
  const content = fs.readFileSync(filePath, 'utf-8');
  const basename = path.basename(filePath).toLowerCase();

  // pnpm-workspace.yaml
  if (basename === 'pnpm-workspace.yaml' || basename === 'pnpm-workspace.yml') {
    const pkgs = await parsePnpmWorkspace(content, filePath);
    return { packages: pkgs, ecosystem: 'npm', lockfile: false, totalInFile: pkgs.length };
  }

  // package-lock.json
  if (basename === 'package-lock.json') {
    const pkgs = parseLockNpm(content);
    return { packages: pkgs, ecosystem: 'npm', lockfile: true, totalInFile: pkgs.length };
  }

  // yarn.lock
  if (basename === 'yarn.lock') {
    const pkgs = parseLockYarn(content);
    return { packages: pkgs, ecosystem: 'npm', lockfile: true, totalInFile: pkgs.length };
  }

  // pnpm-lock.yaml
  if (basename === 'pnpm-lock.yaml' || basename === 'pnpm-lock.yml') {
    const pkgs = parseLockPnpm(content);
    return { packages: pkgs, ecosystem: 'npm', lockfile: true, totalInFile: pkgs.length };
  }

  // package.json
  if (basename === 'package.json') {
    const pkg = JSON.parse(content);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    return { packages: Object.keys(deps), ecosystem: 'npm', lockfile: false };
  }

  // requirements.txt
  if (basename === 'requirements.txt' || filePath.endsWith('.txt')) {
    const pkgs = content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.replace(/[>=<!\s].*/,'').trim())
      .filter(Boolean);
    return { packages: pkgs, ecosystem: 'pypi', lockfile: false };
  }

  // Cargo.toml
  if (basename === 'cargo.toml') {
    const pkgs = parseCargoToml(content);
    return { packages: pkgs, ecosystem: 'cargo', lockfile: false };
  }

  // go.mod
  if (basename === 'go.mod') {
    const pkgs = parseGoMod(content);
    return { packages: pkgs, ecosystem: 'golang', lockfile: false, totalInFile: pkgs.length };
  }

  // go.sum
  if (basename === 'go.sum') {
    const pkgs = parseGoSum(content);
    return { packages: pkgs, ecosystem: 'golang', lockfile: true, totalInFile: pkgs.length };
  }

  throw new Error(`Unsupported file: ${basename}. Supported: package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, pnpm-workspace.yaml, requirements.txt, Cargo.toml, go.mod, go.sum`);
}

/**
 * Parse Cargo.toml
 */
function parseCargoToml(content) {
  const pkgs = new Set();
  const lines = content.split('\n');
  let inDeps = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inDeps = /^\[(dev-)?dependencies\]/.test(line);
      continue;
    }
    if (!inDeps || !line || line.startsWith('#')) continue;
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
    if (match) pkgs.add(match[1]);
  }
  return [...pkgs];
}

/**
 * Parse go.mod
 */
function parseGoMod(content) {
  const pkgs = new Set();
  const lines = content.split('\n');
  let inRequireBlock = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    if (/^require\s*\(\s*$/.test(line)) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }

    if (inRequireBlock) {
      const match = line.match(/^([^\s]+)\s+v[^\s]+/);
      if (match) pkgs.add(match[1]);
      continue;
    }

    const single = line.match(/^require\s+([^\s]+)\s+v[^\s]+/);
    if (single) pkgs.add(single[1]);
  }

  return [...pkgs];
}

/**
 * Parse go.sum
 */
function parseGoSum(content) {
  const pkgs = new Set();
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([^\s]+)\s+v[^\s/]+/);
    if (match) pkgs.add(match[1]);
  }
  return [...pkgs];
}

/**
 * Auto-detect the most authoritative manifest in the current directory.
 *
 * Candidate set (ordered within ecosystem by transitive coverage — first preferred):
 *   npm:    package-lock.json, yarn.lock, pnpm-lock.yaml, pnpm-workspace.yaml, package.json
 *   pypi:   requirements.txt
 *   cargo:  Cargo.toml
 *   golang: go.sum, go.mod
 *
 * Selection: among files that exist, prefer the one with the most recent mtime.
 * Ties (same mtime) resolved by the candidate list order above.
 * Returns the basename of the chosen file, or null if no manifest is present.
 */
async function autodetectManifest(cwd) {
  const fs = await import('fs');
  const path = await import('path');

  const candidates = [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'pnpm-lock.yml',
    'pnpm-workspace.yaml',
    'pnpm-workspace.yml',
    'package.json',
    'requirements.txt',
    'Cargo.toml',
    'go.sum',
    'go.mod',
  ];

  const found = [];
  for (let idx = 0; idx < candidates.length; idx++) {
    const name = candidates[idx];
    const full = path.join(cwd, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) found.push({ name, mtime: stat.mtimeMs, order: idx });
    } catch {}
  }

  if (found.length === 0) return null;

  // Sort: newest mtime first; ties resolved by candidate-list order.
  found.sort((a, b) => (b.mtime - a.mtime) || (a.order - b.order));
  return found[0].name;
}

/**
 * Audit packages in batches of 20, in parallel.
 */
async function auditBatched(packages, ecosystem, { onProgress } = {}) {
  const BATCH_SIZE = 20;
  const batches = [];
  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    batches.push(packages.slice(i, i + BATCH_SIZE));
  }

  let completed = 0;
  let batchedCta = null;
  const results = await Promise.all(
    batches.map(async (batch) => {
      const res = await fetch(API, {
        method: 'POST',
        headers: JSON_API_HEADERS,
        body: JSON.stringify({ packages: batch, ecosystem }),
      });
      if (!res.ok) {
        if (res.status === 429) await handle429(res);
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (data._cta) batchedCta = data._cta;
      completed += batch.length;
      if (onProgress) onProgress(completed, packages.length);
      return data.results || [];
    })
  );

  const all = results.flat();

  // Sort: CRITICAL first, then by score ascending
  all.sort((a, b) => {
    const aCrit = hasCritical(a.riskFlags) ? 1 : 0;
    const bCrit = hasCritical(b.riskFlags) ? 1 : 0;
    if (aCrit !== bCrit) return bCrit - aCrit;
    return (a.score || 100) - (b.score || 100);
  });

  return { results: all, _cta: batchedCta };
}

/** Parse --fail-on=<level>. Returns one of 'critical' | 'risky' | 'none'. */
function parseFailOn(raw) {
  const v = String(raw || '').toLowerCase();
  if (v === 'critical' || v === 'risky' || v === 'none') return v;
  throw new Error(`Invalid --fail-on value: '${raw}'. Expected: critical, risky, or none.`);
}

/** Decide exit code given results + fail-on threshold. */
function shouldFail(results, failOn) {
  if (failOn === 'none') return false;
  if (failOn === 'critical') return results.some(r => hasCritical(r.riskFlags));
  if (failOn === 'risky') return results.some(r => hasCritical(r.riskFlags) || (typeof r.score === 'number' && r.score < 40));
  return false;
}

/**
 * Read API key from env or ~/.commit/config file.
 * Returns the key string, or null if not found.
 */
async function readApiKey() {
  if (process.env.COMMIT_API_KEY) return process.env.COMMIT_API_KEY.trim();
  try {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const configPath = path.join(os.homedir(), '.commit', 'config');
    const content = fs.readFileSync(configPath, 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^api_key\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

/**
 * Write API key to ~/.commit/config, creating dir if needed.
 */
async function writeApiKey(key) {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.join(os.homedir(), '.commit');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const configPath = path.join(dir, 'config');
  let lines = [];
  try {
    lines = fs.readFileSync(configPath, 'utf-8').split('\n');
  } catch {}

  // Replace existing api_key line or append
  let found = false;
  lines = lines.map(l => {
    if (/^api_key\s*=/.test(l)) { found = true; return `api_key = ${key}`; }
    return l;
  });
  if (!found) lines.push(`api_key = ${key}`);

  fs.writeFileSync(configPath, lines.filter(l => l !== '').join('\n') + '\n');
  return configPath;
}

/**
 * Remove API key from ~/.commit/config.
 */
async function removeApiKey() {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const configPath = path.join(os.homedir(), '.commit', 'config');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const filtered = content.split('\n').filter(l => !/^api_key\s*=/.test(l)).join('\n');
    fs.writeFileSync(configPath, filtered.trim() ? filtered.trim() + '\n' : '');
    return true;
  } catch { return false; }
}

/**
 * Validate an API key against the usage endpoint. Returns tier info or null.
 */
async function validateApiKey(key) {
  try {
    const res = await fetch(`${KEYS_API}/usage`, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * poc login [key] — save and validate API key
 */
async function cmdLogin(keyArg) {
  let key = keyArg;

  if (!key) {
    // Check if stdin has data (piped input)
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    key = await new Promise(resolve => {
      rl.question(clr(c.dim, '  Enter your API key: '), answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!key || !key.startsWith('sk_commit_')) {
    console.error(clr(c.red, '\n  Invalid API key format. Keys start with sk_commit_'));
    console.error(clr(c.dim, '  Get one at https://getcommit.dev/get-started?utm_source=cli\n'));
    process.exit(1);
  }

  process.stdout.write(clr(c.dim, '  Validating...'));
  const info = await validateApiKey(key);

  if (!info || info.error) {
    console.error(clr(c.red, ' ✗ Invalid or expired API key.'));
    console.error(clr(c.dim, `  ${info?.message || 'Key not recognized.'}`));
    process.exit(1);
  }

  const configPath = await writeApiKey(key);
  console.log(clr(c.green, ' ✓ Authenticated'));
  console.log();
  console.log(clr(c.bold, `  Tier:     `) + tierLabel(info.tier));
  console.log(clr(c.bold, `  Usage:    `) + `${info.requests_used ?? 0}/${info.requests_limit ?? '?'} requests (${info.period || 'daily'})`);
  console.log(clr(c.bold, `  Resets:   `) + (info.period_reset_at || '—'));
  console.log(clr(c.dim, `  Saved to: ${configPath}`));
  console.log();

  if (info.tier === 'developer' || info.tier === 'pro' || info.tier === 'enterprise') {
    console.log(clr(c.cyan, '  Monitoring unlocked:'));
    console.log(clr(c.dim, '    poc watch <package>    Add a package to daily monitoring'));
    console.log(clr(c.dim, '    poc watchlist          View monitored packages'));
    console.log(clr(c.dim, '    poc unwatch <package>  Remove from monitoring'));
  } else {
    console.log(clr(c.dim, '  Enable monitoring + alerts on Developer ($15/mo):'));
    console.log(clr(c.cyan, '    https://getcommit.dev/pricing?utm_source=cli&utm_campaign=post-login'));
  }
  console.log();
}

/**
 * poc status — show current auth + usage
 */
async function cmdStatus() {
  const key = await readApiKey();

  if (!key) {
    console.log(clr(c.dim, '\n  Not logged in.'));
    console.log(clr(c.dim, '  Run ') + clr(c.cyan, 'poc login') + clr(c.dim, ' to authenticate.'));
    console.log(clr(c.dim, '  Get a free key at https://getcommit.dev/get-started?utm_source=cli\n'));
    return;
  }

  process.stdout.write(clr(c.dim, '  Checking...'));
  const info = await validateApiKey(key);

  if (!info || info.error) {
    console.error(clr(c.red, ' ✗ Key invalid or expired.'));
    console.error(clr(c.dim, '  Run ') + clr(c.cyan, 'poc login') + clr(c.dim, ' to re-authenticate.\n'));
    process.exit(1);
  }

  console.log(clr(c.green, ' ✓ Connected'));
  console.log();
  console.log(clr(c.bold, `  Tier:     `) + tierLabel(info.tier));
  console.log(clr(c.bold, `  Usage:    `) + `${info.requests_used ?? 0}/${info.requests_limit ?? '?'} requests (${info.period || 'daily'})`);
  console.log(clr(c.bold, `  Resets:   `) + (info.period_reset_at || '—'));
  console.log(clr(c.bold, `  Prefix:   `) + (info.key_prefix || key.slice(0, 19) + '...'));
  console.log();

  if (info.tier === 'free') {
    const pct = info.requests_limit > 0 ? Math.round((info.requests_used / info.requests_limit) * 100) : 0;
    if (pct >= 80) {
      console.log(clr(c.yellow, `  ⚠ ${pct}% of daily limit used. Developer ($15/mo) gets 10K/month + monitoring:`));
      console.log(clr(c.cyan, `    https://getcommit.dev/pricing?utm_source=cli&utm_campaign=status-limit`));
    }
  }
}

/**
 * poc logout — remove saved API key
 */
async function cmdLogout() {
  const removed = await removeApiKey();
  if (removed) {
    console.log(clr(c.green, '\n  ✓ Logged out. API key removed from ~/.commit/config.'));
  } else {
    console.log(clr(c.dim, '\n  No saved API key found.'));
  }
  console.log();
}

function tierLabel(tier) {
  if (tier === 'pro') return clr(c.cyan + c.bold, 'Pro');
  if (tier === 'enterprise') return clr(c.magenta + c.bold, 'Enterprise');
  if (tier === 'developer') return clr(c.green + c.bold, 'Developer');
  return clr(c.dim, 'Free');
}

/**
 * Handle 402 upgrade response from watchlist endpoints.
 * Reads server response so the tier name, price, and URL stay authoritative
 * (server is canonical — CLI was historically out of date saying "Pro" when
 * "Developer" was the actual gate). Appends CLI UTM for attribution.
 */
async function printUpgradeRequired(res, campaign = 'watchlist-402') {
  let body = null;
  try { body = await res.json(); } catch {}
  const plan = (body && body.upgrade && body.upgrade.plan) || 'developer';
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const price = (body && body.upgrade && body.upgrade.price) || '$15/month';
  const baseUrl = (body && body.upgrade && body.upgrade.url) || 'https://getcommit.dev/pricing';
  const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + `utm_source=cli&utm_campaign=${campaign}`;
  const currentTier = body && body.current_tier ? body.current_tier : 'free';

  console.error(clr(c.yellow + c.bold, `\n  ✦ ${planLabel} (${price}) required`));
  console.error(clr(c.dim, `    Monitoring, daily scans, and alerts start on ${planLabel}.`));
  console.error(clr(c.dim, `    Current tier: ${currentTier}`));
  console.error(clr(c.cyan, `    Upgrade at ${url}\n`));
}

/**
 * poc watch <package> [--ecosystem npm|pypi|cargo|golang]
 */
async function cmdWatch(pkg, ecosystem) {
  const key = await readApiKey();
  if (!key) {
    console.error(clr(c.red, 'No API key found. Set COMMIT_API_KEY or add api_key=<key> to ~/.commit/config'));
    console.error(clr(c.dim, 'Get a key at https://getcommit.dev/pricing?utm_source=cli'));
    process.exit(1);
  }

  process.stdout.write(clr(c.dim, `Adding ${pkg} (${ecosystem}) to watchlist...`));
  const res = await fetch(WATCHLIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ package: pkg, ecosystem }),
  });

  if (res.status === 402) { process.stdout.write('\n'); await printUpgradeRequired(res, 'watch-cmd'); process.exit(1); }

  const data = await res.json();
  if (!res.ok) {
    console.error(`\n${clr(c.red, 'Error:')} ${data.message || JSON.stringify(data)}`);
    process.exit(1);
  }

  const isNew = data.new_packages > 0;
  process.stdout.write('\n');
  if (isNew) {
    console.log(clr(c.green, `  ✓ Now watching ${pkg}`));
    console.log(clr(c.dim, '    Daily scan runs at 06:00 UTC. Alerts on score drop ≥10 or CRITICAL threshold.'));
  } else {
    console.log(clr(c.dim, `  ↩ ${pkg} is already in your watchlist`));
  }
}

/**
 * poc watchlist — show monitored packages table
 */
async function cmdWatchlist() {
  const key = await readApiKey();
  if (!key) {
    console.error(clr(c.red, 'No API key found. Set COMMIT_API_KEY or add api_key=<key> to ~/.commit/config'));
    process.exit(1);
  }

  const res = await fetch(WATCHLIST_API, {
    headers: { 'Authorization': `Bearer ${key}` },
  });

  if (res.status === 402) { await printUpgradeRequired(res, 'watchlist-cmd'); process.exit(1); }

  const data = await res.json();
  if (!res.ok) {
    console.error(clr(c.red, `Error: ${data.message || JSON.stringify(data)}`));
    process.exit(1);
  }

  const pkgs = data.packages || [];
  if (pkgs.length === 0) {
    console.log(clr(c.dim, '\n  No packages monitored yet.'));
    console.log(clr(c.dim, '  Add one: poc watch <package>\n'));
    return;
  }

  const COL = { name: 24, eco: 8, score: 7, prev: 7, risk: 14, scanned: 22 };

  function riskLabelFromLevel(level) {
    if (!level) return clr(c.dim, '—');
    if (level === 'CRITICAL') return clr(c.red + c.bold, '🔴 CRITICAL');
    if (level === 'HIGH') return clr(c.yellow + c.bold, '🟠 HIGH');
    if (level === 'MODERATE') return clr(c.yellow, '🟡 MODERATE');
    if (level === 'GOOD') return clr(c.yellow, '🟡 GOOD');
    return clr(c.green, '🟢 HEALTHY');
  }

  const header = [
    padEnd(clr(c.bold, 'Package'), COL.name),
    padEnd(clr(c.bold, 'Eco'), COL.eco),
    padEnd(clr(c.bold, 'Score'), COL.score),
    padEnd(clr(c.bold, 'Prev'), COL.prev),
    padEnd(clr(c.bold, 'Risk'), COL.risk),
    padEnd(clr(c.bold, 'Last scanned'), COL.scanned),
  ].join('  ');

  const divWidth = COL.name + COL.eco + COL.score + COL.prev + COL.risk + COL.scanned + 10;
  const divider = '─'.repeat(divWidth);

  console.log('\n' + divider);
  console.log(clr(c.dim, `  Commit watchlist · ${pkgs.length}/${data.limit} packages · tier: ${data.tier}`));
  console.log(divider);
  console.log(header);
  console.log(divider);

  for (const pkg of pkgs) {
    const scoreStr = pkg.current_score !== null ? String(pkg.current_score) : clr(c.dim, '—');
    const prevStr = pkg.previous_score !== null ? String(pkg.previous_score) : clr(c.dim, '—');
    const scanned = pkg.last_scanned_at ? pkg.last_scanned_at.replace('T', ' ').slice(0, 19) + ' UTC' : clr(c.dim, 'not yet');

    const row = [
      padEnd(pkg.name, COL.name),
      padEnd(pkg.ecosystem, COL.eco),
      padEnd(scoreStr, COL.score),
      padEnd(prevStr, COL.prev),
      padEnd(riskLabelFromLevel(pkg.risk_level), COL.risk),
      padEnd(scanned, COL.scanned),
    ].join('  ');
    console.log(row);
  }

  console.log(divider);
  console.log(clr(c.dim, '\n  Alerts sent on: score drop ≥10 · CRITICAL threshold · recovery to HEALTHY'));
  console.log(clr(c.cyan, '  Remove a package: poc unwatch <package>\n'));
}

/**
 * poc unwatch <package> [--ecosystem npm|pypi|cargo|golang]
 */
async function cmdUnwatch(pkg, ecosystem) {
  const key = await readApiKey();
  if (!key) {
    console.error(clr(c.red, 'No API key found. Set COMMIT_API_KEY or add api_key=<key> to ~/.commit/config'));
    process.exit(1);
  }

  process.stdout.write(clr(c.dim, `Removing ${pkg} (${ecosystem}) from watchlist...`));
  const res = await fetch(WATCHLIST_API, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ package: pkg, ecosystem }),
  });

  if (res.status === 402) { process.stdout.write('\n'); await printUpgradeRequired(res, 'unwatch-cmd'); process.exit(1); }

  const data = await res.json();
  if (!res.ok) {
    console.error(`\n${clr(c.red, 'Error:')} ${data.message || JSON.stringify(data)}`);
    process.exit(1);
  }

  process.stdout.write('\n');
  if ((data.removed ?? 0) > 0) {
    console.log(clr(c.green, `  ✓ Removed ${pkg} from watchlist`));
  } else {
    console.log(clr(c.dim, `  ${pkg} was not in your watchlist`));
  }
}

/**
 * Generate a self-contained HTML report from audit results.
 * Returns the full HTML string.
 */
function buildHtmlReport(results, { ecosystem, scannedFrom, totalScanned } = {}) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const topPkgs = results.slice(0, 20).map(r => r.name).join(',');
  const webUrl = `${WEB}?packages=${encodeURIComponent(topPkgs)}`;

  const criticalCount = results.filter(r => hasCritical(r.riskFlags)).length;
  const healthyCount = results.filter(r => !hasCritical(r.riskFlags) && (r.score || 0) >= 75).length;

  function riskBadge(pkg) {
    if (hasCritical(pkg.riskFlags)) return '<span class="badge critical">CRITICAL</span>';
    if ((pkg.score || 100) < 40) return '<span class="badge high">HIGH</span>';
    if ((pkg.score || 100) < 60) return '<span class="badge moderate">MODERATE</span>';
    if ((pkg.score || 100) < 75) return '<span class="badge good">GOOD</span>';
    return '<span class="badge healthy">HEALTHY</span>';
  }

  function provBadge(pkg) {
    if (pkg.ecosystem === 'golang') return '';
    return pkg.hasProvenance ? '<span class="prov">🔐</span>' : '';
  }

  function fmtDl(n) {
    if (!n) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B/wk';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M/wk';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K/wk';
    return n + '/wk';
  }

  const rows = results.map(pkg => {
    const isGo = pkg.ecosystem === 'golang';
    return `<tr class="${hasCritical(pkg.riskFlags) ? 'row-critical' : ''}">
      <td class="pkg-name">${escHtml(pkg.name)}${provBadge(pkg)}</td>
      <td>${riskBadge(pkg)}</td>
      <td class="score">${pkg.score ?? '?'}</td>
      <td>${pkg.maintainers === 35 ? '30+' : (pkg.maintainers ?? '?')}</td>
      <td>${isGo ? '—' : fmtDl(pkg.weeklyDownloads)}</td>
      <td>${pkg.ageYears ? pkg.ageYears.toString().replace(/(\.\d).*/, '$1') + 'y' : '?'}</td>
    </tr>`;
  }).join('\n');

  const summaryLabel = criticalCount > 0
    ? `⚠ ${criticalCount} CRITICAL package${criticalCount > 1 ? 's' : ''} found`
    : `✓ No CRITICAL packages`;

  const summaryClass = criticalCount > 0 ? 'summary-critical' : 'summary-ok';

  const scannedLine = scannedFrom
    ? `<span>Scanned from <code>${escHtml(scannedFrom)}</code></span> · `
    : '';
  const totalLine = totalScanned && totalScanned > results.length
    ? `showing top ${results.length} of ${totalScanned} packages · `
    : `${results.length} package${results.length !== 1 ? 's' : ''} · `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supply chain audit — proof-of-commitment</title>
<style>
  :root { --red:#ef4444;--orange:#f97316;--yellow:#eab308;--green:#22c55e;--cyan:#06b6d4;--bg:#0f172a;--surface:#1e293b;--border:#334155;--text:#f1f5f9;--muted:#94a3b8; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; background: var(--bg); color: var(--text); padding: 2rem; line-height: 1.5; font-size: 14px; }
  .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .logo { font-size: 1.1rem; font-weight: bold; color: var(--cyan); }
  .logo a { color: inherit; text-decoration: none; }
  .web-link { margin-left: auto; }
  .web-link a { color: var(--cyan); text-decoration: none; font-size: 0.85rem; border: 1px solid var(--border); padding: 0.3rem 0.75rem; border-radius: 4px; }
  .web-link a:hover { background: var(--surface); }
  .summary { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1.5rem; font-weight: bold; }
  .summary-critical { background: rgba(239,68,68,0.15); border: 1px solid var(--red); color: var(--red); }
  .summary-ok { background: rgba(34,197,94,0.1); border: 1px solid var(--green); color: var(--green); }
  .meta { color: var(--muted); font-size: 0.8rem; margin-bottom: 1.5rem; }
  .meta code { background: var(--surface); padding: 0.1rem 0.3rem; border-radius: 3px; }
  table { width: 100%; border-collapse: collapse; }
  thead { border-bottom: 1px solid var(--border); }
  th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: normal; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid rgba(51,65,85,0.5); }
  tr.row-critical { background: rgba(239,68,68,0.07); }
  .pkg-name { font-weight: bold; }
  .prov { margin-left: 0.4rem; font-size: 0.9em; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 3px; font-size: 0.75rem; font-weight: bold; }
  .badge.critical { background: rgba(239,68,68,0.2); color: var(--red); border: 1px solid var(--red); }
  .badge.high { background: rgba(249,115,22,0.15); color: var(--orange); border: 1px solid var(--orange); }
  .badge.moderate { background: rgba(234,179,8,0.15); color: var(--yellow); border: 1px solid var(--yellow); }
  .badge.good { background: rgba(234,179,8,0.1); color: var(--yellow); border: 1px solid rgba(234,179,8,0.5); }
  .badge.healthy { background: rgba(34,197,94,0.1); color: var(--green); border: 1px solid var(--green); }
  .score { color: var(--muted); }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .footer a { color: var(--cyan); text-decoration: none; }
  .md-section { margin-top: 2rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; }
  .md-label { color: var(--muted); font-size: 0.75rem; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .md-copy { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.75rem; font-size: 0.8rem; white-space: pre; overflow-x: auto; color: var(--text); }
  .copy-btn { float: right; cursor: pointer; background: var(--border); border: none; color: var(--text); padding: 0.2rem 0.6rem; border-radius: 3px; font-size: 0.75rem; font-family: inherit; }
  .copy-btn:hover { background: var(--cyan); color: var(--bg); }
</style>
</head>
<body>
<div class="header">
  <div class="logo"><a href="${WEB}" target="_blank">proof-of-commitment</a></div>
  <div class="web-link"><a href="${webUrl}" target="_blank">🔗 Open in browser →</a></div>
</div>
<div class="summary ${summaryClass}">${summaryLabel}</div>
<div class="meta">${scannedLine}${totalLine}${ecosystem || 'npm'} · generated ${ts}</div>
<table>
  <thead><tr>
    <th>Package</th><th>Risk</th><th>Score</th><th>Publishers</th><th>Downloads</th><th>Age</th>
  </tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<div class="md-section">
  <div class="md-label">Copy for GitHub issues / Slack <button class="copy-btn" onclick="copyMd()">Copy</button></div>
  <div class="md-copy" id="md-content">${escHtml(buildMarkdown(results, { ecosystem, scannedFrom, totalScanned, webUrl }))}</div>
</div>
<div class="footer">
  <span>Generated by <a href="${WEB}" target="_blank">proof-of-commitment</a></span>
  <span><a href="https://github.com/piiiico/commit-action" target="_blank">GitHub Action</a></span>
  <span><a href="https://getcommit.dev/pricing?utm_source=cli&amp;utm_medium=report" target="_blank">Enable monitoring</a></span>
</div>
<script>
function copyMd() {
  const text = document.getElementById('md-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '✓ Copied';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
</script>
</body>
</html>`;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildMarkdown(results, { ecosystem, scannedFrom, totalScanned, webUrl } = {}) {
  const criticalCount = results.filter(r => hasCritical(r.riskFlags)).length;
  const summaryLine = criticalCount > 0
    ? `⚠ **${criticalCount} CRITICAL package${criticalCount > 1 ? 's' : ''} found**`
    : `✅ No CRITICAL packages`;

  function riskEmoji(pkg) {
    if (hasCritical(pkg.riskFlags)) return '🔴 CRITICAL';
    if ((pkg.score || 100) < 40) return '🟠 HIGH';
    if ((pkg.score || 100) < 60) return '🟡 MODERATE';
    if ((pkg.score || 100) < 75) return '🟡 GOOD';
    return '🟢 HEALTHY';
  }

  const header = `| Package | Risk | Score | Publishers | Downloads |
|---------|------|-------|------------|-----------|`;

  function fmtDl(n) {
    if (!n) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M/wk';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K/wk';
    return n + '/wk';
  }

  const rows = results.map(pkg => {
    const maintDisplay = pkg.maintainers === 35 ? '30+' : (pkg.maintainers ?? '?');
    const dlDisplay = pkg.ecosystem === 'golang' ? '—' : fmtDl(pkg.weeklyDownloads);
    return `| ${pkg.name}${pkg.hasProvenance ? ' 🔐' : ''} | ${riskEmoji(pkg)} | ${pkg.score ?? '?'} | ${maintDisplay} | ${dlDisplay} |`;
  }).join('\n');

  const scannedNote = scannedFrom ? ` (from \`${scannedFrom}\`)` : '';
  const totalNote = totalScanned && totalScanned > results.length ? `, top ${results.length} of ${totalScanned}` : '';
  const footer = `\n*Scanned ${results.length} ${ecosystem || 'npm'} package${results.length !== 1 ? 's' : ''}${scannedNote}${totalNote} with [proof-of-commitment](https://getcommit.dev) · [Full report](${webUrl || WEB})*`;

  return `## Supply chain audit\n\n${summaryLine}\n\n${header}\n${rows}${footer}`;
}

/**
 * poc report — generate shareable HTML report + Markdown snippet
 */
async function cmdReport(packages, ecosystem, { filePath, isLockfile, totalScanned } = {}) {
  const fs = await import('fs');

  process.stdout.write(clr(c.dim, `Scoring ${packages.length} ${ecosystem} package${packages.length > 1 ? 's' : ''}...`));
  const t0 = Date.now();

  let allResults;
  try {
    if (packages.length <= 20) {
      const res = await fetch(API, {
        method: 'POST',
        headers: JSON_API_HEADERS,
        body: JSON.stringify({ packages, ecosystem }),
      });
      if (!res.ok) {
        if (res.status === 429) await handle429(res);
        throw new Error(`API error ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      allResults = data.results || [];
    } else {
      allResults = (await auditBatched(packages, ecosystem)).results;
    }
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(clr(c.dim, ` done in ${elapsed}s\n\n`));

  // Sort: CRITICAL first, then by score ascending
  allResults.sort((a, b) => {
    const aCrit = hasCritical(a.riskFlags) ? 1 : 0;
    const bCrit = hasCritical(b.riskFlags) ? 1 : 0;
    if (aCrit !== bCrit) return bCrit - aCrit;
    return (a.score || 100) - (b.score || 100);
  });

  const displayResults = allResults.slice(0, 50);
  const topPkgs = displayResults.slice(0, 20).map(r => r.name).join(',');
  const webUrl = `${WEB}?packages=${encodeURIComponent(topPkgs)}`;

  // Save HTML report
  const outFile = 'audit-report.html';
  const html = buildHtmlReport(displayResults, {
    ecosystem,
    scannedFrom: filePath ? filePath.split('/').pop() : null,
    totalScanned: totalScanned || allResults.length,
  });
  fs.writeFileSync(outFile, html);

  // Print Markdown snippet
  const md = buildMarkdown(displayResults, {
    ecosystem,
    scannedFrom: filePath ? filePath.split('/').pop() : null,
    totalScanned: totalScanned || allResults.length,
    webUrl,
  });

  console.log(clr(c.bold, 'Markdown snippet') + clr(c.dim, ' (paste into GitHub issues, PRs, Slack):'));
  console.log(clr(c.dim, '─'.repeat(60)));
  console.log(md);
  console.log(clr(c.dim, '─'.repeat(60)));
  console.log();
  console.log(clr(c.green, `  ✓ HTML report saved → ${outFile}`));
  console.log(clr(c.cyan, `  🔗 Web report: ${webUrl}`));
  console.log();
}

/**
 * poc init — scaffold a GitHub Action workflow + README badge for the current project.
 * Turns every CLI user into a permanent distribution node.
 */
async function cmdInit() {
  const fs = await import('fs');
  const path = await import('path');
  const cwd = process.cwd();

  // Detect ecosystem from project files
  let ecosystem = 'npm';
  let manifestName = 'package.json';
  const checks = [
    ['package.json', 'npm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'npm'],
    ['pnpm-lock.yaml', 'npm'],
    ['requirements.txt', 'pypi'],
    ['Cargo.toml', 'cargo'],
    ['go.mod', 'golang'],
  ];
  for (const [file, eco] of checks) {
    if (fs.existsSync(path.join(cwd, file))) {
      ecosystem = eco;
      manifestName = file;
      break;
    }
  }

  console.log(clr(c.bold, '\n  Commit — supply chain audit for CI\n'));
  console.log(clr(c.dim, `  Detected: ${manifestName} (${ecosystem})`));

  // ── 1. GitHub Action workflow ──
  const workflowDir = path.join(cwd, '.github', 'workflows');
  const workflowPath = path.join(workflowDir, 'commit-audit.yml');

  const ecoFlag = ecosystem === 'npm' ? '' : ` --${ecosystem === 'golang' ? 'go' : ecosystem}`;
  const workflowContent = `# Supply chain audit — powered by Commit (getcommit.dev)
# Scores dependencies on behavioral signals: publisher concentration,
# download anomalies, release patterns, trusted publishing adoption.
# Blocks PRs when CRITICAL packages are found (configurable).

name: Supply Chain Audit

on:
  pull_request:
  push:
    branches: [main, master]
  schedule:
    - cron: '0 9 * * 1'  # Weekly Monday 09:00 UTC

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx -y proof-of-commitment${ecoFlag} --fail-on=critical
`;

  let workflowCreated = false;
  if (fs.existsSync(workflowPath)) {
    console.log(clr(c.yellow, `  ⚠ .github/workflows/commit-audit.yml already exists — skipped`));
  } else {
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(workflowPath, workflowContent);
    workflowCreated = true;
    console.log(clr(c.green, `  ✓ Created .github/workflows/commit-audit.yml`));
  }

  // ── 2. README badge ──
  // Try to read project name from package.json or directory name
  let projectName = path.basename(cwd);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    if (pkg.name) projectName = pkg.name;
  } catch {}

  const badgeUrl = `https://poc-backend.amdal-dev.workers.dev/badge/npm/${encodeURIComponent(projectName)}`;
  const auditUrl = `https://getcommit.dev/audit?packages=${encodeURIComponent(projectName)}`;
  const badgeMd = `[![Commit Score](${badgeUrl})](${auditUrl})`;

  console.log(clr(c.green, `  ✓ README badge (paste into your README.md):\n`));
  console.log(`    ${badgeMd}\n`);

  // ── 3. Try to auto-insert badge into README ──
  let badgeInserted = false;
  const readmeCandidates = ['README.md', 'readme.md', 'Readme.md'];
  for (const name of readmeCandidates) {
    const readmePath = path.join(cwd, name);
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf-8');
      if (content.includes('Commit Score') || content.includes('poc-backend.amdal-dev.workers.dev/badge')) {
        console.log(clr(c.dim, `  Badge already in ${name} — skipped`));
        badgeInserted = true;
        break;
      }
      // Insert after the first H1 heading, or at the top
      const h1Match = content.match(/^#\s+.+$/m);
      let newContent;
      if (h1Match) {
        const insertPos = h1Match.index + h1Match[0].length;
        newContent = content.slice(0, insertPos) + '\n\n' + badgeMd + content.slice(insertPos);
      } else {
        newContent = badgeMd + '\n\n' + content;
      }
      fs.writeFileSync(readmePath, newContent);
      badgeInserted = true;
      console.log(clr(c.green, `  ✓ Badge added to ${name}`));
      break;
    }
  }
  if (!badgeInserted) {
    console.log(clr(c.dim, `  No README found — paste the badge manually`));
  }

  // ── 4. Next steps ──
  console.log(clr(c.bold, '\n  What happens next:\n'));
  if (workflowCreated) {
    console.log(clr(c.white, '  1. Commit and push — the Action runs on your next PR'));
    console.log(clr(c.white, '  2. PRs with CRITICAL dependencies are blocked automatically'));
    console.log(clr(c.white, '  3. The badge updates daily with your project\'s score'));
  } else {
    console.log(clr(c.white, '  1. The badge updates daily with your project\'s score'));
    console.log(clr(c.white, '  2. Push to trigger the existing workflow'));
  }
  console.log(clr(c.dim, `\n  Want daily monitoring + alerts on your dependencies?`));
  console.log(clr(c.dim, '    1. Free key (200 scans/day):  ') + clr(c.cyan, 'https://getcommit.dev/get-started?utm_source=cli'));
  console.log(clr(c.dim, '    2. Authenticate:              ') + clr(c.cyan, 'poc login'));
  console.log(clr(c.dim, '    3. Enable monitoring ($15/mo): ') + clr(c.cyan, 'https://getcommit.dev/pricing?utm_source=cli&utm_campaign=init'));
  console.log(clr(c.dim, '    4. Watch a package:           ') + clr(c.cyan, 'poc watch <package>\n'));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Subcommands
  const subcmd = args[0];

  if (subcmd === 'init') {
    await cmdInit();
    process.exit(0);
  }

  if (subcmd === 'login') {
    const keyArg = args[1] || null;
    await cmdLogin(keyArg);
    process.exit(0);
  }

  if (subcmd === 'status') {
    await cmdStatus();
    process.exit(0);
  }

  if (subcmd === 'logout') {
    await cmdLogout();
    process.exit(0);
  }

  if (subcmd === 'report') {
    // Parse report args (same flags as main scan)
    const reportArgs = args.slice(1);
    let ecosystem = 'npm';
    let packages = [];
    let filePath = null;
    let totalInFile = 0;

    let ri = 0;
    while (ri < reportArgs.length) {
      const a = reportArgs[ri];
      if (a === '--pypi') { ecosystem = 'pypi'; ri++; }
      else if (a === '--npm') { ecosystem = 'npm'; ri++; }
      else if (a === '--cargo') { ecosystem = 'cargo'; ri++; }
      else if (a === '--golang' || a === '--go') { ecosystem = 'golang'; ri++; }
      else if (a === '--file' || a === '-f') { filePath = reportArgs[++ri]; ri++; }
      else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(1); }
      else { packages.push(a); ri++; }
    }

    if (!filePath && packages.length === 0) {
      const detected = await autodetectManifest(process.cwd());
      if (detected) {
        filePath = detected;
        console.log(clr(c.dim, `Auto-detected manifest: ${detected}`));
      } else {
        console.error('No packages specified and no manifest found. Run: poc report [packages...] or --file <manifest>');
        process.exit(1);
      }
    }

    if (filePath) {
      try {
        const result = await readPackagesFromFile(filePath);
        packages = result.packages;
        ecosystem = result.ecosystem;
        totalInFile = result.totalInFile || packages.length;
        console.log(clr(c.dim, `Detected ${totalInFile} packages from ${filePath} (${ecosystem})`));
      } catch (err) {
        console.error(`Error reading ${filePath}: ${err.message}`);
        process.exit(1);
      }
    }

    if (packages.length === 0) { console.error('No packages found.'); process.exit(1); }
    await cmdReport(packages, ecosystem, { filePath, totalScanned: totalInFile || packages.length });
    process.exit(0);
  }

  if (subcmd === 'watch') {
    const pkg = args[1];
    if (!pkg) { console.error('Usage: poc watch <package> [--ecosystem npm|pypi|cargo|golang]'); process.exit(1); }
    let ecosystem = 'npm';
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--ecosystem' || args[i] === '-e') ecosystem = args[++i] || 'npm';
      else if (args[i] === '--pypi') ecosystem = 'pypi';
      else if (args[i] === '--cargo') ecosystem = 'cargo';
      else if (args[i] === '--golang' || args[i] === '--go') ecosystem = 'golang';
    }
    await cmdWatch(pkg, ecosystem);
    process.exit(0);
  }

  if (subcmd === 'watchlist') {
    await cmdWatchlist();
    process.exit(0);
  }

  if (subcmd === 'unwatch') {
    const pkg = args[1];
    if (!pkg) { console.error('Usage: poc unwatch <package> [--ecosystem npm|pypi|cargo|golang]'); process.exit(1); }
    let ecosystem = 'npm';
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--ecosystem' || args[i] === '-e') ecosystem = args[++i] || 'npm';
      else if (args[i] === '--pypi') ecosystem = 'pypi';
      else if (args[i] === '--cargo') ecosystem = 'cargo';
      else if (args[i] === '--golang' || args[i] === '--go') ecosystem = 'golang';
    }
    await cmdUnwatch(pkg, ecosystem);
    process.exit(0);
  }

  let ecosystem = 'npm';
  let packages = [];
  let filePath = null;
  let isLockfile = false;
  let totalInFile = 0;
  let jsonOutput = false;
  // null means "default later" — depends on output mode and CI env.
  let failOn = null;

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--pypi') { ecosystem = 'pypi'; i++; }
    else if (a === '--npm') { ecosystem = 'npm'; i++; }
    else if (a === '--cargo') { ecosystem = 'cargo'; i++; }
    else if (a === '--golang' || a === '--go') { ecosystem = 'golang'; i++; }
    else if (a === '--json') { jsonOutput = true; i++; }
    else if (a.startsWith('--fail-on=')) {
      try { failOn = parseFailOn(a.slice('--fail-on='.length)); }
      catch (err) { console.error(err.message); process.exit(2); }
      i++;
    }
    else if (a === '--fail-on') {
      try { failOn = parseFailOn(args[++i]); }
      catch (err) { console.error(err.message); process.exit(2); }
      i++;
    }
    else if (a === '--file' || a === '-f') {
      filePath = args[++i];
      i++;
    }
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
    else { packages.push(a); i++; }
  }

  // Zero-arg auto-detect: if no positional packages and no --file, look for a manifest in cwd.
  if (!filePath && packages.length === 0) {
    const detected = await autodetectManifest(process.cwd());
    if (detected) {
      filePath = detected;
      if (!jsonOutput) console.log(clr(c.dim, `Auto-detected manifest: ${detected}`));
    } else {
      // No positional packages, no --file, and no manifest in cwd → print help.
      // This preserves the prior "bare invocation" UX rather than failing silently.
      printHelp();
      process.exit(0);
    }
  }

  if (filePath) {
    try {
      const result = await readPackagesFromFile(filePath);
      packages = result.packages;
      ecosystem = result.ecosystem;
      isLockfile = result.lockfile || false;
      totalInFile = result.totalInFile || packages.length;
      if (!jsonOutput) console.log(clr(c.dim, `Detected ${totalInFile} packages from ${filePath} (${ecosystem})`));
    } catch (err) {
      console.error(`Error reading ${filePath}: ${err.message}`);
      process.exit(1);
    }
  }

  if (packages.length === 0) {
    console.error('No packages specified. Run with --help for usage.');
    process.exit(1);
  }

  // Resolve fail-on default.
  //   - User passed --fail-on=X       → use X (already set).
  //   - CI env (CI=true or =1)        → 'critical' (hard gate by default in CI).
  //   - --json output (no CI)         → 'critical' (preserves v1.7.x behavior).
  //   - interactive table output      → 'none' (backward-compatible for casual users).
  if (failOn === null) {
    const ciEnv = process.env.CI;
    const inCI = ciEnv === 'true' || ciEnv === '1';
    if (inCI || jsonOutput) failOn = 'critical';
    else failOn = 'none';
  }

  const t0 = Date.now();

  let allResults;
  let apiCta = null;

  if (packages.length <= 20) {
    if (!jsonOutput) process.stdout.write(clr(c.dim, `Scoring ${packages.length} ${ecosystem} package${packages.length > 1 ? 's' : ''}...`));

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: JSON_API_HEADERS,
        body: JSON.stringify({ packages, ecosystem }),
      });
      if (!res.ok) {
        if (res.status === 429) await handle429(res);
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      const data = await res.json();
      allResults = data.results || [];
      apiCta = data._cta || null;
    } catch (err) {
      console.error(`\nError: ${err.message}`);
      process.exit(1);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (!jsonOutput) process.stdout.write(clr(c.dim, ` done in ${elapsed}s\n`));

  } else {
    const batches = Math.ceil(packages.length / 20);
    if (!jsonOutput) process.stdout.write(clr(c.dim, `Scanning ${packages.length} packages (${batches} batches in parallel)...`));

    let lastPct = 0;
    try {
      const batchResult = await auditBatched(packages, ecosystem, {
        onProgress: (done, total) => {
          const pct = Math.round((done / total) * 100);
          if (pct >= lastPct + 20) {
            process.stdout.write(clr(c.dim, ` ${pct}%`));
            lastPct = pct;
          }
        }
      });
      allResults = batchResult.results;
      apiCta = batchResult._cta;
    } catch (err) {
      console.error(`\nError: ${err.message}`);
      process.exit(1);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (!jsonOutput) process.stdout.write(clr(c.dim, ` done in ${elapsed}s\n`));

    if (jsonOutput) {
      const criticalCount = allResults.filter(r => hasCritical(r.riskFlags)).length;
      const provenanceCount = allResults.filter(r => r.hasProvenance).length;
      console.log(JSON.stringify({
        totalScanned: allResults.length,
        criticalCount,
        provenanceCount,
        failOn,
        results: allResults,
      }, null, 2));
      process.exit(shouldFail(allResults, failOn) ? 1 : 0);
    }

    // Lock files: show top 25 highest-risk
    const MAX_DISPLAY = 25;
    const displayed = allResults.slice(0, MAX_DISPLAY);
    const criticalTotal = allResults.filter(r => hasCritical(r.riskFlags)).length;
    printTable(displayed, { totalScanned: allResults.length, totalCritical: criticalTotal, lockfile: true });
    if (apiCta) console.log(clr(c.dim + c.cyan, `\n  ${apiCta}`));
    await inlineSignup(displayed);
    if (shouldFail(allResults, failOn)) {
      console.error(clr(c.red + c.bold, `\n✗ --fail-on=${failOn} threshold met. Exit 1.`));
      process.exit(1);
    }
    return;
  }

  if (!allResults || allResults.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ totalScanned: 0, criticalCount: 0, provenanceCount: 0, failOn, results: [] }, null, 2));
    } else {
      console.log('No results returned. Check package names and try again.');
    }
    process.exit(0);
  }

  if (jsonOutput) {
    const criticalCount = allResults.filter(r => hasCritical(r.riskFlags)).length;
    const provenanceCount = allResults.filter(r => r.hasProvenance).length;
    console.log(JSON.stringify({
      totalScanned: allResults.length,
      criticalCount,
      provenanceCount,
      failOn,
      results: allResults,
    }, null, 2));
    process.exit(shouldFail(allResults, failOn) ? 1 : 0);
  }

  printTable(allResults);
  if (apiCta) console.log(clr(c.dim + c.cyan, `\n  ${apiCta}`));
  await inlineSignup(allResults);
  if (shouldFail(allResults, failOn)) {
    console.error(clr(c.red + c.bold, `✗ --fail-on=${failOn} threshold met. Exit 1.`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
