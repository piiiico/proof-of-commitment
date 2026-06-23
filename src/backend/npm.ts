/**
 * npm Package Commitment Profile
 *
 * Queries the public npm registry + downloads API (no auth required) to
 * compute a behavioral trust score for any npm package.
 *
 * Score dimensions:
 *   Longevity          (25 pts) — how long the package has existed
 *   Download momentum  (25 pts) — recent downloads + trend consistency
 *   Release consistency (20 pts) — version count + publish cadence
 *   Publisher depth    (15 pts) — number of npm publishers (people with publish access)
 *   GitHub backing     (15 pts) — if linked repo, GitHub commitment score
 *
 * Uses public APIs only:
 *   https://registry.npmjs.org/{package}
 *   https://api.npmjs.org/downloads/range/{start}:{end}/{package}
 */

import {
  buildGitHubCommitmentProfile,
  parseGitHubInput,
} from "./github.ts";

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/range";
const NPM_DOWNLOADS_POINT = "https://api.npmjs.org/downloads/point";
const GH_API = "https://api.github.com";
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "proof-of-commitment-mcp/1.0",
  "X-GitHub-Api-Version": "2022-11-28",
};

interface NpmPackage {
  name: string;
  description?: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, {
    repository?: { type: string; url: string };
    dist?: { attestations?: unknown; [key: string]: unknown };
    _npmUser?: { name: string; email?: string };
  }>;
  time: Record<string, string>; // ISO timestamps per version + "created"/"modified"
  maintainers?: { name: string; email?: string }[];
  repository?: { type: string; url: string };
  keywords?: string[];
  license?: string;
}

export interface DownloadRange {
  downloads: { day: string; downloads: number }[];
  package: string;
  start: string;
  end: string;
}

/** A valid download response must have entries AND at least one non-zero value. */
function hasValidDownloads(candidate: DownloadRange): boolean {
  return (
    Array.isArray(candidate.downloads) &&
    candidate.downloads.length > 0 &&
    candidate.downloads.some((d) => d.downloads > 0)
  );
}

/**
 * Detect when an npm package's weeklyDownloads result is almost certainly
 * a transient fetch failure rather than legitimate zero traffic.
 *
 * Background (2026-06-23 dogfood, 1st batch of an audit-page session): a
 * fresh /api/audit call for ["express","axios","lodash","chalk","zod","react",
 * "next","webpack","typescript","tailwindcss"] returned weeklyDownloads=0 for
 * EVERY package, with no CRITICAL flags (which depend on wdl>10M) and scores
 * 50-72 (downloadMomentum=0 component). All subsequent same-IP calls returned
 * correct data. Root cause is the documented CF colo cache poisoning path
 * (npm sets Cache-Control: max-age=300; one degraded npm-edge response sticks
 * to the colo for ~5 min, defeats bulk + per-package rescue + slow-path retry
 * because they all hit the same colo). User-visible symptom: scoring axios
 * at 68 with "0/wk" downloads next to lodash at 58 with "0/wk" — a hard
 * credibility hit on first interaction (the moment the conversion decision
 * gets made). Blog post 2026-06-23 ("978 downloads, zero signups") frames
 * 0-organic-conversions as a post-signup-value problem, but the audit
 * surface lying about downloads is a *pre-signup credibility* problem that
 * needs its own gate.
 *
 * Heuristic: any npm package with 30+ published versions AND 1+ year of
 * registry age that comes back with weeklyDownloads=0 is almost certainly
 * a fetch failure. Mature, multi-version packages essentially never have
 * literal zero downloads — even unmaintained ones get legacy installs.
 * False-positive risk: ~0. False-negative risk: bug still slips through
 * for newer (<1y) or sparsely-versioned (<30 versions) packages, but those
 * have lower baseline scoring weight from downloads anyway.
 *
 * When this returns true, callers should report weeklyDownloads as `null`
 * (data unavailable) rather than 0 (definite zero), and may surface
 * `downloadDataMissing: true` so the UI can show "—" with a discreet
 * "fetching failed, retry" affordance instead of a confident-but-wrong
 * "0/wk" cell.
 */
export function isSuspiciouslyZeroDownloads(
  weeklyDownloads: number | null | undefined,
  versionCount: number | null | undefined,
  ageYears: number | null | undefined,
): boolean {
  return (
    weeklyDownloads === 0 &&
    typeof versionCount === "number" && versionCount >= 30 &&
    typeof ageYears === "number" && ageYears >= 1
  );
}

/**
 * Bulk-fetch WEEKLY download totals for multiple npm packages in ONE API call.
 * Uses the point API (/downloads/point/last-week) which is simpler and more reliable
 * than the range API — avoids the concurrent-request race condition that causes zeros.
 *
 * Supports up to 128 packages per batch call.
 * Scoped packages (@scope/name) are NOT supported by the npm bulk API.
 *
 * Returns a Map from package name → weekly download count (null = not found/error).
 *
 * Resilience (added 2026-06-04, root-caused via repro stress test):
 *   The bulk endpoint sometimes returns 200 OK with empty / null entries when
 *   the worker's outbound IP gets de-prioritised by npm (observed: 4 of 5
 *   /api/audit batch calls returned weeklyDownloads=0 for ALL packages, while
 *   direct curl from elsewhere works fine). When that happens, missing entries
 *   are filled in via per-package point API calls in parallel. This keeps the
 *   1-RTT happy path AND prevents the 429-overshoot conversion moment from
 *   showing misleadingly mediocre scores (axios=66 instead of axios=88, etc.).
 */
export async function bulkFetchNpmWeeklyDownloads(
  packageNames: string[]
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (packageNames.length === 0) return result;

  // npm bulk API supports up to 128 packages per batch
  const batches: string[][] = [];
  for (let i = 0; i < packageNames.length; i += 128) {
    batches.push(packageNames.slice(i, i + 128));
  }

  await Promise.all(
    batches.map(async (batch) => {
      const bulkUrl = `${NPM_DOWNLOADS_POINT}/last-week/${batch.join(",")}`;
      try {
        // cf.cacheTtl: 0 disables CF's automatic edge cache for this fetch.
        // Without it, the FIRST response a colo gets (which can be a stale or
        // empty npm response from npm's own CF cache) is locked in for 5 min
        // because npm sets Cache-Control: public, max-age=300. Result: that
        // colo silently returns weeklyDownloads=0 for every audit batch hit
        // until the npm cache entry expires. We rely on application-level
        // caching (caches.default in buildNpmCommitmentProfile for the range
        // API + npm's own CDN for cold misses) — bypassing fetch's built-in
        // cache layer is the only way to detect and recover from npm-side
        // partial responses.
        const res = await fetch(bulkUrl, {
          headers: { Accept: "application/json" },
          // @ts-ignore CF fetch type
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        if (res.ok) {
          const data = await res.json();
          // npm returns two different response formats:
          // - Single package:  { downloads: N, package: "rollup", start: "...", end: "..." }  (flat)
          // - Multi-package:   { "rollup": { downloads: N }, "express": { downloads: N } }     (keyed)
          // Detect flat format by checking if top-level "downloads" is a number.
          const isFlatSingleResponse =
            batch.length === 1 &&
            typeof (data as { downloads?: unknown }).downloads === "number";
          for (const name of batch) {
            let count: number;
            if (isFlatSingleResponse) {
              count = (data as { downloads: number }).downloads;
            } else {
              const entry = (data as Record<string, { downloads: number } | null>)[name];
              count = entry?.downloads ?? 0;
            }
            result.set(name, count > 0 ? count : null);
          }
        } else {
          for (const name of batch) result.set(name, null);
        }
      } catch {
        for (const name of batch) result.set(name, null);
      }
    })
  );

  // Per-package rescue pass: any package the bulk endpoint returned null for
  // (either missing from response, error response, or count<=0) gets a single
  // per-package point API call. This is the same endpoint as bulk, just
  // narrower scope — when bulk silently degrades, per-package usually still
  // works because npm's per-package cache is hot. Runs in parallel; capped at
  // 8 concurrent to avoid stampeding npm on large batches.
  const missing = packageNames.filter((n) => {
    const v = result.get(n);
    return v == null;
  });
  if (missing.length > 0) {
    const RESCUE_CONCURRENCY = 8;
    for (let i = 0; i < missing.length; i += RESCUE_CONCURRENCY) {
      const slice = missing.slice(i, i + RESCUE_CONCURRENCY);
      await Promise.all(
        slice.map(async (name) => {
          try {
            const pointUrl = `${NPM_DOWNLOADS_POINT}/last-week/${encodeURIComponent(name)}`;
            const r = await fetch(pointUrl, {
              headers: { Accept: "application/json" },
              // @ts-ignore CF fetch type — bypass colo cache; see note above.
              cf: { cacheTtl: 0, cacheEverything: false },
            });
            if (!r.ok) return;
            const data = (await r.json()) as { downloads?: number };
            if (typeof data.downloads === "number" && data.downloads > 0) {
              result.set(name, data.downloads);
            }
          } catch {
            // Non-fatal — package stays null, buildNpmCommitmentProfile will
            // attempt its own retry-with-backoff below.
          }
        })
      );
    }
  }

  return result;
}

/** Publisher lifecycle: who published, when, and are they still active? */
export interface PublisherLifecycle {
  /** Count of unique npm usernames that published at least one version */
  totalHistoricalPublishers: number;
  /** Publishers who published within the last 12 months */
  activePublishers: number;
  /** Publishers who haven't published in 12+ months AND still appear in maintainers (current scope access) */
  dormantWithAccess: number;
  /** Publishers who haven't published in 12+ months but were removed from maintainers (revoked) */
  dormantRevoked: number;
  /** Fraction of current maintainers that have published in the last 12 months */
  activeRatio: number;
  /** Details on dormant publishers who STILL have scope access (highest risk, sorted longest-inactive first) */
  dormantDetails: Array<{
    name: string;
    lastPublish: string; // ISO date
    monthsInactive: number;
    versionCount: number;
    hasCurrentAccess: boolean;
  }>;
}

export interface NpmCommitmentProfile {
  name: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;
  keywords: string[];

  // Behavioral signals
  ageYears: number;
  versionCount: number;
  maintainerCount: number;
  githubContributors: number | null;
  recentWeeklyDownloads: number;
  downloadTrend: "growing" | "stable" | "declining" | null;
  daysSinceLastPublish: number;
  repositoryUrl: string | null;

  // Publisher lifecycle (new: dormant publisher detection)
  publisherLifecycle: PublisherLifecycle | null;

  // Build integrity signals (separate from behavioral/commitment scoring)
  hasProvenance: boolean | null; // npm SLSA provenance attestation (null = check failed/skipped)
  scorecardScore: number | null; // OpenSSF Scorecard 0–10 (null = no GitHub repo or not indexed)
  hasDangerousWorkflow: boolean | null; // true = Dangerous-Workflow Scorecard check failed (null = no Scorecard data)
  hasStagedPublishing: boolean | null; // npm Staged Publishing (GA May 2026): human 2FA approval before release (null = inconclusive)

  // Trust signals
  trustedPublishing: boolean;

  // Scores
  commitmentScore: number;
  scoreBreakdown: {
    longevity: number;
    downloadMomentum: number;
    releaseConsistency: number;
    maintainerDepth: number;
    githubBacking: number;
    trustedPublishing: number;
    stagedPublishing: number;
  };
  githubScore: number | null;

  summary: string;
}

function formatDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function parseRepoUrl(url: string | undefined): string | null {
  if (!url) return null;
  // Normalize various git URL formats to https://github.com/owner/repo
  const normalized = url
    .replace(/^git\+/, "")           // git+https:// → https://
    .replace(/^git:\/\//, "https://") // git:// → https://
    .replace(/^ssh:\/\/git@/, "https://") // ssh://git@github.com → https://github.com
    .replace(/^git@github\.com:/, "https://github.com/") // git@github.com:owner/repo
    .replace(/\.git$/, "");
  if (normalized.includes("github.com")) return normalized;
  return null;
}

/**
 * Analyze publisher lifecycle from per-version _npmUser metadata.
 *
 * npm's registry response includes _npmUser on each version object,
 * identifying who pushed each release. This lets us distinguish packages
 * where all publishers are active from those carrying dormant credentials
 * that remain valid scope-access vectors (the Mastra attack pattern,
 * June 2026 — a contributor dormant since 2024 with never-revoked access).
 *
 * "GitHub Actions" / OIDC publishers are excluded — they're automation,
 * not human credential risk.
 */
function analyzePublisherLifecycle(
  pkg: NpmPackage,
): PublisherLifecycle | null {
  const now = Date.now();
  const TWELVE_MONTHS_MS = 365.25 * 24 * 3600 * 1000;

  // Collect per-publisher stats from version _npmUser fields
  const publisherMap = new Map<string, { lastPublish: number; count: number }>();
  for (const [version, meta] of Object.entries(pkg.versions)) {
    const user = meta._npmUser;
    if (!user?.name) continue;
    // Skip automation accounts — not human credential risk
    if (user.name === "GitHub Actions" || user.email?.includes("npm-oidc")) continue;

    const ts = pkg.time[version];
    if (!ts) continue;
    const publishTime = new Date(ts).getTime();
    if (isNaN(publishTime)) continue;

    const existing = publisherMap.get(user.name);
    if (!existing) {
      publisherMap.set(user.name, { lastPublish: publishTime, count: 1 });
    } else {
      existing.count++;
      if (publishTime > existing.lastPublish) existing.lastPublish = publishTime;
    }
  }

  // Need at least 1 human publisher to produce lifecycle data
  if (publisherMap.size === 0) return null;

  // Build set of current maintainer names for cross-referencing
  const currentMaintainers = new Set(
    (pkg.maintainers ?? []).map((m) => m.name.toLowerCase()),
  );

  let activeCount = 0;
  let dormantWithAccess = 0;
  let dormantRevoked = 0;
  const dormantDetails: PublisherLifecycle["dormantDetails"] = [];

  for (const [name, data] of publisherMap) {
    const msSincePublish = now - data.lastPublish;
    if (msSincePublish < TWELVE_MONTHS_MS) {
      activeCount++;
    } else {
      const hasAccess = currentMaintainers.has(name.toLowerCase());
      if (hasAccess) dormantWithAccess++;
      else dormantRevoked++;
      dormantDetails.push({
        name,
        lastPublish: new Date(data.lastPublish).toISOString().slice(0, 10),
        monthsInactive: Math.round(msSincePublish / (30.44 * 24 * 3600 * 1000)),
        versionCount: data.count,
        hasCurrentAccess: hasAccess,
      });
    }
  }

  // Sort: current-access dormant first (highest risk), then by longest-inactive
  dormantDetails.sort((a, b) => {
    if (a.hasCurrentAccess !== b.hasCurrentAccess) return a.hasCurrentAccess ? -1 : 1;
    return b.monthsInactive - a.monthsInactive;
  });

  const total = publisherMap.size;
  // activeRatio based on historical publishers, not current maintainers
  return {
    totalHistoricalPublishers: total,
    activePublishers: activeCount,
    dormantWithAccess,
    dormantRevoked,
    activeRatio: total > 0 ? activeCount / total : 1,
    dormantDetails,
  };
}

function scoreLongevity(ageYears: number): number {
  if (ageYears >= 6) return 25;
  if (ageYears >= 4) return 20;
  if (ageYears >= 2) return 14;
  if (ageYears >= 1) return 8;
  if (ageYears >= 0.5) return 4;
  return 1;
}

function scoreDownloads(
  weeklyAvg: number,
  trend: "growing" | "stable" | "declining" | null
): number {
  // Base score from absolute volume
  let base = 0;
  if (weeklyAvg >= 1_000_000) base = 22;
  else if (weeklyAvg >= 100_000) base = 18;
  else if (weeklyAvg >= 10_000) base = 14;
  else if (weeklyAvg >= 1_000) base = 10;
  else if (weeklyAvg >= 100) base = 6;
  else if (weeklyAvg >= 10) base = 3;
  else base = 0;

  // Trend bonus/penalty
  const trendMod = trend === "growing" ? 3 : trend === "declining" ? -3 : 0;
  return Math.max(0, Math.min(25, base + trendMod));
}

function scoreReleases(
  versionCount: number,
  daysSincePublish: number
): number {
  let base = 0;
  if (versionCount >= 100) base = 15;
  else if (versionCount >= 30) base = 12;
  else if (versionCount >= 10) base = 9;
  else if (versionCount >= 3) base = 6;
  else if (versionCount >= 1) base = 3;

  // Bonus for recent publish (within 90 days)
  const recency =
    daysSincePublish < 30
      ? 5
      : daysSincePublish < 90
      ? 3
      : daysSincePublish < 365
      ? 1
      : 0;

  return Math.min(20, base + recency);
}

function scoreMaintainers(
  count: number,
  lifecycle: PublisherLifecycle | null,
): number {
  // Base score from maintainer count (unchanged)
  let base: number;
  if (count >= 5) base = 15;
  else if (count >= 3) base = 11;
  else if (count >= 2) base = 7;
  else if (count === 1) base = 4;
  else base = 0;

  // Lifecycle adjustment: dormant publishers who STILL have scope access
  // reduce effective depth. Only penalize for dormantWithAccess — publishers
  // who were removed from maintainers are already revoked (no risk).
  // This is the Mastra pattern: ehindero was dormant since 2024 but still
  // had scope access in June 2026.
  if (lifecycle && lifecycle.dormantWithAccess > 0) {
    // Penalty: -2 points per dormant-with-access publisher, capped at 40% of base.
    // A single dormant maintainer is a moderate risk; three is severe.
    const rawPenalty = lifecycle.dormantWithAccess * 2;
    const maxPenalty = Math.round(base * 0.4);
    base = Math.max(0, base - Math.min(rawPenalty, maxPenalty));
  }

  return base;
}

/**
 * Compute weekly average downloads from daily data.
 * Returns { avg7d, avg90d, trend }.
 */
function analyzeDownloads(downloads: { day: string; downloads: number }[]): {
  avg7d: number;
  avg90d: number;
  trend: "growing" | "stable" | "declining" | null;
} {
  if (downloads.length < 14) {
    return { avg7d: 0, avg90d: 0, trend: null };
  }

  const recent7 = downloads.slice(-7);
  const avg7d = Math.round(
    recent7.reduce((s, d) => s + d.downloads, 0) / 7
  );

  // 90d comparison (first half vs second half of last 90 days)
  const last90 = downloads.slice(-90);
  const avg90d = Math.round(
    last90.reduce((s, d) => s + d.downloads, 0) / last90.length
  );

  const firstHalf = last90.slice(0, 45);
  const secondHalf = last90.slice(45);
  const firstAvg =
    firstHalf.reduce((s, d) => s + d.downloads, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((s, d) => s + d.downloads, 0) / secondHalf.length;

  const ratio = firstAvg > 0 ? secondAvg / firstAvg : 1;
  const trend =
    ratio > 1.15
      ? "growing"
      : ratio < 0.85
      ? "declining"
      : "stable";

  return { avg7d, avg90d, trend };
}

/**
 * Check whether an npm package version has SLSA provenance attestations.
 *
 * npm has supported provenance statements since May 2023. When present, a
 * package version can be verified to have been built from a specific source
 * commit in a specific GitHub Actions run — giving cryptographic assurance
 * that the published artifact matches the source code.
 *
 * This catches build-pipeline attacks (e.g. @bitwarden/cli Apr 2026) that
 * behavioral scoring cannot detect because the credentials used were legitimate.
 *
 * API: GET https://registry.npmjs.org/-/npm/v1/attestations/<package>@<version>
 * Returns 200 with attestations[] if present, 404 if not.
 *
 * @returns true if provenance exists, false if it doesn't, null on error.
 */
async function checkNpmProvenance(
  packageName: string,
  version: string | null
): Promise<boolean | null> {
  if (!version) return null;
  const encodedName = encodeURIComponent(packageName).replace(/^%40/, "@");
  const url = `${NPM_REGISTRY}/-/npm/v1/attestations/${encodedName}@${encodeURIComponent(version)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // @ts-ignore CF fetch cache hint
      cf: { cacheEverything: true, cacheTtl: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return false;
    if (!res.ok) return null; // unexpected error — don't penalize
    const data = (await res.json()) as { attestations?: unknown[] };
    return Array.isArray(data.attestations) && data.attestations.length > 0;
  } catch {
    return null; // timeout or network error — non-fatal
  }
}

/**
 * Detect npm Staged Publishing adoption for a package.
 *
 * npm Staged Publishing (GA May 2026) adds a mandatory human 2FA approval step
 * between CI publishing a version and that version becoming the default install
 * target (i.e. what you get with `npm install <pkg>`). This is a stronger signal
 * than OIDC provenance alone for sole-publisher packages — validated by PostCSS
 * maintainer Andrey Sitnik (postcss/postcss#2096) and the TanStack Shai-Hulud /
 * Red Hat @redhat-cloud-services incidents (June 2026), where valid SLSA provenance
 * was present but the CI pipeline itself was compromised.
 *
 * Detection (two-tier):
 *  1. dist-tags.stage present — active staged version pending promotion (free: already in registry metadata)
 *  2. GitHub Actions workflow file scan — finds `npm stage` or `@npm/staged-publish` patterns
 *     (costs 1 + up to 3 GitHub API calls; only runs when a linked repo is available)
 *
 * @returns true if detected, false if definitively not found, null if inconclusive.
 */
async function checkStagedPublishing(
  pkg: NpmPackage,
  repoUrl: string | null
): Promise<boolean | null> {
  // Tier 1: active stage dist-tag (zero extra requests — already in registry response)
  if (pkg["dist-tags"]["stage"]) {
    return true;
  }

  // Tier 2: GitHub Actions workflow inspection
  if (repoUrl) {
    const parsed = parseGitHubInput(repoUrl);
    if (parsed) {
      const { owner, repo } = parsed;
      try {
        // List .github/workflows — one unauthenticated request (rate limit: 60/hr shared)
        const listRes = await fetch(
          `${GH_API}/repos/${owner}/${repo}/contents/.github/workflows`,
          {
            headers: GH_HEADERS,
            // @ts-ignore CF fetch cache hint
            cf: { cacheEverything: true, cacheTtl: 3600 },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (!listRes.ok) return false;

        const files = (await listRes.json()) as Array<{
          name: string;
          download_url: string | null;
        }>;

        // Prioritize workflow files that typically contain publish steps
        const candidates = files
          .filter(
            (f) =>
              /\.(yml|yaml)$/.test(f.name) &&
              /publish|release|deploy|npm/i.test(f.name)
          )
          .slice(0, 3); // Limit to 3 content fetches to cap API usage

        for (const file of candidates) {
          if (!file.download_url) continue;
          try {
            const contentRes = await fetch(file.download_url, {
              // @ts-ignore CF fetch cache hint
              cf: { cacheEverything: true, cacheTtl: 3600 },
              signal: AbortSignal.timeout(3000),
            });
            if (!contentRes.ok) continue;
            const content = await contentRes.text();
            // Detect npm Staged Publishing patterns:
            //   npm stage           — npm CLI command (npm stage promote, npm stage ls, etc.)
            //   @npm/staged-publish — official GitHub Action (if/when published)
            //   staged-publish      — common action/script name in ecosystem
            if (/\bnpm\s+stage\b|@npm\/staged-publish|staged-publish/i.test(content)) {
              return true;
            }
          } catch {
            // Non-fatal — try next file
          }
        }
        return false;
      } catch {
        return null; // GitHub API unavailable — inconclusive
      }
    }
  }

  return false;
}

/**
 * Build a behavioral commitment profile for an npm package.
 * @param preloadedWeekly  Optional pre-fetched weekly download count (from bulkFetchNpmWeeklyDownloads).
 *   Pass a positive number to skip the individual download API call (batch mode).
 *   Pass `null` to indicate the package wasn't found in the bulk response.
 *   Omit (undefined) to fetch downloads individually (default / scoped package path).
 */
export async function buildNpmCommitmentProfile(
  packageName: string,
  preloadedWeekly?: number | null
): Promise<NpmCommitmentProfile | null> {
  const encodedName = encodeURIComponent(packageName).replace(
    /^%40/,
    "@"
  );

  // 1. Registry metadata
  const regRes = await fetch(`${NPM_REGISTRY}/${encodedName}`, {
    headers: { Accept: "application/json" },
    // @ts-ignore CF fetch cache hint
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!regRes.ok) return null;
  const pkg = (await regRes.json()) as NpmPackage;

  const now = Date.now();
  const created = new Date(pkg.time["created"] ?? "").getTime() || now;
  const ageYears = (now - created) / (365.25 * 24 * 3600 * 1000);

  // Latest version
  const latestVersion = pkg["dist-tags"]["latest"] ?? null;

  // Use the latest version's actual publish date, NOT pkg.time["modified"]
  // (modified is updated on metadata changes like deprecations, not new releases)
  const latestVersionTime = latestVersion && pkg.time[latestVersion]
    ? new Date(pkg.time[latestVersion]).getTime()
    : new Date(pkg.time["modified"] ?? "").getTime() || now;
  const daysSinceLastPublish = Math.round((now - latestVersionTime) / (24 * 3600 * 1000));

  // Version count (exclude "created" and "modified" metadata keys)
  const versions = Object.keys(pkg.time).filter(
    (k) => k !== "created" && k !== "modified" && k !== "unpublished"
  );
  const versionCount = versions.length;

  // Maintainers
  const maintainerCount = pkg.maintainers?.length ?? 1;

  // Publisher lifecycle: active vs dormant publishers (from per-version _npmUser)
  const publisherLifecycle = analyzePublisherLifecycle(pkg);

  // Trusted Publishing (npm OIDC provenance) — detected via dist.attestations field
  const trustedPublishing = !!(
    latestVersion && pkg.versions[latestVersion]?.dist?.attestations
  );

  // Repository URL
  const repoUrl = parseRepoUrl(
    pkg.repository?.url ??
      pkg.versions[pkg["dist-tags"]["latest"] ?? ""]?.repository?.url
  );

  // 2. Downloads (last 6 months)
  const startDate = formatDate(180);
  const endDate = formatDate(1);
  let downloadData: { day: string; downloads: number }[] = [];
  let avg7d = 0;
  let avg90d = 0;
  let trend: "growing" | "stable" | "declining" | null = null;

  if (preloadedWeekly !== undefined) {
    // Fast path: bulk weekly count was supplied by the caller (from bulkFetchNpmWeeklyDownloads).
    // This eliminates the per-package concurrent HTTP race condition that causes npm to return zeros.
    // Trade-off: trend data is unavailable in batch mode (stays null) — acceptable.
    if (preloadedWeekly !== null && preloadedWeekly > 0) {
      avg7d = Math.round(preloadedWeekly / 7);
      // trend stays null — no day-by-day data in batch mode
    }
    // If preloadedWeekly === null, the bulk fetch had no data for this package.
    // Fall back to point API to ensure we never return 0 due to a bulk-fetch miss.
    // Retry once with backoff: in 2026-06-04 stress test, the bulk endpoint
    // intermittently degraded for the worker's outbound IP and a single
    // immediate retry was insufficient — a brief delay helps. Two-attempt
    // budget keeps p99 worst-case latency bounded (~600ms add).
    if (avg7d === 0) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
        try {
          const pointUrl = `${NPM_DOWNLOADS_POINT}/last-week/${encodedName}`;
          const pointRes = await fetch(pointUrl, {
            headers: { Accept: "application/json" },
            // @ts-ignore CF fetch type — bypass colo cache (npm sets max-age=300).
            cf: { cacheTtl: 0, cacheEverything: false },
          });
          if (pointRes.ok) {
            const pointData = (await pointRes.json()) as { downloads: number };
            if (typeof pointData.downloads === "number" && pointData.downloads > 0) {
              avg7d = Math.round(pointData.downloads / 7);
              break;
            }
          }
        } catch {
          // Non-fatal fallback
        }
      }
    }
  } else {
    // Slow path: individual fetch (used for scoped packages or direct single-package calls).
    // Download data changes slowly — cache for 1 hour, but ONLY cache valid non-empty responses.
    try {
      const dlUrl = `${NPM_DOWNLOADS}/${startDate}:${endDate}/${encodedName}`;
      // cf.cacheTtl: 0 disables CF's automatic edge cache.
      //
      // The original comment here claimed "no cf.cacheEverything = no caching",
      // but CF Workers fetch() caches GET responses with Cache-Control headers
      // by default (npm returns Cache-Control: public, max-age=300). Without
      // explicit bypass, a colo that once received an empty/degraded npm
      // response holds it for 5 min and validates-then-rejects on every retry
      // — making the manual caches.default layer (which guards against
      // all-zero responses) unable to ever recover until npm's cache expires.
      // We manage caching manually via caches.default; bypass the built-in.
      const fetchOpts = {
        headers: { Accept: "application/json" },
        // @ts-ignore CF fetch type
        cf: { cacheTtl: 0, cacheEverything: false },
      };

      let dlData: DownloadRange | null = null;

      // Check manual cache first (only valid non-empty responses are stored here)
      try {
        const cacheKey = new Request(dlUrl, { headers: { Accept: "application/json" } });
        const cachedRes = await caches.default.match(cacheKey);
        if (cachedRes) {
          const candidate = (await cachedRes.json()) as DownloadRange;
          if (hasValidDownloads(candidate)) {
            dlData = candidate;
          }
          // If cache has all-zero data, fall through to fresh fetch (stale/corrupted entry)
        }
      } catch {
        // caches.default unavailable (e.g. local dev) — fall through to fresh fetch
      }

      if (!dlData) {
        // Fetch fresh from npm. Retry up to 2 times with backoff on failure or empty response.
        let dlRes = await fetch(dlUrl, fetchOpts);

        if (!dlRes.ok || dlRes.status === 429) {
          await new Promise((r) => setTimeout(r, 1500));
          dlRes = await fetch(dlUrl, fetchOpts);
        }

        if (dlRes.ok) {
          const candidate = (await dlRes.json()) as DownloadRange;
          if (hasValidDownloads(candidate)) {
            dlData = candidate;
          } else {
            // Empty/all-zero downloads array — possibly rate-limited, retry once more
            await new Promise((r) => setTimeout(r, 1500));
            const retryRes = await fetch(dlUrl, fetchOpts);
            if (retryRes.ok) {
              const retryCandidate = (await retryRes.json()) as DownloadRange;
              if (hasValidDownloads(retryCandidate)) {
                dlData = retryCandidate;
              }
            }
          }
        }

        // Cache only if we got valid data
        if (dlData) {
          try {
            const cacheKey = new Request(dlUrl, { headers: { Accept: "application/json" } });
            const toCache = new Response(JSON.stringify(dlData), {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "max-age=3600",
              },
            });
            await caches.default.put(cacheKey, toCache);
          } catch {
            // Cache write failed — non-fatal
          }
        }
      }

      if (dlData) {
        downloadData = dlData.downloads;
        const analysis = analyzeDownloads(downloadData);
        avg7d = analysis.avg7d;
        avg90d = analysis.avg90d;
        trend = analysis.trend;
      }

      // Fallback: if range API gave us 0 avg (all-zero or missing), use npm point API.
      // This handles stale CF cache entries and transient npm rate-limit responses.
      if (avg7d === 0) {
        try {
          const pointUrl = `${NPM_DOWNLOADS_POINT}/last-week/${encodedName}`;
          const pointRes = await fetch(pointUrl, {
              headers: { Accept: "application/json" },
              // @ts-ignore CF fetch type — bypass colo cache; npm sends Cache-Control:
              // public,max-age=300 which CF caches automatically. If CF holds a stale
              // all-zero response, this fallback branch (triggered by avg7d===0) would
              // never recover. Bypass matches the bulk-fetch strategy above.
              cf: { cacheTtl: 0, cacheEverything: false },
            });
          if (pointRes.ok) {
            const pointData = (await pointRes.json()) as { downloads: number };
            if (typeof pointData.downloads === "number" && pointData.downloads > 0) {
              avg7d = Math.round(pointData.downloads / 7);
              // Keep trend as null since we don't have historical data
            }
          }
        } catch {
          // Non-fatal fallback
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 3. GitHub backing + provenance + staged publishing (concurrent, all optional, best-effort)
  let githubScore: number | null = null;
  let githubBacking = 0;
  let githubContributors: number | null = null;
  let hasProvenance: boolean | null = null;
  let scorecardScore: number | null = null;
  let hasDangerousWorkflow: boolean | null = null;
  let hasStagedPublishing: boolean | null = null;

  const [ghResult, provenanceResult, stagedPublishingResult] = await Promise.allSettled([
    // GitHub commitment profile (includes Scorecard internally)
    (async () => {
      if (!repoUrl) return null;
      const parsed = parseGitHubInput(repoUrl);
      if (!parsed) return null;
      return buildGitHubCommitmentProfile(parsed.owner, parsed.repo);
    })(),
    // SLSA provenance attestation check
    checkNpmProvenance(packageName, latestVersion),
    // Staged Publishing detection (dist-tags + GitHub workflow scan)
    checkStagedPublishing(pkg, repoUrl),
  ]);

  if (ghResult.status === "fulfilled" && ghResult.value) {
    githubScore = ghResult.value.commitmentScore;
    githubContributors = ghResult.value.contributorCount;
    scorecardScore = ghResult.value.scorecardScore;
    hasDangerousWorkflow = ghResult.value.hasDangerousWorkflow;
    // Map 0-100 GitHub score to 0-15 pts
    githubBacking = Math.round((githubScore / 100) * 15);
  }
  if (provenanceResult.status === "fulfilled") {
    hasProvenance = provenanceResult.value;
  }
  if (stagedPublishingResult.status === "fulfilled") {
    hasStagedPublishing = stagedPublishingResult.value;
  }

  // 4. Compute scores
  const longevity = scoreLongevity(ageYears);
  const downloadMomentum = scoreDownloads(avg7d, trend);
  const releaseConsistency = scoreReleases(versionCount, daysSinceLastPublish);
  const maintainerDepth = scoreMaintainers(maintainerCount, publisherLifecycle);
  const trustedPublishingScore = trustedPublishing ? 2 : 0;
  // Staged Publishing: +2 pts — human approval gate before version becomes default install target.
  // Mitigates sole-publisher concentration risk when CI pipeline is compromised (TanStack, Red Hat Jun 2026).
  const stagedPublishingScore = hasStagedPublishing === true ? 2 : 0;
  const commitmentScore = Math.min(
    100,
    longevity + downloadMomentum + releaseConsistency + maintainerDepth + githubBacking + trustedPublishingScore + stagedPublishingScore,
  );

  // 5. Build summary
  const ageStr =
    ageYears >= 1
      ? `${Math.floor(ageYears)} year${Math.floor(ageYears) !== 1 ? "s" : ""}`
      : `${Math.round(ageYears * 12)} months`;

  const trendStr = trend === null ? "" : ` (${trend})`;
  const dlStr =
    avg7d > 0
      ? `~${avg7d.toLocaleString()} downloads/day avg${trendStr}`
      : "download data unavailable";

  const recentStr =
    daysSinceLastPublish < 7
      ? "published this week"
      : daysSinceLastPublish < 30
      ? `published ${daysSinceLastPublish} days ago`
      : daysSinceLastPublish < 365
      ? `published ${Math.round(daysSinceLastPublish / 30)} months ago`
      : `published ${Math.round(daysSinceLastPublish / 365)} year(s) ago`;

  const provenanceStr =
    hasProvenance === true
      ? "✅ SLSA provenance verified (build pipeline integrity attestation present)"
      : hasProvenance === false
      ? "⚠️  No SLSA provenance (use `npm audit signatures` to verify build integrity)"
      : null; // null = check failed, don't surface

  const stagedPublishingStr =
    hasStagedPublishing === true
      ? "✅ Staged Publishing enabled (human 2FA approval required before release)"
      : hasStagedPublishing === false
      ? "⚠️  No Staged Publishing (versions go live from CI without human approval gate)"
      : null; // null = inconclusive, don't surface

  const scorecardStr =
    scorecardScore !== null
      ? `OpenSSF Scorecard: ${scorecardScore}/10`
      : null;

  const lines = [
    `Package: ${pkg.name}${latestVersion ? `@${latestVersion}` : ""}`,
    pkg.description ? `Description: ${pkg.description}` : null,
    `Age: ${ageStr}`,
    `Versions published: ${versionCount} | Last: ${recentStr}`,
    `Downloads: ${dlStr}`,
    `npm publishers: ${maintainerCount}${githubContributors !== null ? ` | GitHub contributors: ${githubContributors >= 30 ? "30+" : githubContributors}` : ""}`,
    `Trusted Publishing: ${trustedPublishing ? "yes (OIDC provenance)" : "no"}`,
    repoUrl ? `Repository: ${repoUrl}` : "No linked repository",
    pkg.license ? `License: ${pkg.license}` : "No license specified",
    githubScore !== null
      ? `GitHub commitment score: ${githubScore}/100`
      : null,
    scorecardStr,
    provenanceStr,
    stagedPublishingStr,
    ``,
    `Commitment Score: ${commitmentScore}/100`,
    `  Longevity:            ${longevity}/25 (${ageStr} old)`,
    `  Download momentum:    ${downloadMomentum}/25 (${dlStr})`,
    `  Release consistency:  ${releaseConsistency}/20 (${versionCount} versions)`,
    `  Publisher depth:      ${maintainerDepth}/15 (${maintainerCount} npm publisher${maintainerCount !== 1 ? "s" : ""}${publisherLifecycle && publisherLifecycle.dormantWithAccess > 0 ? ` — ${publisherLifecycle.dormantWithAccess} dormant with access` : ""})`,
    `  GitHub backing:       ${githubBacking}/15${githubScore !== null ? ` (GitHub score: ${githubScore}/100)` : " (no linked repo)"}`,
    `  Trusted Publishing:   ${trustedPublishingScore}/2 (${trustedPublishing ? "OIDC provenance detected" : "no provenance"})`,
    `  Staged Publishing:    ${stagedPublishingScore}/2 (${hasStagedPublishing === true ? "human approval gate detected" : hasStagedPublishing === false ? "not detected" : "inconclusive"})`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    name: pkg.name,
    description: pkg.description ?? null,
    latestVersion,
    license: pkg.license ?? null,
    keywords: pkg.keywords ?? [],
    ageYears,
    versionCount,
    maintainerCount,
    githubContributors,
    recentWeeklyDownloads: avg7d * 7,
    downloadTrend: trend,
    daysSinceLastPublish,
    repositoryUrl: repoUrl,
    publisherLifecycle,
    hasProvenance,
    scorecardScore,
    hasDangerousWorkflow,
    hasStagedPublishing,
    trustedPublishing,
    commitmentScore,
    scoreBreakdown: {
      longevity,
      downloadMomentum,
      releaseConsistency,
      maintainerDepth,
      githubBacking,
      trustedPublishing: trustedPublishingScore,
      stagedPublishing: stagedPublishingScore,
    },
    githubScore,
    summary: lines,
  };
}
