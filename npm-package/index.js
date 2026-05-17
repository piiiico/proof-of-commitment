#!/usr/bin/env node
/**
 * proof-of-commitment CLI v1.8.1
 * Scores npm/PyPI/Cargo/Go packages on behavioral commitment signals.
 * Usage: npx proof-of-commitment [packages...] [options]
 */

const API = 'https://poc-backend.amdal-dev.workers.dev/api/audit';
const WEB = 'https://getcommit.dev/audit';

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

function clr(code, text) {
  if (NO_COLOR) return text;
  return `${code}${text}${c.reset}`;
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
  console.log(clr(c.cyan, `\n  🔗 Full report: ${WEB}?packages=${encodeURIComponent(topPkgs)}`));
  console.log(clr(c.cyan, `  🤖 GitHub Action: github.com/piiiico/commit-action — block CRITICAL packages in CI`));

  // Contextual upsell — show when findings make monitoring relevant
  if (effectiveCritical > 0) {
    console.log(clr(c.dim, `\n  📊 Track ${effectiveCritical === 1 ? 'this package' : 'these packages'} daily. Get alerted on score changes.`));
    console.log(clr(c.dim, `     Commit Pro — batch API, monitoring, alerts → https://getcommit.dev/pricing`));
  }
  console.log();
}

function printHelp() {
  console.log(`
${clr(c.bold, 'proof-of-commitment')} v1.8.1 — supply chain risk scorer

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

${clr(c.bold, 'MCP:')} Add to Claude Desktop / Cursor for AI-assisted auditing — see homepage.

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
  const results = await Promise.all(
    batches.map(async (batch) => {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: batch, ecosystem }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      const data = await res.json();
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

  return all;
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

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
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

  if (packages.length <= 20) {
    if (!jsonOutput) process.stdout.write(clr(c.dim, `Scoring ${packages.length} ${ecosystem} package${packages.length > 1 ? 's' : ''}...`));

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages, ecosystem }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      const data = await res.json();
      allResults = data.results || [];
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
      allResults = await auditBatched(packages, ecosystem, {
        onProgress: (done, total) => {
          const pct = Math.round((done / total) * 100);
          if (pct >= lastPct + 20) {
            process.stdout.write(clr(c.dim, ` ${pct}%`));
            lastPct = pct;
          }
        }
      });
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
  if (shouldFail(allResults, failOn)) {
    console.error(clr(c.red + c.bold, `✗ --fail-on=${failOn} threshold met. Exit 1.`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
