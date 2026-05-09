/**
 * Cargo (crates.io) Crate Commitment Profile
 *
 * Queries the public crates.io API (no auth required, User-Agent mandatory)
 * to compute a behavioral trust score for any Rust crate.
 *
 * Score dimensions:
 *   Longevity          (25 pts) — how long the crate has existed
 *   Download momentum  (25 pts) — recent downloads + trend consistency
 *   Release consistency (20 pts) — version count + publish cadence
 *   Publisher depth    (15 pts) — number of crate owners with publish access
 *   GitHub backing     (15 pts) — if linked repo, GitHub commitment score
 *
 * Uses public APIs only:
 *   https://crates.io/api/v1/crates/{name}
 *   https://crates.io/api/v1/crates/{name}/versions?per_page=1
 *   https://crates.io/api/v1/crates/{name}/owner_user
 *   https://crates.io/api/v1/crates/{name}/owner_team
 *
 * Rate limit: crates.io asks for max 1 req/sec. The scoring flow makes
 * 3-4 sequential requests per crate, so batch audits should limit concurrency.
 */

import {
  buildGitHubCommitmentProfile,
  parseGitHubInput,
} from "./github.ts";

const CRATES_API = "https://crates.io/api/v1/crates";
const USER_AGENT = "proof-of-commitment/1.3 (https://getcommit.dev)";

// ── API response types ──────────────────────────────────────────────

interface CrateResponse {
  crate: {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    downloads: number;
    recent_downloads: number | null; // last 90 days
    max_version: string;
    max_stable_version: string | null;
    repository: string | null;
    homepage: string | null;
    documentation: string | null;
    versions: number[]; // version IDs
    categories: string[];
    keywords: string[];
  };
}

interface CrateVersion {
  num: string;
  created_at: string;
  yanked: boolean;
  downloads: number;
  license: string | null;
}

interface CrateOwnerUser {
  id: number;
  login: string;
  kind: string;
  name: string | null;
}

// ── Public profile type ─────────────────────────────────────────────

export interface CargoCommitmentProfile {
  name: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;

  // Behavioral signals
  ageYears: number;
  versionCount: number;
  ownerCount: number; // individual users with publish access
  teamCount: number; // team owners
  recentDownloads90d: number;
  estimatedWeeklyDownloads: number;
  daysSinceLastPublish: number;
  repositoryUrl: string | null;

  // Scores
  commitmentScore: number;
  scoreBreakdown: {
    longevity: number;
    downloadMomentum: number;
    releaseConsistency: number;
    publisherDepth: number;
    githubBacking: number;
  };
  githubScore: number | null;

  summary: string;
}

// ── Scoring functions (same scale as npm/pypi) ──────────────────────

function scoreLongevity(ageYears: number): number {
  if (ageYears >= 6) return 25;
  if (ageYears >= 4) return 20;
  if (ageYears >= 2) return 14;
  if (ageYears >= 1) return 8;
  if (ageYears >= 0.5) return 4;
  return 1;
}

function scoreDownloads(weeklyEstimate: number): number {
  // Cargo download volumes are typically 2-5x lower than npm for equivalent popularity
  let base = 0;
  if (weeklyEstimate >= 1_000_000) base = 22;
  else if (weeklyEstimate >= 100_000) base = 18;
  else if (weeklyEstimate >= 10_000) base = 14;
  else if (weeklyEstimate >= 1_000) base = 10;
  else if (weeklyEstimate >= 100) base = 6;
  else if (weeklyEstimate >= 10) base = 3;
  else base = 0;
  // No trend data available from crates.io aggregate — keep neutral
  return Math.max(0, Math.min(25, base));
}

function scoreReleases(versionCount: number, daysSincePublish: number): number {
  let base = 0;
  if (versionCount >= 100) base = 15;
  else if (versionCount >= 30) base = 12;
  else if (versionCount >= 10) base = 9;
  else if (versionCount >= 3) base = 6;
  else if (versionCount >= 1) base = 3;

  const recency =
    daysSincePublish < 30 ? 5
    : daysSincePublish < 90 ? 3
    : daysSincePublish < 365 ? 1
    : 0;

  return Math.min(20, base + recency);
}

function scorePublishers(ownerCount: number): number {
  // ownerCount = individual users with publish access (analogous to npm publishers)
  if (ownerCount >= 5) return 15;
  if (ownerCount >= 3) return 11;
  if (ownerCount >= 2) return 7;
  if (ownerCount === 1) return 4;
  return 0;
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseRepoUrl(url: string | null): string | null {
  if (!url) return null;
  const normalized = url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  if (normalized.includes("github.com")) return normalized;
  return null;
}

async function fetchCratesIo<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${CRATES_API}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      // @ts-ignore CF fetch cache hint
      cf: { cacheEverything: true, cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Main function ───────────────────────────────────────────────────

export async function buildCargoCommitmentProfile(
  crateName: string
): Promise<CargoCommitmentProfile | null> {
  const encoded = encodeURIComponent(crateName.toLowerCase());

  // 1. Crate metadata
  const crateRes = await fetchCratesIo<CrateResponse>(`/${encoded}`);
  if (!crateRes) return null;

  const crate = crateRes.crate;
  const now = Date.now();

  // Age
  const createdMs = new Date(crate.created_at).getTime();
  const ageYears = (now - createdMs) / (365.25 * 24 * 3600 * 1000);

  // Version count (from the versions array of IDs)
  const versionCount = crate.versions.length;

  // Downloads — recent_downloads is last 90 days
  const recentDownloads90d = crate.recent_downloads ?? 0;
  const estimatedWeeklyDownloads = Math.round(recentDownloads90d / 13); // 90d ≈ 13 weeks

  // Repository URL
  const repositoryUrl = parseRepoUrl(crate.repository);

  // 2. Latest version info + owners (concurrent)
  const [versionsRes, ownersRes, teamsRes] = await Promise.all([
    fetchCratesIo<{ versions: CrateVersion[] }>(`/${encoded}/versions?per_page=1`),
    fetchCratesIo<{ users: CrateOwnerUser[] }>(`/${encoded}/owner_user`),
    fetchCratesIo<{ teams: CrateOwnerUser[] }>(`/${encoded}/owner_team`),
  ]);

  // Latest version
  let latestVersion = crate.max_stable_version ?? crate.max_version;
  let license: string | null = null;
  let daysSinceLastPublish = 9999;

  if (versionsRes?.versions?.[0]) {
    const latest = versionsRes.versions[0];
    latestVersion = latest.num;
    license = latest.license;
    const publishedMs = new Date(latest.created_at).getTime();
    daysSinceLastPublish = Math.round((now - publishedMs) / (24 * 3600 * 1000));
  }

  // Owner count
  const ownerCount = ownersRes?.users?.length ?? 1;
  const teamCount = teamsRes?.teams?.length ?? 0;

  // 3. GitHub backing (best-effort)
  let githubScore: number | null = null;
  let githubBacking = 0;
  let githubContributors: number | null = null;

  if (repositoryUrl) {
    try {
      const parsed = parseGitHubInput(repositoryUrl);
      if (parsed) {
        const ghProfile = await buildGitHubCommitmentProfile(parsed.owner, parsed.repo);
        if (ghProfile) {
          githubScore = ghProfile.commitmentScore;
          githubContributors = ghProfile.contributorCount;
          githubBacking = Math.round((githubScore / 100) * 15);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Compute scores
  const longevity = scoreLongevity(ageYears);
  const downloadMomentum = scoreDownloads(estimatedWeeklyDownloads);
  const releaseConsistency = scoreReleases(versionCount, daysSinceLastPublish);
  const publisherDepth = scorePublishers(ownerCount);
  const commitmentScore =
    longevity + downloadMomentum + releaseConsistency + publisherDepth + githubBacking;

  // 5. Risk flags
  const riskFlags: string[] = [];
  if (ownerCount <= 1 && estimatedWeeklyDownloads > 10_000_000)
    riskFlags.push("CRITICAL: sole owner + >10M/wk");
  else if (ownerCount <= 1 && estimatedWeeklyDownloads > 1_000_000)
    riskFlags.push("HIGH: sole owner + >1M/wk");
  if (ageYears < 1 && estimatedWeeklyDownloads > 100_000)
    riskFlags.push("HIGH: new crate (<1yr) + high downloads");
  if (daysSinceLastPublish > 365)
    riskFlags.push("WARN: no release in 12+ months");

  // 6. Build summary
  const ageStr =
    ageYears >= 1
      ? `${Math.floor(ageYears)} year${Math.floor(ageYears) !== 1 ? "s" : ""}`
      : `${Math.round(ageYears * 12)} months`;

  const dlStr =
    estimatedWeeklyDownloads > 0
      ? `~${estimatedWeeklyDownloads.toLocaleString()} downloads/week (est. from 90d)`
      : "download data unavailable";

  const recentStr =
    daysSinceLastPublish < 7 ? "published this week"
    : daysSinceLastPublish < 30 ? `published ${daysSinceLastPublish} days ago`
    : daysSinceLastPublish < 365 ? `published ${Math.round(daysSinceLastPublish / 30)} months ago`
    : `published ${Math.round(daysSinceLastPublish / 365)} year(s) ago`;

  const lines = [
    `Crate: ${crate.name}@${latestVersion}`,
    crate.description ? `Description: ${crate.description}` : null,
    `Age: ${ageStr}`,
    `Versions published: ${versionCount} | Last: ${recentStr}`,
    `Downloads: ${dlStr} | Total: ${crate.downloads.toLocaleString()}`,
    `Owners: ${ownerCount} user${ownerCount !== 1 ? "s" : ""}${teamCount > 0 ? ` + ${teamCount} team${teamCount !== 1 ? "s" : ""}` : ""}`,
    repositoryUrl ? `Repository: ${repositoryUrl}` : "No linked repository",
    license ? `License: ${license}` : "No license specified",
    githubScore !== null ? `GitHub commitment score: ${githubScore}/100` : null,
    riskFlags.length > 0 ? `Risk flags: ${riskFlags.join(", ")}` : null,
    ``,
    `Commitment Score: ${commitmentScore}/100`,
    `  Longevity:            ${longevity}/25 (${ageStr} old)`,
    `  Download momentum:    ${downloadMomentum}/25 (${dlStr})`,
    `  Release consistency:  ${releaseConsistency}/20 (${versionCount} versions)`,
    `  Publisher depth:      ${publisherDepth}/15 (${ownerCount} owner${ownerCount !== 1 ? "s" : ""})`,
    `  GitHub backing:       ${githubBacking}/15${githubScore !== null ? ` (GitHub score: ${githubScore}/100)` : " (no linked repo)"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    name: crate.name,
    description: crate.description,
    latestVersion,
    license,
    ageYears,
    versionCount,
    ownerCount,
    teamCount,
    recentDownloads90d,
    estimatedWeeklyDownloads,
    daysSinceLastPublish,
    repositoryUrl,
    commitmentScore,
    scoreBreakdown: {
      longevity,
      downloadMomentum,
      releaseConsistency,
      publisherDepth,
      githubBacking,
    },
    githubScore,
    summary: lines,
  };
}
