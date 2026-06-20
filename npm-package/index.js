#!/usr/bin/env node
/**
 * proof-of-commitment CLI v1.36.0
 * Scores npm/PyPI/Cargo/Go packages on behavioral commitment signals.
 * Usage: npx proof-of-commitment [packages...] [options]
 */

const API = process.env.COMMIT_API_URL || 'https://poc-backend.amdal-dev.workers.dev/api/audit';
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

/**
 * Build /api/audit request headers, adding Authorization: Bearer <key>
 * when a key is present in COMMIT_API_KEY or ~/.commit/config.
 *
 * Without this, signed-up users hitting 429 stayed stuck: the inline-signup
 * (v1.20.0) and URL signup flows both save the key locally, but the audit
 * call site never read it — so "Re-run your command" still 429'd. Fixed
 * in v1.20.1 after live dogfood confirmed the dead-end (see commit log).
 */
async function auditHeaders() {
  const key = await readApiKey();
  return key
    ? { ...JSON_API_HEADERS, Authorization: `Bearer ${key}` }
    : JSON_API_HEADERS;
}

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

  const partial = Array.isArray(data.packages_already_scored)
    ? data.packages_already_scored
    : [];

  // Forward-compat: if backend returns partial scoring on 429,
  // print what we have BEFORE the rescue message. Falls back to JSON
  // dump if the row shape isn't a complete table row.
  // (auditBatched aggregates across batches and prints its own table — it
  // calls renderRescueCta() directly, skipping this block.)
  if (partial.length > 0) {
    try {
      console.log();
      console.log(clr(c.dim, `  Partial results scored before the limit hit (${partial.length}):`));
      printTable(partial, { totalScanned: partial.length });
    } catch {
      console.log(JSON.stringify(partial, null, 2));
    }
  }

  await renderRescueCta(data);
}

/**
 * Render the rate-limit rescue CTA from a parsed 429 response body.
 * Separated from handle429() so auditBatched can aggregate partials across
 * 17 parallel batches, print ONE combined table, then surface ONE rescue
 * CTA — instead of letting the first batch to land kill the process with
 * only 3 of N*3 partials visible (where N = #batches hitting overshoot).
 *
 * Exit semantics preserved: this function ALWAYS process.exit(1) at the
 * tail, so any caller that's reached the rescue CTA leaves the program.
 *
 * The shape mirrors `data` from a 429 JSON response:
 *   { message?, instant_key_url?, upgrade_url?, retry_after_seconds?,
 *     retry_after?, overshoot?, tier_suggestion?, upgrade?, tier?,
 *     shared_ip_hint? }
 */
async function renderRescueCta(data) {
  const message = data.message || 'Daily free audit limit reached on this network IP.';
  const instantKeyUrl =
    data.instant_key_url ||
    data.upgrade_url ||
    'https://getcommit.dev/get-started?ref=audit-cli-429';
  // Authenticated keys: retry_after (seconds, used by worker auth-middleware quota path).
  // Anonymous IPs: retry_after_seconds (legacy / overshoot rescue path).
  // Read both so both paths surface a reset-time hint.
  const retryAfter = Number.isFinite(data.retry_after_seconds)
    ? data.retry_after_seconds
    : Number.isFinite(data.retry_after)
      ? data.retry_after
      : null;
  // Backend signals "you've blown past the free wall, Developer $15/mo is the
  // right fix" via overshoot=true / tier_suggestion="developer" (added
  // backend-side 2026-06-04). When set, backend routes instantKeyUrl to
  // /pricing — so the CLI must NOT promise "Free API key in 30 seconds" or
  // prompt for email (a 200/day key won't help someone scanning 260+/day).
  // Mismatched CTA text + destination kills trust and conversion. This branch
  // aligns label + URL + skips the inline email prompt. (Dogfood, 2026-06-06.)
  const overshoot = data.overshoot === true || data.tier_suggestion === 'developer';
  // Authenticated-key quota path (added 2026-06-10): when the user already
  // owns an API key and burns through their daily allowance, the backend
  // auth-middleware (worker.ts resolveApiKey) returns a NESTED upgrade object:
  //   { error, message, tier, upgrade: { url, plan, price, limit, message }, retry_after }
  // The legacy handle429() shape only knew the FLAT anonymous-IP shape
  // (instant_key_url, upgrade_url, overshoot, tier_suggestion). On a free-tier
  // key quota hit, all those flat fields were undefined → handler fell back
  // to "Get a free key" + inline email prompt → user (who already has a key)
  // got bait-and-switched at their highest-intent moment: invested in setup,
  // used the key all day, ready to upgrade — and we offered them to create
  // ANOTHER free key. Detect via `data.upgrade?.url && data.upgrade?.plan` +
  // a non-anonymous `data.tier`, route to dedicated upgrade UX. Aligns CLI
  // CTA + URL + skips email prompt symmetric to the overshoot branch.
  const keyUpgrade =
    data.upgrade &&
    typeof data.upgrade.url === 'string' &&
    typeof data.upgrade.plan === 'string' &&
    typeof data.tier === 'string' &&
    data.tier !== 'anonymous';

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

  // GitHub Actions: surface rate-limit as a workflow annotation so the human
  // reviewer sees it in the PR checks tab, not buried in raw CI logs.
  // Must fire BEFORE the path-specific branches — keyUpgrade and overshoot
  // both exit early with process.exit(1) and would skip a late annotation.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const fixUrl = keyUpgrade
      ? (data.upgrade?.url || 'https://getcommit.dev/pricing?ref=ci-annotation')
      : overshoot
        ? (instantKeyUrl || 'https://getcommit.dev/pricing?ref=ci-annotation')
        : (instantKeyUrl || 'https://getcommit.dev/get-started?ref=ci-annotation');
    const fixLabel = keyUpgrade
      ? 'Upgrade your API key for higher limits'
      : overshoot
        ? 'Get a Developer key ($15/mo, 1000/day)'
        : 'Get a free API key (200/day, no card)';
    console.error(`::warning title=Commit supply chain audit rate-limited::${fixLabel}. Add COMMIT_API_KEY to repo secrets. ${fixUrl}`);
  }

  // Authenticated-key quota path: user already has a key, hit their daily
  // allowance. Free-key inline prompt is the wrong tool — surface upgrade.
  // (Diagnosis: 2026-06-10 idle-mode dogfood — see comment block above.)
  if (keyUpgrade) {
    const planLabel = data.upgrade.plan.charAt(0).toUpperCase() + data.upgrade.plan.slice(1);
    const price = data.upgrade.price || '';
    const limit = data.upgrade.limit || '';
    const pitch = data.upgrade.message || `Upgrade to ${planLabel}.`;
    // URL already carries utm_campaign=key-upgrade + utm_source=key +
    // utm_medium=quota from backend buildUpgradeUrl — no rewrite needed,
    // /pricing key-upgrade banner reads these and pre-selects the tier.
    console.error(
      clr(
        c.cyan + c.bold,
        `   → ${planLabel} (${price}${limit ? ' · ' + limit : ''}): ${data.upgrade.url}`
      )
    );
    if (pitch) {
      console.error(clr(c.dim, `     ${pitch}`));
    }
    if (retryAfter && retryAfter > 0) {
      const hours = Math.floor(retryAfter / 3600);
      const mins = Math.floor((retryAfter % 3600) / 60);
      const resetIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      console.error(clr(c.dim, `     or wait — your free-tier quota resets in ${resetIn}.`));
    }
    console.error('');
    process.exit(1);
  }

  // Overshoot path: free key is the wrong tool. Surface a URL aligned with
  // the backend's Developer recommendation, skip the email prompt, exit.
  // Without this branch, the CLI would say "Free API key in 30 seconds (no
  // card)" while the URL goes to /pricing — bait-and-switch that erodes
  // trust at the highest-intent moment we get with a user.
  if (overshoot) {
    console.error(
      clr(
        c.cyan + c.bold,
        `   → Compare plans (Developer $15/mo · 1,000/day · batch API): ${instantKeyUrl}`
      )
    );
    if (retryAfter && retryAfter > 0) {
      const hours = Math.floor(retryAfter / 3600);
      const mins = Math.floor((retryAfter % 3600) / 60);
      const resetIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      console.error(clr(c.dim, `     or wait — free-tier resets in ${resetIn} (00:00 UTC).`));
    }
    console.error('');
    process.exit(1);
  }

  // TTY: inline signup collapses the 6-step browser flow (visit URL → enter
  // email → copy key → switch back to terminal → export key → re-run) to a
  // single terminal prompt. Non-TTY (CI/piped) falls through to the URL.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    console.error(clr(c.dim, '  ─────────────────────────────────────────────'));
    console.error(clr(c.bold, '  Get a free key and keep scanning (no card, saves to ~/.commit/config):'));
    console.error('');

    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin, output: process.stderr });

    const email = await new Promise(resolve => {
      rl.question(clr(c.dim, '  Your email (Enter to skip): '), answer => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      process.stderr.write(clr(c.dim, '  Creating key...'));
      try {
        const createRes = await fetch('https://poc-backend.amdal-dev.workers.dev/api/keys/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: 'audit-cli-429' }),
        });
        const keyData = await createRes.json();
        if (keyData.key) {
          await writeApiKey(keyData.key);
          console.error(clr(c.green, ' ✓ Key saved to ~/.commit/config'));
          console.error(clr(c.dim, `     Backup sent to ${email}`));
          console.error('');
          console.error(clr(c.bold, '  Re-run your command to continue with your new key.'));
          console.error('');
        } else {
          const errMsg = keyData.error === 'rate_limit_exceeded'
            ? 'Too many keys from this IP today — try again tomorrow.'
            : (keyData.message || 'Could not create key. Try the web: ' + instantKeyUrl);
          console.error(clr(c.red, ` Failed: ${errMsg}`));
          console.error('');
        }
      } catch (err) {
        console.error(clr(c.red, ` Error: ${err.message}`));
        console.error(clr(c.dim, `  Try the web: ${instantKeyUrl}`));
        console.error('');
      }
    } else if (email) {
      console.error(clr(c.red, '  Invalid email. Skipped.'));
      console.error(clr(c.dim, `  Try the web: ${instantKeyUrl}`));
      console.error('');
    } else {
      // User pressed Enter to skip — show URL as fallback
      console.error(clr(c.cyan + c.bold, `  → Get a free key later: ${instantKeyUrl}`));
      if (retryAfter && retryAfter > 0) {
        const hours = Math.floor(retryAfter / 3600);
        const mins = Math.floor((retryAfter % 3600) / 60);
        const resetIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        console.error(clr(c.dim, `     or wait — free-tier resets in ${resetIn} (00:00 UTC).`));
      }
      console.error('');
    }
  } else {
    // Non-TTY fallback: print URL for CI/piped contexts
    console.error(clr(c.cyan + c.bold, `   → Free API key in 30 seconds (no card): ${instantKeyUrl}`));
    if (retryAfter && retryAfter > 0) {
      const hours = Math.floor(retryAfter / 3600);
      const mins = Math.floor((retryAfter % 3600) / 60);
      const resetIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      console.error(clr(c.dim, `     or wait — free-tier resets in ${resetIn} (00:00 UTC).`));
    }
    console.error('');
  }

  process.exit(1);
}

/** Check if riskFlags array contains a CRITICAL-level flag (handles both "CRITICAL" and "CRITICAL: ..." formats) */
function hasCritical(flags) {
  return flags && flags.some(f => typeof f === 'string' && f.startsWith('CRITICAL'));
}

/**
 * Footer-calibration helper — diagnoses when the CRITICAL count is so dense
 * that the label has lost actionable meaning, and produces a reframe.
 *
 * Why this exists. Lockfile audits on real Node projects routinely report
 * 40–60% of scanned packages as CRITICAL — the threshold (sole publisher +
 * >10M weekly downloads) is structurally widespread in npm. When the footer
 * says "157 CRITICAL packages found" without context, a new user reads it as
 * either alarmist noise (close the tab) or as an unbounded ask (157 things
 * to investigate — uninstall the tool). Both kill activation.
 *
 * The dogfood signal: 2026-06-16 commit-landing-v2 lockfile, authenticated,
 * 326 scanned, 157 CRITICAL (48%). Reflection: "label loses meaning when
 * half the tree is red." Calibration reframes 157-of-326 as "typical npm
 * baseline; act on the top 3-5 by impact" — preserves the data and gives
 * the user a concrete next step. Threshold 20% chosen because that's the
 * point at which per-package action stops being feasible.
 *
 * Returns null when calibration shouldn't fire (low ratio, no scan total,
 * trivially small scan). Returns a `{ ratio, percent, baseline }` object
 * otherwise — caller decides how to render it.
 */
function summarizeCriticalConcentration(criticalCount, totalScanned) {
  if (!totalScanned || totalScanned < 10) return null;
  if (!criticalCount || criticalCount <= 0) return null;
  const ratio = criticalCount / totalScanned;
  if (ratio < 0.20) return null;
  return {
    ratio,
    percent: Math.round(ratio * 100),
    baseline: true,
  };
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

/**
 * Format audit results as SARIF 2.1.0 for GitHub Code Scanning / security dashboards.
 *
 * Maps risk levels: CRITICAL → error, HIGH (score<40) → warning,
 * MODERATE (score<60) → note. Each package produces one result entry.
 * Compromised packages get a separate "compromised" rule.
 *
 * When --file was used, locations point to that file at line 1.
 * Otherwise, a logical package-name location is used.
 */
function formatSarif(results, { filePath, ecosystem, version } = {}) {
  const rules = [];
  const ruleIndex = {};

  function ensureRule(id, shortDescription, fullDescription, level) {
    if (ruleIndex[id] != null) return ruleIndex[id];
    const idx = rules.length;
    ruleIndex[id] = idx;
    rules.push({
      id,
      shortDescription: { text: shortDescription },
      fullDescription: { text: fullDescription },
      defaultConfiguration: { level },
      helpUri: 'https://getcommit.dev/docs/',
    });
    return idx;
  }

  // Pre-define rules
  ensureRule(
    'commit/critical',
    'CRITICAL: sole publisher with high download volume',
    'Package has a single npm/registry publisher controlling millions of weekly downloads — the exact attack surface exploited in the axios and LiteLLM supply chain compromises.',
    'error'
  );
  ensureRule(
    'commit/high',
    'HIGH: behavioral risk score below 40',
    'Package scores below 40 on behavioral commitment signals, indicating elevated supply chain risk from low maintenance activity, publisher concentration, or rapid adoption without established track record.',
    'warning'
  );
  ensureRule(
    'commit/moderate',
    'MODERATE: behavioral risk score below 60',
    'Package scores below 60 on behavioral commitment signals. Not immediately dangerous but worth monitoring.',
    'note'
  );
  ensureRule(
    'commit/compromised',
    'COMPROMISED: confirmed supply chain attack',
    'Package was involved in a confirmed supply chain attack. Verify you are on a clean version.',
    'error'
  );

  const sarifResults = [];

  for (const pkg of results) {
    const isCritical = hasCritical(pkg.riskFlags);
    const score = typeof pkg.score === 'number' ? pkg.score : null;

    // Determine primary rule
    let ruleId, level;
    if (isCritical) {
      ruleId = 'commit/critical';
      level = 'error';
    } else if (score !== null && score < 40) {
      ruleId = 'commit/high';
      level = 'warning';
    } else if (score !== null && score < 60) {
      ruleId = 'commit/moderate';
      level = 'note';
    } else {
      // Healthy — skip unless compromised
      if (!pkg.compromised) continue;
      ruleId = 'commit/compromised';
      level = 'error';
    }

    const dlStr = pkg.weeklyDownloads
      ? ` (${fmtDl(pkg.weeklyDownloads)} downloads/week)`
      : '';
    const pubStr = pkg.maintainers
      ? `, ${pkg.maintainers} publisher${pkg.maintainers > 1 ? 's' : ''}`
      : '';
    const scoreStr = score !== null ? `Score: ${score}/100` : '';

    const messageText = `${pkg.name}: ${scoreStr}${pubStr}${dlStr}. ` +
      `${isCritical ? 'Sole publisher with high download volume — publish-access concentration risk.' : ''} ` +
      `https://getcommit.dev/${pkg.ecosystem || ecosystem || 'npm'}/${encodeURIComponent(pkg.name)}`;

    const location = filePath
      ? { physicalLocation: { artifactLocation: { uri: filePath }, region: { startLine: 1 } } }
      : { logicalLocations: [{ name: pkg.name, kind: 'module' }] };

    sarifResults.push({
      ruleId,
      ruleIndex: ruleIndex[ruleId],
      level,
      message: { text: messageText.trim() },
      locations: [location],
      properties: {
        ecosystem: pkg.ecosystem || ecosystem || 'npm',
        score: pkg.score,
        maintainers: pkg.maintainers,
        weeklyDownloads: pkg.weeklyDownloads,
        ageYears: pkg.ageYears,
        hasProvenance: pkg.hasProvenance || false,
        hasStagedPublishing: pkg.hasStagedPublishing ?? null,
        riskFlags: pkg.riskFlags || [],
      },
    });

    // Separate result for compromised packages
    if (pkg.compromised && ruleId !== 'commit/compromised') {
      const atk = pkg.compromised;
      sarifResults.push({
        ruleId: 'commit/compromised',
        ruleIndex: ruleIndex['commit/compromised'],
        level: 'error',
        message: {
          text: `${pkg.name}: confirmed supply chain attack — ${atk.attack || 'unknown'} (${atk.date || '?'}). ${atk.url || ''}`,
        },
        locations: [location],
      });
    }
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Commit',
          semanticVersion: version || '1.25.0',
          informationUri: 'https://getcommit.dev',
          rules,
        },
      },
      results: sarifResults,
    }],
  };
}

// Short download formatter for SARIF messages (no /wk suffix)
function fmtDl(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
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
  let compromisedCount = 0;

  for (const pkg of results) {
    const rc = riskColor(pkg.riskFlags, pkg.score);
    if (pkg.compromised) compromisedCount++;
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

    // Show Staged Publishing status for CRITICAL npm packages
    if (hasCritical(pkg.riskFlags) && (pkg.ecosystem || 'npm') === 'npm') {
      if (pkg.hasStagedPublishing) {
        console.log(clr(c.green, `  🛡️ Staged Publishing — compromised token can't push to latest`));
      } else if (pkg.hasStagedPublishing === false) {
        console.log(clr(c.dim, `  ↳ No Staged Publishing — npm stage publish would add a 2FA gate`));
      }
    }

    // Recently compromised warning
    if (pkg.compromised) {
      const atk = pkg.compromised;
      console.log(clr(c.red, `  ⚠ COMPROMISED — ${atk.attack} (${atk.date}) — ${atk.url}`));
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

    // Show WARN-level risk flags inline (dormant publishers, stale releases, etc.)
    const warnFlags = (pkg.riskFlags || []).filter(f => f.startsWith('WARN:'));
    for (const flag of warnFlags) {
      console.log(clr(c.yellow, `  ⚠ ${flag}`));
    }
  }

  console.log(divider);

  const effectiveCritical = totalCritical !== undefined ? totalCritical : criticalInDisplay;
  if (effectiveCritical > 0) {
    const conc = summarizeCriticalConcentration(effectiveCritical, totalScanned);
    if (conc) {
      // High-density reframe: at ≥20% CRITICAL the per-package alarm framing
      // loses meaning (the user can't audit a third of their tree). Recast as
      // ecosystem baseline + actionable shortlist. Pinned by
      // test/cli-critical-concentration.test.ts.
      console.log('\n' + clr(c.red + c.bold, `⚠  ${effectiveCritical} CRITICAL packages (${conc.percent}% of ${totalScanned} scanned).`));
      console.log(clr(c.dim, '   CRITICAL = sole npm publisher + >10M weekly downloads.'));
      console.log(clr(c.dim, '   At this density you\'re seeing npm\'s baseline — most popular packages have'));
      console.log(clr(c.dim, '   one publisher. Watch the top 3-5 above (highest impact); pin your lockfile'));
      console.log(clr(c.dim, '   and audit deltas for the rest — concentration you can\'t avoid per-dep.'));
    } else {
      const suffix = totalScanned ? ` (in ${totalScanned} packages scanned)` : '';
      console.log('\n' + clr(c.red + c.bold, `⚠  ${effectiveCritical} CRITICAL package${effectiveCritical > 1 ? 's' : ''} found${suffix}.`));
      console.log(clr(c.dim, '   CRITICAL = sole npm publisher + >10M weekly downloads (publish-access concentration risk)'));
    }
    if (provenanceCount > 0 && provenanceCount < results.length) {
      console.log(clr(c.cyan, `   🔐 ${provenanceCount}/${results.length} use Trusted Publishing (OIDC provenance) — partial mitigation`));
    }
  } else {
    const suffix = totalScanned ? ` (${totalScanned} packages scanned)` : '';
    console.log('\n' + clr(c.green, `✓  No CRITICAL packages found${suffix}.`));
  }

  // GitHub Actions: emit annotations so CRITICAL findings surface in the PR
  // checks tab and workflow summary — not buried in raw log output. This is
  // the same visibility commit-action gives, but for direct CLI users.
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (effectiveCritical > 0) {
      const critNames = results.filter(r => hasCritical(r.riskFlags)).slice(0, 5).map(r => r.name).join(', ');
      // PR-check annotation is the single user-visible artifact outside the raw
      // CI log. It must point at the conversion destination (/get-started with
      // watchlist auto-seed), not the viewer (/audit). Pre-fix the annotation
      // linked to /audit?packages= — same data the CI viewer already saw
      // scrolled up in the log + an inline signup form one extra scroll away.
      // Post-fix the link routes directly to /get-started?watch=…&eco=… which
      // seeds the user's watchlist from this scan and arrives at an email
      // capture as the primary form. Mirrors the same `?watch=…` URL contract
      // (test/get-started-watch-param.test.ts) used by /audit's bottom CTA
      // and the AUR-1579 / Snyk-comparison / Miasma / IronWorm blog posts.
      // ref=cli-watch (not cli-ci-critical) because the latter is not in the
      // backend's VALID_SOURCES and would get coerced to "web" — destroying
      // attribution. cli-watch is already an accepted source.
      const watchUrl = buildWatchUrl(results, 'cli-watch');
      const ctaUrl = watchUrl || `https://getcommit.dev/audit?packages=${encodeURIComponent(critNames)}&utm_source=cli&utm_medium=ci-annotation`;
      console.error(`::warning title=Commit: ${effectiveCritical} CRITICAL package${effectiveCritical > 1 ? 's' : ''}::Sole npm publisher + >10M downloads/week: ${critNames}. Watch + alert if scores change: ${ctaUrl}`);
    }
    if (compromisedCount > 0) {
      const compNames = results.filter(r => r.compromised).slice(0, 5).map(r => r.name).join(', ');
      console.error(`::error title=Commit: ${compromisedCount} compromised package${compromisedCount > 1 ? 's' : ''}::Recently attacked in supply chain incidents: ${compNames}. Verify you are on clean versions.`);
    }
  }

  if (compromisedCount > 0) {
    console.log(clr(c.red + c.bold, `\n⚠  ${compromisedCount} package${compromisedCount > 1 ? 's' : ''} recently compromised in supply chain attacks.`));
    console.log(clr(c.dim, '   Verify you are on clean versions. See URLs above for incident details.'));
  }

  // Footer with web link + CI integration CTA
  const topPkgs = results.slice(0, 10).map(r => r.name).join(',');
  const utm = 'utm_source=cli&utm_medium=audit';
  console.log(clr(c.cyan, `\n  🔗 Full report: ${WEB}?packages=${encodeURIComponent(topPkgs)}&${utm}`));
  console.log(clr(c.cyan, `  🤖 GitHub Action: github.com/piiiico/commit-action — block CRITICAL packages in CI`));
  console.log(clr(c.dim, `  📋 Add to this project: `) + clr(c.cyan, `poc init`) + clr(c.dim, ` — creates workflow + README badge`));
  console.log(clr(c.dim, `  🛡️  Protect every install: `) + clr(c.cyan, `poc hook`) + clr(c.dim, ` — Cursor/Claude Code/Windsurf hook, blocks CRITICAL before npm/pip/cargo runs`));

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
      // Non-TTY (CI, piped): show both a clickable signup URL AND the one-step
      // watch command. URL is for CI viewers reading log output in the browser
      // (PR check tabs auto-link URLs); CLI command is for local-pipe / script
      // contexts where copying a URL to a browser is friction. Two paths to
      // the same outcome — see buildWatchUrl docstring for the rationale.
      // Pre-fix this branch only emitted the CLI command, which requires the
      // user to know the package name, run a second `npx`, and remember an
      // email — a 3-decision ask in a CI log line that scrolls past.
      const watchPkg = results.find(r => hasCritical(r.riskFlags))?.name || results[0]?.name;
      const watchUrl = buildWatchUrl(results, 'cli-watch');
      console.log(clr(c.dim, `\n  📊 Monitor ${effectiveCritical === 1 ? 'this' : 'these ' + effectiveCritical} CRITICAL ${effectiveCritical === 1 ? 'package' : 'packages'} — get alerted when scores change.`));
      if (watchUrl) {
        console.log(clr(c.dim, '     Web: ') + clr(c.cyan, watchUrl));
      }
      console.log(clr(c.dim, '     CLI: ') + clr(c.cyan, `poc watch ${watchPkg} --email you@company.com`));
      console.log(clr(c.dim, '     Free: 3 packages, weekly digest. Developer $15/mo: 15 packages, daily scans.'));
    }
    // else: TTY mode — inlineSignup() will prompt interactively after printTable
  } else if (!hasKey && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    // HEALTHY case + no saved key + non-TTY (CI/piped): static baseline CTA.
    // In TTY mode, inlineSignup() now prompts interactively for healthy results
    // too — the dim text below converted 0/621 weekly downloads. Keep static
    // text only in CI/piped output where interactive prompts can't fire.
    // ref=audit-baseline distinguishes this funnel from audit-cli-429
    // (rate-limit rescue) and from the static utm_source=cli help-line.
    // Healthy-results non-TTY (CI, piped, no saved key) CTA. Mirror the
    // CRITICAL branch's dual-path (Web + CLI). ref=audit-baseline keeps this
    // funnel distinguishable from CRITICAL-driven cli-watch in api_keys.source
    // breakdowns — important for measuring whether degradation-alert framing
    // converts at all on clean results, separate from CRITICAL conversions.
    const watchUrl = buildWatchUrl(results, 'audit-baseline');
    console.log(clr(c.dim, '\n  📊 Get alerted if any package degrades:'));
    if (watchUrl) {
      console.log(clr(c.dim, '     Web: ') + clr(c.cyan, watchUrl));
    }
    console.log(clr(c.dim, '     CLI: ') + clr(c.cyan, `poc watch ${results[0]?.name || '<package>'} --email you@company.com`) + clr(c.dim, '  (free: 3 packages, weekly digest)'));
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
/**
 * Build the top-3-by-risk-priority watch seeds for /api/keys/create body.watch.
 *
 * Mirrors the web-side buildWatchSeeds at
 * commit-landing-v2/src/pages/audit.astro:1299 so the two signup paths
 * (web audit form vs CLI inline-prompt) feed the backend with the same
 * shape — backend then writes the user's default project's
 * monitored_packages BEFORE the welcome email so step 1 names actual
 * packages instead of hardcoded `poc watch express / lodash` examples.
 *
 * Priority: compromised > CRITICAL > HIGH > others (any flags) > clean.
 * The free-tier cap (3) is enforced both here and again on the backend
 * (PACKAGE_LIMITS.free) — defense in depth across client-server drift.
 * Validates ecosystem against the backend ECOSYSTEMS set
 * (npm/pypi/cargo/golang); unknown ecosystems fall back to npm because
 * the backend rejects unknowns and we want to surface SOMETHING rather
 * than nothing. Filters out names that fail npm's 214-char max and
 * dedupes by (name, ecosystem).
 *
 * Closes the second proposition-gap layer (CLI-side mirror of the
 * 2026-06-11 audit-page watchlist auto-seed at abe53f1/df8a8be).
 */
/**
 * Build a clickable /get-started URL that pre-seeds the watchlist from the
 * scanned packages. Mirrors the `?watch=pkg1,pkg2,pkg3&eco=npm` URL contract
 * pinned by test/get-started-watch-param.test.ts. The free-tier cap (3) is
 * enforced via buildCliWatchSeeds(); /get-started.astro re-validates and the
 * backend re-caps at PACKAGE_LIMITS.free (defense in depth across drift).
 *
 * Why this exists: the proven Snyk-comparison/AUR-1579 blog conversion pattern
 * (mid-essay dual CTA + bottom dual CTA + `?watch=…` pre-seed) was sitting
 * one repo over from the CLI for weeks. The CLI emits the highest-intent
 * touchpoint after npm install — a CRITICAL finding in a real user's tree —
 * but the only conversion paths it offered non-TTY users were a multi-token
 * `poc watch X --email Y` CLI command (high friction) and a `getcommit.dev/
 * audit?packages=…` link that drops users on the viewer page (not a converter).
 * This helper produces the clickable conversion URL with packages pre-seeded.
 *
 * Returns null when no valid seeds exist (e.g. empty results, or all names
 * fail the npm-name regex via buildCliWatchSeeds). Callers degrade gracefully
 * to text-only CTAs without a URL.
 */
function buildWatchUrl(results, ref) {
  const seeds = buildCliWatchSeeds(results);
  if (seeds.length === 0) return null;
  // All seeds from one scan share the same ecosystem; pick from the first.
  const eco = seeds[0].ecosystem || 'npm';
  const names = seeds.map(s => s.name).join(',');
  return `https://getcommit.dev/get-started?watch=${encodeURIComponent(names)}&eco=${eco}&ref=${ref}&utm_source=cli`;
}

function buildCliWatchSeeds(results) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const VALID_ECOS = new Set(['npm', 'pypi', 'cargo', 'golang']);
  function priority(r) {
    if (r.compromised) return 0;
    if (Array.isArray(r.riskFlags) && r.riskFlags.some(f => typeof f === 'string' && f.startsWith('CRITICAL'))) return 1;
    if (Array.isArray(r.riskFlags) && r.riskFlags.some(f => typeof f === 'string' && f.startsWith('HIGH'))) return 2;
    if (Array.isArray(r.riskFlags) && r.riskFlags.length > 0) return 3;
    return 4;
  }
  const filtered = results.filter(r => typeof r.name === 'string' && r.name.length > 0 && r.name.length < 215);
  const sorted = filtered.slice().sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return filtered.indexOf(a) - filtered.indexOf(b);
  });
  const seeds = [];
  const seen = new Set();
  for (const r of sorted) {
    const rawEco = typeof r.ecosystem === 'string' ? r.ecosystem.toLowerCase() : 'npm';
    const eco = VALID_ECOS.has(rawEco) ? rawEco : 'npm';
    const key = `${r.name}|${eco}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ name: r.name, ecosystem: eco });
    if (seeds.length >= 3) break; // free-tier cap (backend re-validates)
  }
  return seeds;
}

async function inlineSignup(results, opts = {}) {
  // Only prompt in interactive TTY when no key saved
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const hasKey = !!process.env.COMMIT_API_KEY || _cachedHasKey;
  if (hasKey) return;
  const critPkgs = results.filter(r => hasCritical(r.riskFlags));
  const lowScorePkgs = results.filter(r => typeof r.score === 'number' && r.score < 60);
  const hasFindings = critPkgs.length >= 1 || lowScorePkgs.length >= 2;
  // engagementSignal: server _cta — this IP has scored ≥ AUDIT_SOFT_CTA_AT
  // (5) packages today. Server-confirmed repeat-use signal independent of
  // local result shape.
  const engagementSignal = !!opts.engagementSignal;
  // 2026-06-11 v1.30.0 proposition shift: gate relaxed to results.length<1.
  // Prior gates (`<3 && !hasFindings && !engagementSignal`) blocked the most
  // common entry point — `npx proof-of-commitment axios` after reading about
  // an attack — when the result was healthy. The watchlist auto-seed shipped
  // earlier today (abe53f1) made single-package signups valuable: signup →
  // that package goes on watchlist + email if attacked. "Enter to skip"
  // keeps opt-out one keystroke. Closes the proposition gap from 2026-06-10
  // /api/keys/stats dogfood: 4 IPs hit soft-CTA in 7d, 0 organic signups —
  // copy was quota-focused, not value-focused.
  if (results.length < 1) return;

  // Heading copy: lead with the proposition (auto-watch + alert on attack),
  // not the friction (quota wall). Pre-v1.30.0 the engagementSignal heading
  // was wall-approach quota framing (see git log for prior copy) — friction-
  // removal for a user the system has already identified as security-engaged.
  // New framing names what they actually get: watchlist seeded from this
  // scan, email if anything tampers.
  const count = results.length;
  const pkgRef = count === 1 ? 'this' : `these ${count}`;
  const subjRef = count === 1 ? 'it' : 'any';
  const subjGets = count === 1 ? 'gets' : 'get';

  const heading = hasFindings
    ? `  🔔 Auto-watch ${pkgRef}. Email if ${subjRef} ${subjGets} attacked or score drops.`
    : engagementSignal
      ? `  🔔 You're scanning a lot. Watch ${pkgRef} for the next attack? Free.`
      : `  🔔 Auto-watch ${pkgRef}. Free email alert if ${subjRef} ${subjGets} attacked.`;

  console.log(clr(c.dim, '  ─────────────────────────────────────────────'));
  console.log(clr(c.bold, heading));
  console.log(clr(c.dim, '     Seeds your watchlist from this scan. 10s, no card.\n'));

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
    // Funnel attribution: 'cli-soft-cta' for engagement-signal path,
    // 'cli' for findings-driven inline prompts. Lets api_keys.source
    // measure 2026-06-10 engagementSignal gate-bypass lift separately
    // from baseline inline-CLI signups. Backend VALID_SOURCES gains
    // 'cli-soft-cta' in this same commit; older worker versions drop
    // unknown sources to 'web' (safe degradation, no error).
    const source = engagementSignal && !hasFindings ? 'cli-soft-cta' : 'cli';
    // Proposition shift (2026-06-11, second layer): same defect the audit-page
    // welcome email had until df8a8be — pre-fix, every CLI signup got hardcoded
    // "poc watch express / lodash" in their welcome email regardless of what
    // they actually scanned. Web side now seeds top-3-by-risk-priority on POST
    // and the backend writes them to the user's default project before sending
    // the welcome email. CLI must mirror or signups via `npx proof-of-commitment
    // <some-package>` still get an email orthogonal to their intent. Backend
    // accepts body.watch = [{name, ecosystem}], caps at PACKAGE_LIMITS.free=3,
    // echoes seededPackages back as data.watched_packages. Priority order
    // (compromised > CRITICAL > HIGH > others) matches the web-side
    // buildWatchSeeds at commit-landing-v2/src/pages/audit.astro:1299.
    const watch = buildCliWatchSeeds(results);
    const res = await fetch('https://poc-backend.amdal-dev.workers.dev/api/keys/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source, watch }),
    });

    const data = await res.json();

    if (data.key) {
      await writeApiKey(data.key);
      _cachedHasKey = true;
      console.log(clr(c.green, ' ✓ Saved to ~/.commit/config'));
      console.log(clr(c.dim, `     Backup sent to ${email}`));
      console.log();
      // Render the backend echo (data.watched_packages) — the user sees
      // "Now watching: foo, bar, baz" before the first weekly digest fires
      // (~7d). Mirrors the audit-page renderInlineForm success state at
      // commit-landing-v2/src/pages/audit.astro:1971 so on-context-switch the
      // user does not see contradictory "you have nothing watched" messaging
      // in `poc list`. Trust the server echo, not our pre-submit array (the
      // server caps + dedups). Older backend versions that predate body.watch
      // simply omit watched_packages — we fall through to the legacy
      // single-target hint, no regression.
      const watched = Array.isArray(data.watched_packages) ? data.watched_packages : [];
      if (watched.length > 0) {
        const names = watched.map(w => w.name).join(', ');
        const noun = watched.length === 1 ? 'package' : 'packages';
        console.log(clr(c.green, `  ✓ Now watching ${watched.length} ${noun}: ${names}`));
        console.log(clr(c.dim, '     Mondays we email you if any score drops a tier or a watched package gets attacked.\n'));
        console.log(clr(c.bold, '  Next steps:'));
        console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc list') + clr(c.dim, '          — confirm your watchlist'));
        console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc init') + clr(c.dim, '          — add CI gate to this project'));
        console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc status') + clr(c.dim, '       — check your account'));
      } else {
        console.log(clr(c.bold, '  Next steps:'));
        // Legacy fallback: backend did not seed (old worker, empty seeds, or
        // seed failure swallowed). Surface a concrete watch target. CRITICAL
        // first (highest urgency); otherwise pick the lowest-score package as
        // the most-likely-to-degrade.
        const watchTarget = critPkgs[0]?.name
          || results.slice().sort((a, b) => (a.score || 100) - (b.score || 100))[0]?.name;
        if (watchTarget) {
          console.log(clr(c.dim, '    • ') + clr(c.cyan, `poc watch ${watchTarget}`) + clr(c.dim, '  — monitor this package (free: 3 packages, weekly)'));
        }
        console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc init') + clr(c.dim, '          — add CI gate to this project'));
        console.log(clr(c.dim, '    • ') + clr(c.cyan, 'poc status') + clr(c.dim, '       — check your account'));
      }
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
${clr(c.bold, 'proof-of-commitment')} v1.36.0 — supply chain risk scorer

${clr(c.bold, 'Usage:')}
  npx proof-of-commitment                            Auto-detect manifest in current dir
  npx proof-of-commitment audit                      Same — verb-first alias (also: scan, check)
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

${clr(c.bold, 'IDE Hooks:')}
  poc hook            Install supply chain gate for Cursor + Claude Code + Windsurf
  poc hook --cursor   Install only the Cursor beforeShellExecution hook
  poc hook --claude-code  Install only the Claude Code PreToolUse hook
  poc hook --windsurf Install only the Windsurf pre_run_command hook
  poc hook --global   Install for the current user (~/.cursor + ~/.claude + ~/.codeium/windsurf)
  poc hook --uninstall Remove the hook from all IDEs

${clr(c.bold, 'Account:')}
  poc login [key]     Save and validate your API key (interactive or direct)
  poc status          Show current tier, usage, and limits
  poc logout          Remove saved API key

${clr(c.bold, 'Monitoring (free: 3 packages weekly · Developer $15/mo: 15 daily):')}
  poc watch <package> [--email you@co.com] [--ecosystem npm|pypi|cargo|golang]
                      Add a package to monitoring. --email creates a free key in one step.
  poc watchlist       List monitored packages with current scores + risk
  poc unwatch <pkg>   Remove a package from monitoring

  Get a free key:        https://getcommit.dev/get-started?utm_source=cli
  Enable monitoring:     https://getcommit.dev/pricing?utm_source=cli&utm_campaign=help

${clr(c.bold, 'Options:')}
  --json              Output results as JSON
  --sarif             Output results as SARIF 2.1.0 (for GitHub Code Scanning)
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
  npx proof-of-commitment --sarif > results.sarif       # GitHub Code Scanning format
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
       Anonymous: 15 queries/IP/UTC day. Free API key (instant, no card): 200/day. ${clr(c.dim, '(Authorization: Bearer sk_commit_…)')}

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
  // Resolve auth once so all parallel batches share the same key lookup.
  const headers = await auditHeaders();

  // Use Promise.allSettled so a single rate-limit hit on one batch doesn't
  // discard the work the other batches successfully completed. Pre-fix
  // (2026-06-16 dogfood): backend in overshoot returns 429 with
  // RATE_LIMIT_TASTE=3 packages_already_scored on EVERY parallel batch
  // (each batch increments the IP counter, all see auditCount > limit,
  // each gets trimmed to 3 + 429). The first batch's 429 to land called
  // handle429() which process.exit(1)'d — discarding the OTHER 16 batches'
  // 3-package partials (16×3=48 packages of scored value silently dropped).
  //
  // Post-fix: aggregate 200 results AND 429 partials across all batches.
  // User sees up to N×3 packages instead of 3 when fully overshoot, and
  // (16×20)+(1×3)=323 packages instead of 0 when limit hits mid-scan.
  // Rescue CTA is surfaced ONCE at the end via _rescue (handed to
  // renderRescueCta in the calling path), not per-batch via handle429.
  const settled = await Promise.allSettled(
    batches.map(async (batch) => {
      const res = await fetch(API, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packages: batch, ecosystem }),
      });
      let data = {};
      try { data = await res.json(); } catch {}
      completed += batch.length;
      if (onProgress) onProgress(completed, packages.length);
      if (res.ok) {
        return { kind: 'ok', data };
      }
      if (res.status === 429) {
        return { kind: '429', data };
      }
      return { kind: 'error', status: res.status, data };
    })
  );

  const aggregated = [];
  let rescue = null;
  let nonRateErrorMsg = null;
  for (const r of settled) {
    if (r.status === 'rejected') {
      nonRateErrorMsg = nonRateErrorMsg || String(r.reason && r.reason.message || r.reason || 'unknown');
      continue;
    }
    const v = r.value;
    if (v.kind === 'ok') {
      if (v.data._cta) batchedCta = v.data._cta;
      aggregated.push(...(v.data.results || []));
    } else if (v.kind === '429') {
      // First 429's payload carries the rescue metadata; later 429s'
      // metadata is interchangeable (same overshoot/upgrade context),
      // so we don't need to merge it.
      if (!rescue) rescue = v.data;
      aggregated.push(...(Array.isArray(v.data.packages_already_scored) ? v.data.packages_already_scored : []));
    } else if (v.kind === 'error') {
      const errMsg = (v.data && v.data.error) ? v.data.error : `API error ${v.status}`;
      nonRateErrorMsg = nonRateErrorMsg || errMsg;
    }
  }

  // Hard failure: zero packages scored AND a non-rate-limit error fired.
  // (If rescue is set but aggregated is empty, fall through — the caller
  // will render the rescue CTA and exit; no need to throw.)
  if (aggregated.length === 0 && !rescue && nonRateErrorMsg) {
    throw new Error(nonRateErrorMsg);
  }

  // Dedup by name+ecosystem — defensive against any backend echoing.
  const seen = new Set();
  const all = aggregated.filter((p) => {
    const k = `${p && p.name}:${p && p.ecosystem}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort: CRITICAL first, then by score ascending
  all.sort((a, b) => {
    const aCrit = hasCritical(a.riskFlags) ? 1 : 0;
    const bCrit = hasCritical(b.riskFlags) ? 1 : 0;
    if (aCrit !== bCrit) return bCrit - aCrit;
    return (a.score || 100) - (b.score || 100);
  });

  return { results: all, _cta: batchedCta, _rescue: rescue };
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

/**
 * poc hook [--cursor] [--claude-code] [--windsurf] [--global] [--uninstall]
 * Install a supply chain gate hook for Cursor (beforeShellExecution),
 * Claude Code (PreToolUse), and/or Windsurf (pre_run_command) that scores
 * packages before install.
 *
 * Writes a single hook script to ~/.commit/cursor-hook.js (the filename is
 * kept for backward compatibility with v1.21.x installs; the same script
 * now auto-detects whether stdin is in Cursor or Claude Code format and
 * emits the matching response shape).
 *
 * Default installs all three (Cursor + Claude Code + Windsurf). Pass
 * --cursor, --claude-code, or --windsurf to install only one.
 * --global writes to ~/.cursor, ~/.claude, and ~/.codeium/windsurf;
 * default writes to ./.cursor, ./.claude, and ./.windsurf.
 */
async function cmdHook(args) {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');

  const isGlobal = args.includes('--global') || args.includes('-g');
  const uninstall = args.includes('--uninstall') || args.includes('--remove');
  const onlyCursor = args.includes('--cursor');
  const onlyClaude = args.includes('--claude-code') || args.includes('--claude');
  const onlyWindsurf = args.includes('--windsurf');
  // Default (no client flag) = install all three. Narrow with --cursor, --claude-code, or --windsurf.
  const hasClientFlag = onlyCursor || onlyClaude || onlyWindsurf;
  const installCursor = hasClientFlag ? onlyCursor : true;
  const installClaude = hasClientFlag ? onlyClaude : true;
  const installWindsurf = hasClientFlag ? onlyWindsurf : true;

  // ── Hook script (plain Node.js, no external deps) ─────────────────────
  // Single script serves Cursor (beforeShellExecution), Claude Code
  // (PreToolUse), AND Windsurf (pre_run_command). It auto-detects which
  // client called it by inspecting the stdin JSON and emits the matching
  // response format.
  const hookScript = `#!/usr/bin/env node
/**
 * Commit supply chain hook for Cursor + Claude Code + Windsurf (auto-generated by \`poc hook\`)
 * Intercepts npm/pip/cargo/go install commands and scores packages
 * against getcommit.dev before they run.
 *
 * CRITICAL packages are blocked. HIGH packages trigger confirmation.
 * Auto-detects Cursor vs Claude Code vs Windsurf stdin format and replies in kind.
 * Docs: https://getcommit.dev/docs/cursor-hook
 */
const API = process.env.COMMIT_API_URL || 'https://poc-backend.amdal-dev.workers.dev/api/audit';
const fs = require('fs');
const path = require('path');

function readKey() {
  try {
    if (process.env.COMMIT_API_KEY) return process.env.COMMIT_API_KEY.trim();
    const cfg = fs.readFileSync(path.join(require('os').homedir(), '.commit', 'config'), 'utf-8');
    const m = cfg.match(/^api_key\\s*=\\s*(.+)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

function parseInstall(cmd) {
  const t = (cmd || '').trim();
  let m;
  // npm / pnpm / yarn
  m = t.match(/^(?:npm\\s+(?:i|install|add)|pnpm\\s+(?:i|install|add)|yarn\\s+add)\\s+(.+)/);
  if (m) return { eco: 'npm', pkgs: m[1].split(/\\s+/).filter(a => !a.startsWith('-') && a !== 'install' && a !== 'add') };
  // pip
  m = t.match(/^(?:pip3?\\s+install|uv\\s+pip\\s+install|python3?\\s+-m\\s+pip\\s+install)\\s+(.+)/);
  if (m) return { eco: 'pypi', pkgs: m[1].split(/\\s+/).filter(a => !a.startsWith('-')).map(a => a.split('==')[0].split('>=')[0]) };
  // cargo
  m = t.match(/^cargo\\s+(?:add|install)\\s+(.+)/);
  if (m) return { eco: 'cargo', pkgs: m[1].split(/\\s+/).filter(a => !a.startsWith('-')) };
  // go
  m = t.match(/^go\\s+(?:get|install)\\s+(.+)/);
  if (m) return { eco: 'golang', pkgs: m[1].split(/\\s+/).filter(a => !a.startsWith('-')).map(a => a.split('@')[0]) };
  return null;
}

// Detect which client called us and how to extract the command.
// Cursor:      stdin = { command: 'npm install ...', workingDirectory? }
// Claude Code: stdin = { tool_name: 'Bash', tool_input: { command: '...' }, hook_event_name: 'PreToolUse', ... }
// Windsurf:    stdin = { agent_action_name: 'pre_run_command', tool_info: { command_line: '...' } }
function detectClient(input) {
  if (input && input.agent_action_name === 'pre_run_command' && input.tool_info) {
    return { client: 'windsurf', cmd: input.tool_info.command_line || '' };
  }
  if (input && input.tool_input && typeof input.tool_input.command === 'string') {
    return { client: 'claude-code', cmd: input.tool_input.command };
  }
  if (input && typeof input.command === 'string') {
    return { client: 'cursor', cmd: input.command };
  }
  return { client: 'cursor', cmd: '' };
}

// Emit the appropriate "no decision" / "allow" output for the detected client.
function emitAllow(client) {
  if (client === 'claude-code' || client === 'windsurf') {
    // No stdout + exit 0 = allow / defer to normal permission flow.
    return;
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}

// Emit deny / ask in the matching format.
function emit(client, decision, userMsg, agentMsg) {
  if (client === 'windsurf') {
    // Windsurf uses exit codes: 0 = allow, 2 = block. stderr = message shown in Cascade UI.
    process.stderr.write(userMsg.replace(/\\\\n/g, '\\n'));
    process.exit(2);
    return;
  }
  if (client === 'claude-code') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: userMsg,
      },
    }));
    return;
  }
  const body = { permission: decision, user_message: userMsg };
  if (agentMsg) body.agent_message = agentMsg;
  process.stdout.write(JSON.stringify(body));
}

async function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8')); } catch { emitAllow('cursor'); return; }
  const { client, cmd } = detectClient(input);
  const parsed = parseInstall(cmd);
  if (!parsed || parsed.pkgs.length === 0) { emitAllow(client); return; }

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  const key = readKey();
  if (key) headers['Authorization'] = 'Bearer ' + key;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ packages: parsed.pkgs, ecosystem: parsed.eco }), signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok && res.status !== 429) { emitAllow(client); return; }
    const data = await res.json();
    const results = data.results || data.packages_already_scored || [];

    const critical = results.filter(r => (r.riskFlags || []).some(f => f.startsWith('CRITICAL')));
    const high = results.filter(r => (r.riskFlags || []).some(f => f.startsWith('HIGH')));
    const url = 'https://getcommit.dev/audit?packages=' + parsed.pkgs.join(',') + '&ecosystem=' + parsed.eco;

    // Detect rate-limit hit and surface signup CTA + unscored-package warning.
    // Without this, hook would silently allow unscored packages on 429 (false sense of security).
    const rateLimited = res.status === 429;
    // Per-client attribution so /api/keys/create source counters split traffic cleanly.
    const refTag = client === 'claude-code' ? 'claude-code-hook-429' : client === 'windsurf' ? 'windsurf-hook-429' : 'cursor-hook-429';
    const rlUrl = rateLimited ? 'https://getcommit.dev/get-started?ref=' + refTag + '&utm_source=cli' : '';
    const unscored = rateLimited ? Math.max(0, parsed.pkgs.length - results.length) : 0;
    const rlNote = rateLimited
      ? '\\n\\n\\u26A0 Commit free limit reached'
        + (unscored > 0 ? ' \\u2014 ' + unscored + ' of ' + parsed.pkgs.length + ' package(s) NOT audited' : '')
        + '\\n   Free key (200/day, no card): ' + rlUrl
      : '';

    if (critical.length > 0) {
      const lines = critical.map(r => '  \\u{1F534} ' + r.name + ' (score ' + (r.score||'?') + ') \\u2014 ' + (r.riskFlags||[]).slice(0,1).join(', '));
      emit(client, 'deny',
        '\\u{1F534} Commit blocked: ' + critical.map(r=>r.name).join(', ') + ' flagged CRITICAL\\n\\n' + lines.join('\\n') + '\\n\\n\\u2192 ' + url + rlNote,
        'Package install blocked by Commit. CRITICAL = sole publisher + high downloads (attack surface of axios/node-ipc incidents). ' + critical.map(r=>r.name).join(', ') + '. Report: ' + url
      );
      return;
    }
    if (high.length > 0) {
      const lines = high.map(r => '  \\u{1F7E1} ' + r.name + ' (score ' + (r.score||'?') + ') \\u2014 ' + (r.riskFlags||[]).slice(0,1).join(', '));
      emit(client, 'ask',
        '\\u{1F7E1} Commit: ' + high.map(r=>r.name).join(', ') + ' scored HIGH risk\\n\\n' + lines.join('\\n') + '\\n\\nProceed? \\u2192 ' + url + rlNote
      );
      return;
    }
    // Rate-limited with no critical/high in the scored partial: still alert user.
    // If unscored packages remain, this is a security signal (could be CRITICAL we missed).
    // If all packages scored clean, this is a conversion signal (drive them to sign up).
    if (rateLimited) {
      const head = unscored > 0
        ? '\\u26A0 Commit free limit reached \\u2014 ' + unscored + ' of ' + parsed.pkgs.length + ' package(s) NOT audited'
        : '\\u2713 ' + parsed.pkgs.join(', ') + ' look clean (free-tier audit)';
      emit(client, 'ask', head + '\\n\\nFree API key (200/day, no card, 30s):\\n  ' + rlUrl + '\\n\\nProceed anyway?');
      return;
    }
    emitAllow(client);
  } catch { emitAllow(client); }
}
main();
`;

  const commitDir = path.join(os.homedir(), '.commit');
  const hookPath = path.join(commitDir, 'cursor-hook.js');

  // ── Cursor config helpers ─────────────────────────────────────────────
  function cursorHooksFile(global) {
    const dir = global ? path.join(os.homedir(), '.cursor') : path.join(process.cwd(), '.cursor');
    return { dir, file: path.join(dir, 'hooks.json') };
  }

  function installCursorHook(global) {
    const { dir, file } = cursorHooksFile(global);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let cfg = { version: 1, hooks: {} };
    if (fs.existsSync(file)) {
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    }
    if (!cfg.hooks) cfg.hooks = {};
    if (!cfg.hooks.beforeShellExecution) cfg.hooks.beforeShellExecution = [];
    const existing = cfg.hooks.beforeShellExecution.some(h => h.command?.includes('cursor-hook.js'));
    if (!existing) cfg.hooks.beforeShellExecution.push({ command: `node ${hookPath}` });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    return file;
  }

  function uninstallCursorHook(global) {
    const { file } = cursorHooksFile(global);
    if (!fs.existsSync(file)) return false;
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const hooks = cfg.hooks?.beforeShellExecution || [];
      const filtered = hooks.filter(h => !h.command?.includes('cursor-hook.js'));
      if (filtered.length === hooks.length) return false;
      cfg.hooks.beforeShellExecution = filtered;
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
      return true;
    } catch { return false; }
  }

  // ── Claude Code config helpers ────────────────────────────────────────
  function claudeSettingsFile(global) {
    const dir = global ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
    return { dir, file: path.join(dir, 'settings.json') };
  }

  function installClaudeHook(global) {
    const { dir, file } = claudeSettingsFile(global);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let cfg = {};
    if (fs.existsSync(file)) {
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    }
    if (!cfg.hooks) cfg.hooks = {};
    if (!Array.isArray(cfg.hooks.PreToolUse)) cfg.hooks.PreToolUse = [];

    // Find or create the Bash matcher entry.
    let bashEntry = cfg.hooks.PreToolUse.find(e => e.matcher === 'Bash');
    if (!bashEntry) {
      bashEntry = { matcher: 'Bash', hooks: [] };
      cfg.hooks.PreToolUse.push(bashEntry);
    }
    if (!Array.isArray(bashEntry.hooks)) bashEntry.hooks = [];
    const existing = bashEntry.hooks.some(h => h.command?.includes('cursor-hook.js'));
    if (!existing) {
      bashEntry.hooks.push({
        type: 'command',
        command: `node ${hookPath}`,
        timeout: 10,
      });
    }
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    return file;
  }

  function uninstallClaudeHook(global) {
    const { file } = claudeSettingsFile(global);
    if (!fs.existsSync(file)) return false;
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const pre = cfg.hooks?.PreToolUse || [];
      let changed = false;
      for (const entry of pre) {
        if (!Array.isArray(entry.hooks)) continue;
        const before = entry.hooks.length;
        entry.hooks = entry.hooks.filter(h => !h.command?.includes('cursor-hook.js'));
        if (entry.hooks.length !== before) changed = true;
      }
      // Drop empty Bash entries so we don't leave a dangling matcher.
      cfg.hooks.PreToolUse = pre.filter(e => !(e.matcher === 'Bash' && (!e.hooks || e.hooks.length === 0)));
      if (!changed) return false;
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
      return true;
    } catch { return false; }
  }

  // ── Windsurf config helpers ──────────────────────────────────────────
  function windsurfHooksFile(global) {
    const dir = global ? path.join(os.homedir(), '.codeium', 'windsurf') : path.join(process.cwd(), '.windsurf');
    return { dir, file: path.join(dir, 'hooks.json') };
  }

  function installWindsurfHook(global) {
    const { dir, file } = windsurfHooksFile(global);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let cfg = { hooks: {} };
    if (fs.existsSync(file)) {
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    }
    if (!cfg.hooks) cfg.hooks = {};
    if (!Array.isArray(cfg.hooks.pre_run_command)) cfg.hooks.pre_run_command = [];
    const existing = cfg.hooks.pre_run_command.some(h => h.command?.includes('cursor-hook.js'));
    if (!existing) {
      cfg.hooks.pre_run_command.push({
        command: `node ${hookPath}`,
        show_output: true
      });
    }
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    return file;
  }

  function uninstallWindsurfHook(global) {
    const { file } = windsurfHooksFile(global);
    if (!fs.existsSync(file)) return false;
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const hooks = cfg.hooks?.pre_run_command || [];
      const filtered = hooks.filter(h => !h.command?.includes('cursor-hook.js'));
      if (filtered.length === hooks.length) return false;
      cfg.hooks.pre_run_command = filtered;
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
      return true;
    } catch { return false; }
  }

  // ── Uninstall ──────────────────────────────────────────────────────────
  if (uninstall) {
    let removed = false;
    if (fs.existsSync(hookPath)) { fs.unlinkSync(hookPath); removed = true; }

    // Cursor: clean both project and global, regardless of flags — be thorough.
    for (const g of [false, true]) {
      if (uninstallCursorHook(g)) {
        removed = true;
        console.log(clr(c.dim, `  Updated: ${cursorHooksFile(g).file}`));
      }
    }
    // Claude Code: same.
    for (const g of [false, true]) {
      if (uninstallClaudeHook(g)) {
        removed = true;
        console.log(clr(c.dim, `  Updated: ${claudeSettingsFile(g).file}`));
      }
    }
    // Windsurf: same.
    for (const g of [false, true]) {
      if (uninstallWindsurfHook(g)) {
        removed = true;
        console.log(clr(c.dim, `  Updated: ${windsurfHooksFile(g).file}`));
      }
    }

    if (removed) {
      console.log(clr(c.green, '\n  ✓ Commit hook uninstalled (Cursor + Claude Code + Windsurf).'));
    } else {
      console.log(clr(c.dim, '\n  No hook found to remove.'));
    }
    console.log();
    return;
  }

  // ── Install ────────────────────────────────────────────────────────────
  // 1. Write hook script
  if (!fs.existsSync(commitDir)) fs.mkdirSync(commitDir, { recursive: true });
  fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });

  const writtenFiles = [];
  if (installCursor) writtenFiles.push({ client: 'Cursor', file: installCursorHook(isGlobal) });
  if (installClaude) writtenFiles.push({ client: 'Claude Code', file: installClaudeHook(isGlobal) });
  if (installWindsurf) writtenFiles.push({ client: 'Windsurf', file: installWindsurfHook(isGlobal) });

  // 3. Report
  const clientList = writtenFiles.map(w => w.client).join(' + ');
  console.log(clr(c.green, `\n  ✓ Commit supply chain hook installed (${clientList})`));
  console.log();
  console.log(clr(c.bold, '  What happens now:'));
  console.log(clr(c.dim, '  Every ') + clr(c.cyan, 'npm install') + clr(c.dim, ', ') +
    clr(c.cyan, 'pip install') + clr(c.dim, ', ') + clr(c.cyan, 'cargo add') + clr(c.dim, ', and ') +
    clr(c.cyan, 'go get') + clr(c.dim, ` in ${clientList}`));
  console.log(clr(c.dim, '  is scored against Commit before it runs.'));
  console.log(clr(c.dim, '  CRITICAL packages are blocked. HIGH packages ask for confirmation.'));
  console.log();
  console.log(clr(c.bold, '  Files:'));
  console.log(clr(c.dim, `  Hook script: ${hookPath}`));
  for (const w of writtenFiles) {
    console.log(clr(c.dim, `  ${w.client.padEnd(11)}  ${w.file}`));
  }
  console.log();

  const key = await readApiKey();
  if (!key) {
    console.log(clr(c.yellow, '  ⚠ No API key found.') + clr(c.dim, ' Anonymous limit: 15 audits/day.'));
    console.log(clr(c.dim, '  Get a free key (200/day): ') + clr(c.cyan, 'poc login'));
    console.log(clr(c.dim, '  Or: ') + clr(c.cyan, 'https://getcommit.dev/get-started?ref=poc-hook&utm_source=cli'));
    console.log();
  }

  console.log(clr(c.dim, '  Uninstall: ') + clr(c.cyan, 'poc hook --uninstall'));
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
async function cmdWatch(pkg, ecosystem, emailArg) {
  let key = await readApiKey();

  // --email flag: create a free key inline if none exists, collapsing the
  // visit-site → enter-email → copy-key → poc-login → poc-watch flow to one step.
  if (!key && emailArg) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg)) {
      console.error(clr(c.red, 'Invalid email. Usage: poc watch <pkg> --email you@co.com'));
      process.exit(1);
    }
    process.stdout.write(clr(c.dim, '  Creating free API key...'));
    try {
      const createRes = await fetch('https://poc-backend.amdal-dev.workers.dev/api/keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailArg, source: 'cli-watch' }),
      });
      const keyData = await createRes.json();
      if (keyData.key) {
        await writeApiKey(keyData.key);
        key = keyData.key;
        console.log(clr(c.green, ' ✓'));
        console.log(clr(c.dim, `     Key saved to ~/.commit/config. Backup sent to ${emailArg}.`));
      } else {
        const errMsg = keyData.error === 'rate_limit_exceeded'
          ? 'Too many keys from this IP today.'
          : (keyData.message || 'Could not create key.');
        console.error(clr(c.red, ` ${errMsg}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(clr(c.red, ` Error: ${err.message}`));
      process.exit(1);
    }
  }

  if (!key) {
    console.error(clr(c.red, 'No API key found.'));
    console.error('');
    console.error(clr(c.bold, '  One-step setup — creates key + starts monitoring:'));
    console.error(clr(c.cyan, `    poc watch ${pkg} --email you@company.com`));
    console.error('');
    console.error(clr(c.dim, '  Or set COMMIT_API_KEY / add api_key=<key> to ~/.commit/config'));
    process.exit(1);
  }

  process.stdout.write(clr(c.dim, `  Adding ${pkg} (${ecosystem}) to watchlist...`));
  const res = await fetch(WATCHLIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ package: pkg, ecosystem }),
  });

  if (res.status === 402) { process.stdout.write('\n'); await printUpgradeRequired(res, 'watch-cmd'); process.exit(1); }
  if (res.status === 422) {
    const errData = await res.json().catch(() => ({}));
    process.stdout.write('\n');
    console.log(clr(c.yellow, `  ⚠ ${errData.message || 'Package limit reached.'}`));
    if (errData.upgrade) {
      console.log(clr(c.dim, `     ${errData.upgrade.message || `Upgrade to ${errData.upgrade.plan} for more:`}`));
      console.log(clr(c.cyan, `     ${errData.upgrade.url}`));
    }
    process.exit(1);
  }

  const data = await res.json();
  if (!res.ok) {
    console.error(`\n${clr(c.red, 'Error:')} ${data.message || JSON.stringify(data)}`);
    process.exit(1);
  }

  const isNew = data.new_packages > 0;
  process.stdout.write('\n');
  if (isNew) {
    console.log(clr(c.green, `  ✓ Now watching ${pkg}`));
    console.log(clr(c.dim, '    Weekly digest (Mondays). Upgrade to Developer ($15/mo) for daily scans + Slack alerts.'));
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
        headers: await auditHeaders(),
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
  let subcmd = args[0];

  // Transparent aliases: every other package manager (`npm audit`, `yarn audit`,
  // `pnpm audit`, `cargo audit`, `pip-audit`) puts the verb first. Users —
  // including readers of our own blog post at npm-trust-q2-2026 line 559 — type
  // `npx proof-of-commitment audit` and expect it to scan cwd's manifest.
  //
  // Without this branch the CLI parses `audit` as a POSITIONAL PACKAGE NAME,
  // which is a 13.9y-old npmjs.com/package/audit utility — silently scoring
  // the wrong package while burning the caller's daily quota. Caught during
  // 2026-06-11 buyer-journey dogfood (full transcript in reflection).
  //
  // We shift the verb off and fall through to the main parser so all flags
  // (--file, --pypi, --cargo, --golang, --json, --sarif, --fail-on) continue
  // to work positionally: `proof-of-commitment audit lodash --json` still
  // means "scan lodash, JSON output".
  if (subcmd === 'audit' || subcmd === 'scan' || subcmd === 'check') {
    args.shift();
    subcmd = args[0];
  }

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

  if (subcmd === 'hook') {
    await cmdHook(args.slice(1));
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
    if (!pkg) { console.error('Usage: poc watch <package> [--email you@co.com] [--ecosystem npm|pypi|cargo|golang]'); process.exit(1); }
    let ecosystem = 'npm';
    let email = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--ecosystem' || args[i] === '-e') ecosystem = args[++i] || 'npm';
      else if (args[i] === '--email') email = args[++i] || null;
      else if (args[i] === '--pypi') ecosystem = 'pypi';
      else if (args[i] === '--cargo') ecosystem = 'cargo';
      else if (args[i] === '--golang' || args[i] === '--go') ecosystem = 'golang';
    }
    await cmdWatch(pkg, ecosystem, email);
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
  let sarifOutput = false;
  // null means "default later" — depends on output mode and CI env.
  let failOn = null;
  // Set after arg-parse: true when JSON or SARIF suppresses interactive output.
  let structuredOutput = false;

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--pypi') { ecosystem = 'pypi'; i++; }
    else if (a === '--npm') { ecosystem = 'npm'; i++; }
    else if (a === '--cargo') { ecosystem = 'cargo'; i++; }
    else if (a === '--golang' || a === '--go') { ecosystem = 'golang'; i++; }
    else if (a === '--json') { jsonOutput = true; i++; }
    else if (a === '--sarif') { sarifOutput = true; i++; }
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

  structuredOutput = jsonOutput || sarifOutput;

  // Zero-arg auto-detect: if no positional packages and no --file, look for a manifest in cwd.
  if (!filePath && packages.length === 0) {
    const detected = await autodetectManifest(process.cwd());
    if (detected) {
      filePath = detected;
      if (!structuredOutput) console.log(clr(c.dim, `Auto-detected manifest: ${detected}`));
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
      if (!structuredOutput) console.log(clr(c.dim, `Detected ${totalInFile} packages from ${filePath} (${ecosystem})`));
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
  //   - --json/--sarif output (no CI) → 'critical' (machine-readable = CI-like).
  //   - interactive table output      → 'none' (backward-compatible for casual users).
  if (failOn === null) {
    const ciEnv = process.env.CI;
    const inCI = ciEnv === 'true' || ciEnv === '1';
    if (inCI || structuredOutput) failOn = 'critical';
    else failOn = 'none';
  }

  const t0 = Date.now();

  let allResults;
  let apiCta = null;

  if (packages.length <= 20) {
    if (!structuredOutput) process.stdout.write(clr(c.dim, `Scoring ${packages.length} ${ecosystem} package${packages.length > 1 ? 's' : ''}...`));

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: await auditHeaders(),
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
    if (!structuredOutput) process.stdout.write(clr(c.dim, ` done in ${elapsed}s\n`));

  } else {
    const batches = Math.ceil(packages.length / 20);
    if (!structuredOutput) process.stdout.write(clr(c.dim, `Scanning ${packages.length} packages (${batches} batches in parallel)...`));

    let lastPct = 0;
    let batchRescue = null;
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
      batchRescue = batchResult._rescue || null;
    } catch (err) {
      console.error(`\nError: ${err.message}`);
      process.exit(1);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (!structuredOutput) process.stdout.write(clr(c.dim, ` done in ${elapsed}s\n`));

    if (sarifOutput) {
      const sarif = formatSarif(allResults, { filePath, ecosystem, version: '1.26.0' });
      console.log(JSON.stringify(sarif, null, 2));
      process.exit(shouldFail(allResults, failOn) ? 1 : 0);
    }

    if (jsonOutput) {
      const criticalCount = allResults.filter(r => hasCritical(r.riskFlags)).length;
      const provenanceCount = allResults.filter(r => r.hasProvenance).length;
      const stagedPublishingCount = allResults.filter(r => r.hasStagedPublishing === true).length;
      console.log(JSON.stringify({
        totalScanned: allResults.length,
        criticalCount,
        provenanceCount,
        stagedPublishingCount,
        failOn,
        rateLimited: !!batchRescue,
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
    // Rate-limit aggregation (2026-06-16 fix): if ANY batch hit 429, the
    // aggregated table above ALREADY includes packages_already_scored from
    // every 429'd batch (auditBatched flattens 200 + 429 results). Surface
    // ONE rescue CTA here that ALSO short-circuits the normal inlineSignup
    // path — the rescue CTA itself runs the TTY email→key prompt for free
    // tier users (overshoot/keyUpgrade branches print upgrade URL and exit).
    // renderRescueCta() always process.exit(1)s at its tail, so this is the
    // terminal path for any rate-limited scan.
    if (batchRescue) {
      // Override the per-batch "Scored 3 of 20 packages" message with
      // an aggregate-aware one before rendering. Pre-fix: user sent 326,
      // saw a "3 of 20" rescue message that referenced one batch's slice.
      // Post-fix: reflect what the user actually saw in the aggregated table.
      const isOvershoot = batchRescue.overshoot === true || batchRescue.tier_suggestion === 'developer';
      const rescueWithAggregate = {
        ...batchRescue,
        message: isOvershoot
          ? `Scored ${allResults.length} of ${packages.length} packages — you're past the free-tier daily limit on this IP. A free key gives 200/day but a ${packages.length}-package lockfile would burn through it; Developer ($15/mo) gives 1,000/day + batch API.`
          : `Scored ${allResults.length} of ${packages.length} packages — free-tier daily limit reached on this IP (often shared via corporate NAT / CI / dev container). A free API key in 30 seconds lifts the limit to 200/day.`,
      };
      await renderRescueCta(rescueWithAggregate); // exits 1
    }
    await inlineSignup(displayed, { engagementSignal: !!apiCta });
    if (shouldFail(allResults, failOn)) {
      console.error(clr(c.red + c.bold, `\n✗ --fail-on=${failOn} threshold met. Exit 1.`));
      process.exit(1);
    }
    return;
  }

  if (!allResults || allResults.length === 0) {
    if (sarifOutput) {
      const sarif = formatSarif([], { filePath, ecosystem, version: '1.26.0' });
      console.log(JSON.stringify(sarif, null, 2));
    } else if (jsonOutput) {
      console.log(JSON.stringify({ totalScanned: 0, criticalCount: 0, provenanceCount: 0, failOn, results: [] }, null, 2));
    } else {
      console.log('No results returned. Check package names and try again.');
    }
    process.exit(0);
  }

  if (sarifOutput) {
    const sarif = formatSarif(allResults, { filePath, ecosystem, version: '1.26.0' });
    console.log(JSON.stringify(sarif, null, 2));
    process.exit(shouldFail(allResults, failOn) ? 1 : 0);
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
  await inlineSignup(allResults, { engagementSignal: !!apiCta });
  if (shouldFail(allResults, failOn)) {
    console.error(clr(c.red + c.bold, `✗ --fail-on=${failOn} threshold met. Exit 1.`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
