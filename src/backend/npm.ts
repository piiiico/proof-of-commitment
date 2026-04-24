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
 *   Maintainer depth   (15 pts) — number of active maintainers
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

interface NpmPackage {
  name: string;
  description?: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, { repository?: { type: string; url: string } }>;
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
 * Bulk-fetch WEEKLY download totals for multiple npm packages in ONE API call.
 * Uses the point API (/downloads/point/last-week) which is simpler and more reliable
 * than the range API — avoids the concurrent-request race condition that causes zeros.
 *
 * Supports up to 128 packages per batch call.
 * Scoped packages (@scope/name) are NOT supported by the npm bulk API.
 *
 * Returns a Map from package name → weekly download count (null = not found/error).
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
        const res = await fetch(bulkUrl, { headers: { Accept: "application/json" } });
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

  return result;
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
  recentWeeklyDownloads: number;
  downloadTrend: "growing" | "stable" | "declining" | "unknown";
  daysSinceLastPublish: number;
  repositoryUrl: string | null;

  // Scores
  commitmentScore: number;
  scoreBreakdown: {
    longevity: number;
    downloadMomentum: number;
    releaseConsistency: number;
    maintainerDepth: number;
    githubBacking: number;
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
  trend: "growing" | "stable" | "declining" | "unknown"
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

function scoreMaintainers(count: number): number {
  if (count >= 5) return 15;
  if (count >= 3) return 11;
  if (count >= 2) return 7;
  if (count === 1) return 4;
  return 0;
}

/**
 * Compute weekly average downloads from daily data.
 * Returns { avg7d, avg90d, trend }.
 */
function analyzeDownloads(downloads: { day: string; downloads: number }[]): {
  avg7d: number;
  avg90d: number;
  trend: "growing" | "stable" | "declining" | "unknown";
} {
  if (downloads.length < 14) {
    return { avg7d: 0, avg90d: 0, trend: "unknown" };
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
  const modified = new Date(pkg.time["modified"] ?? "").getTime() || now;
  const ageYears = (now - created) / (365.25 * 24 * 3600 * 1000);
  const daysSinceLastPublish = Math.round((now - modified) / (24 * 3600 * 1000));

  // Version count (exclude "created" and "modified" metadata keys)
  const versions = Object.keys(pkg.time).filter(
    (k) => k !== "created" && k !== "modified" && k !== "unpublished"
  );
  const versionCount = versions.length;

  // Maintainers
  const maintainerCount = pkg.maintainers?.length ?? 1;

  // Repository URL
  const repoUrl = parseRepoUrl(
    pkg.repository?.url ??
      pkg.versions[pkg["dist-tags"]["latest"] ?? ""]?.repository?.url
  );

  // Latest version
  const latestVersion = pkg["dist-tags"]["latest"] ?? null;

  // 2. Downloads (last 6 months)
  const startDate = formatDate(180);
  const endDate = formatDate(1);
  let downloadData: { day: string; downloads: number }[] = [];
  let avg7d = 0;
  let avg90d = 0;
  let trend: "growing" | "stable" | "declining" | "unknown" = "unknown";

  if (preloadedWeekly !== undefined) {
    // Fast path: bulk weekly count was supplied by the caller (from bulkFetchNpmWeeklyDownloads).
    // This eliminates the per-package concurrent HTTP race condition that causes npm to return zeros.
    // Trade-off: trend data is unavailable in batch mode (stays "unknown") — acceptable.
    if (preloadedWeekly !== null && preloadedWeekly > 0) {
      avg7d = Math.round(preloadedWeekly / 7);
      // trend stays "unknown" — no day-by-day data in batch mode
    }
    // If preloadedWeekly === null, the bulk fetch had no data for this package.
    // Fall back to point API to ensure we never return 0 due to a bulk-fetch miss.
    if (avg7d === 0) {
      try {
        const pointUrl = `${NPM_DOWNLOADS_POINT}/last-week/${encodedName}`;
        const pointRes = await fetch(pointUrl, { headers: { Accept: "application/json" } });
        if (pointRes.ok) {
          const pointData = (await pointRes.json()) as { downloads: number };
          if (typeof pointData.downloads === "number" && pointData.downloads > 0) {
            avg7d = Math.round(pointData.downloads / 7);
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }
  } else {
    // Slow path: individual fetch (used for scoped packages or direct single-package calls).
    // Download data changes slowly — cache for 1 hour, but ONLY cache valid non-empty responses.
    try {
      const dlUrl = `${NPM_DOWNLOADS}/${startDate}:${endDate}/${encodedName}`;
      // Plain fetch options — no cf.cacheEverything so CF does NOT auto-cache responses.
      // We manage caching manually via caches.default to ensure only valid data is cached.
      const fetchOpts = { headers: { Accept: "application/json" } };

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
          const pointRes = await fetch(pointUrl, { headers: { Accept: "application/json" } });
          if (pointRes.ok) {
            const pointData = (await pointRes.json()) as { downloads: number };
            if (typeof pointData.downloads === "number" && pointData.downloads > 0) {
              avg7d = Math.round(pointData.downloads / 7);
              // Keep trend as unknown since we don't have historical data
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

  // 3. GitHub backing (optional, best-effort)
  let githubScore: number | null = null;
  let githubBacking = 0;
  if (repoUrl) {
    try {
      const parsed = parseGitHubInput(repoUrl);
      if (parsed) {
        const ghProfile = await buildGitHubCommitmentProfile(
          parsed.owner,
          parsed.repo
        );
        if (ghProfile) {
          githubScore = ghProfile.commitmentScore;
          // Map 0-100 GitHub score to 0-15 pts
          githubBacking = Math.round((githubScore / 100) * 15);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Compute scores
  const longevity = scoreLongevity(ageYears);
  const downloadMomentum = scoreDownloads(avg7d, trend);
  const releaseConsistency = scoreReleases(versionCount, daysSinceLastPublish);
  const maintainerDepth = scoreMaintainers(maintainerCount);
  const commitmentScore =
    longevity + downloadMomentum + releaseConsistency + maintainerDepth + githubBacking;

  // 5. Build summary
  const ageStr =
    ageYears >= 1
      ? `${Math.floor(ageYears)} year${Math.floor(ageYears) !== 1 ? "s" : ""}`
      : `${Math.round(ageYears * 12)} months`;

  const trendStr = trend === "unknown" ? "" : ` (${trend})`;
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

  const lines = [
    `Package: ${pkg.name}${latestVersion ? `@${latestVersion}` : ""}`,
    pkg.description ? `Description: ${pkg.description}` : null,
    `Age: ${ageStr}`,
    `Versions published: ${versionCount} | Last: ${recentStr}`,
    `Downloads: ${dlStr}`,
    `Maintainers: ${maintainerCount}`,
    repoUrl ? `Repository: ${repoUrl}` : "No linked repository",
    pkg.license ? `License: ${pkg.license}` : "No license specified",
    githubScore !== null
      ? `GitHub commitment score: ${githubScore}/100`
      : null,
    ``,
    `Commitment Score: ${commitmentScore}/100`,
    `  Longevity:            ${longevity}/25 (${ageStr} old)`,
    `  Download momentum:    ${downloadMomentum}/25 (${dlStr})`,
    `  Release consistency:  ${releaseConsistency}/20 (${versionCount} versions)`,
    `  Maintainer depth:     ${maintainerDepth}/15 (${maintainerCount} maintainer${maintainerCount !== 1 ? "s" : ""})`,
    `  GitHub backing:       ${githubBacking}/15${githubScore !== null ? ` (GitHub score: ${githubScore}/100)` : " (no linked repo)"}`,
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
    recentWeeklyDownloads: avg7d * 7,
    downloadTrend: trend,
    daysSinceLastPublish,
    repositoryUrl: repoUrl,
    commitmentScore,
    scoreBreakdown: {
      longevity,
      downloadMomentum,
      releaseConsistency,
      maintainerDepth,
      githubBacking,
    },
    githubScore,
    summary: lines,
  };
}
