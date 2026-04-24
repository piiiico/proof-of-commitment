/**
 * PyPI Package Commitment Profile
 *
 * Queries the public PyPI JSON API + PyPIStats download API (no auth required)
 * to compute a behavioral trust score for any Python package.
 *
 * Score dimensions:
 *   Longevity          (25 pts) — how long the package has existed
 *   Download momentum  (25 pts) — recent downloads + trend consistency
 *   Release consistency (20 pts) — version count + publish cadence
 *   Maintainer depth   (15 pts) — number of active owners/maintainers
 *   GitHub backing     (15 pts) — if linked repo, GitHub commitment score
 *
 * Uses public APIs only:
 *   https://pypi.org/pypi/{package}/json
 *   https://pypistats.org/api/packages/{package}/overall?mirrors=false
 */

import {
  buildGitHubCommitmentProfile,
  parseGitHubInput,
} from "./github.ts";

const PYPI_URL = "https://pypi.org/pypi";
const PYPISTATS_URL = "https://pypistats.org/api/packages";

interface PyPIInfo {
  name: string;
  version: string;
  summary?: string;
  description?: string;
  author?: string;
  author_email?: string;
  maintainer?: string;
  maintainer_email?: string;
  license?: string;
  license_expression?: string;
  classifiers?: string[];
  project_urls?: Record<string, string>;
  home_page?: string;
  requires_python?: string;
}

interface PyPIRelease {
  upload_time: string;
  yanked?: boolean;
}

interface PyPIResponse {
  info: PyPIInfo;
  releases: Record<string, PyPIRelease[]>;
  ownership?: {
    organization?: string | null;
    roles?: { role: string; user: string }[];
  };
}

interface PyPIStatsDay {
  category: string;
  date: string;
  downloads: number;
}

interface PyPIStatsResponse {
  data: PyPIStatsDay[];
  package: string;
  type: string;
}

export interface PyPICommitmentProfile {
  name: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;
  pythonRequires: string | null;

  // Behavioral signals
  ageYears: number;
  versionCount: number;
  maintainerCount: number;
  recentDailyDownloads: number;
  downloadTrend: "growing" | "stable" | "declining" | null;
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

function extractGitHubUrl(info: PyPIInfo): string | null {
  const candidates: (string | undefined)[] = [
    info.project_urls?.["Source"],
    info.project_urls?.["Source Code"],
    info.project_urls?.["Repository"],
    info.project_urls?.["GitHub"],
    info.project_urls?.["Homepage"],
    info.home_page,
  ];

  for (const url of candidates) {
    if (url && url.includes("github.com")) {
      // Normalize to https://github.com/owner/repo
      const normalized = url
        .replace(/^git\+/, "")
        .replace(/^git:\/\//, "https://")
        .replace(/^ssh:\/\/git@/, "https://")
        .replace(/^git@github\.com:/, "https://github.com/")
        .replace(/\.git$/, "")
        .replace(/\/tree\/.*$/, "") // strip branch references
        .replace(/\/blob\/.*$/, "")
        .split("#")[0]; // strip fragment
      if (normalized.includes("github.com")) return normalized;
    }
  }
  return null;
}

function getDevelopmentStatus(classifiers: string[]): string | null {
  for (const c of classifiers) {
    if (c.startsWith("Development Status ::")) {
      return c.replace("Development Status :: ", "");
    }
  }
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
  dailyAvg: number,
  trend: "growing" | "stable" | "declining" | null
): number {
  // PyPI volumes are typically 7-10x higher than npm daily
  let base = 0;
  if (dailyAvg >= 5_000_000) base = 22;
  else if (dailyAvg >= 500_000) base = 18;
  else if (dailyAvg >= 50_000) base = 14;
  else if (dailyAvg >= 5_000) base = 10;
  else if (dailyAvg >= 500) base = 6;
  else if (dailyAvg >= 50) base = 3;
  else base = 0;

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

function analyzeDownloads(data: PyPIStatsDay[]): {
  avg7d: number;
  avg90d: number;
  trend: "growing" | "stable" | "declining" | null;
} {
  // Filter to "without_mirrors" category only
  const withoutMirrors = data.filter((d) => d.category === "without_mirrors");
  if (withoutMirrors.length < 14) {
    return { avg7d: 0, avg90d: 0, trend: null };
  }

  // Sort by date ascending
  withoutMirrors.sort((a, b) => a.date.localeCompare(b.date));

  const recent7 = withoutMirrors.slice(-7);
  const avg7d = Math.round(
    recent7.reduce((s, d) => s + d.downloads, 0) / 7
  );

  const last90 = withoutMirrors.slice(-90);
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
 * Build a behavioral commitment profile for a PyPI package.
 */
export async function buildPyPICommitmentProfile(
  packageName: string
): Promise<PyPICommitmentProfile | null> {
  const encodedName = encodeURIComponent(packageName.toLowerCase());

  // 1. PyPI metadata
  const pypiRes = await fetch(`${PYPI_URL}/${encodedName}/json`, {
    headers: { Accept: "application/json" },
    // @ts-ignore CF fetch cache hint
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!pypiRes.ok) return null;
  const pkg = (await pypiRes.json()) as PyPIResponse;

  const { info, releases, ownership } = pkg;
  const now = Date.now();

  // Find earliest and latest release dates
  const releaseDates: number[] = [];
  let latestPublishMs = 0;
  let nonYankedVersionCount = 0;

  for (const [, files] of Object.entries(releases)) {
    const nonYanked = files.filter((f) => !f.yanked);
    if (nonYanked.length === 0) continue;
    nonYankedVersionCount++;
    const uploadMs = new Date(nonYanked[0].upload_time).getTime();
    if (!isNaN(uploadMs)) {
      releaseDates.push(uploadMs);
      if (uploadMs > latestPublishMs) latestPublishMs = uploadMs;
    }
  }

  const earliestMs =
    releaseDates.length > 0 ? Math.min(...releaseDates) : now;
  const ageYears = (now - earliestMs) / (365.25 * 24 * 3600 * 1000);
  const daysSinceLastPublish =
    latestPublishMs > 0
      ? Math.round((now - latestPublishMs) / (24 * 3600 * 1000))
      : 9999;

  const versionCount = nonYankedVersionCount;

  // Maintainer count: prefer ownership.roles, fall back to parsing author/maintainer fields
  let maintainerCount = 1;
  if (ownership?.roles && ownership.roles.length > 0) {
    // Count unique users (may have multiple roles)
    const uniqueUsers = new Set(ownership.roles.map((r) => r.user));
    maintainerCount = uniqueUsers.size;
  } else {
    // Rough heuristic: comma-separated emails suggest multiple maintainers
    const emailStr =
      info.maintainer_email ?? info.author_email ?? "";
    const emailCount = emailStr.split(",").filter((e) => e.trim()).length;
    if (emailCount > 1) maintainerCount = emailCount;
  }

  // Repository URL
  const repositoryUrl = extractGitHubUrl(info);

  // Development status
  const devStatus = getDevelopmentStatus(info.classifiers ?? []);

  // License
  const license =
    info.license_expression ?? info.license ?? null;

  // 2. Download stats
  let avg7d = 0;
  let trend: "growing" | "stable" | "declining" | null = null;
  let avg90d = 0;

  try {
    const statsRes = await fetch(
      `${PYPISTATS_URL}/${encodedName}/overall?mirrors=false`,
      {
        headers: { Accept: "application/json" },
        // @ts-ignore CF fetch cache hint
        cf: { cacheEverything: true, cacheTtl: 300 },
      }
    );
    if (statsRes.ok) {
      const stats = (await statsRes.json()) as PyPIStatsResponse;
      const analysis = analyzeDownloads(stats.data);
      avg7d = analysis.avg7d;
      avg90d = analysis.avg90d;
      trend = analysis.trend;
    }
  } catch {
    // Non-fatal
  }

  // 3. GitHub backing
  let githubScore: number | null = null;
  let githubBacking = 0;
  if (repositoryUrl) {
    try {
      const parsed = parseGitHubInput(repositoryUrl);
      if (parsed) {
        const ghProfile = await buildGitHubCommitmentProfile(
          parsed.owner,
          parsed.repo
        );
        if (ghProfile) {
          githubScore = ghProfile.commitmentScore;
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

  const lines = [
    `Package: ${info.name}@${info.version}`,
    info.summary ? `Description: ${info.summary}` : null,
    info.requires_python ? `Requires Python: ${info.requires_python}` : null,
    devStatus ? `Development Status: ${devStatus}` : null,
    `Age: ${ageStr}`,
    `Versions published: ${versionCount} | Last: ${recentStr}`,
    `Downloads: ${dlStr}`,
    `Maintainers: ${maintainerCount}`,
    repositoryUrl ? `Repository: ${repositoryUrl}` : "No linked GitHub repository",
    license ? `License: ${license}` : "No license specified",
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
    name: info.name,
    description: info.summary ?? null,
    latestVersion: info.version ?? null,
    license,
    pythonRequires: info.requires_python ?? null,
    ageYears,
    versionCount,
    maintainerCount,
    recentDailyDownloads: avg7d,
    downloadTrend: trend,
    daysSinceLastPublish,
    repositoryUrl,
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
