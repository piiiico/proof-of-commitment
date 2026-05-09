/**
 * Go modules (golang) Commitment Profile
 *
 * Queries the public Go module proxy + deps.dev (both no auth, no key)
 * to compute a behavioral trust score for any Go module.
 *
 * Design constraint: Go modules have NO centralized download counts API
 * and NO publisher registry. Modules are published via VCS tags, not a
 * registry login. This makes the scoring GitHub-primary rather than
 * registry-primary — different from npm/PyPI/Cargo.
 *
 * Score dimensions (100pts total):
 *   Longevity            (25 pts) — earliest version date from proxy.golang.org
 *   Release consistency  (20 pts) — version count + cadence
 *   Maintainer depth     (15 pts) — GitHub contributor count (proxy for "publisher depth"
 *                                   since Go has no publisher concept — git push access
 *                                   is the equivalent of publish access)
 *   GitHub backing       (25 pts) — activity, contributors, OpenSSF Scorecard
 *                                   (elevated from 15 vs cargo because no download data)
 *   Popularity proxy     (15 pts) — GitHub stars (the only popularity signal available
 *                                   absent a centralized download counter)
 *
 * Data sources (all no-auth):
 *   proxy.golang.org/<module>/@latest        — latest version + Origin (VCS URL)
 *   proxy.golang.org/<module>/@v/list        — newline-separated version list
 *   proxy.golang.org/<module>/@v/<v>.info    — { Version, Time, Origin: { URL, ... } }
 *   api.deps.dev/v3/systems/go/packages/...  — version list with publishedAt timestamps
 *   api.deps.dev/v3/projects/...             — stars, scorecard.overallScore, license
 *   GitHub API (best-effort)                 — contributor count, activity
 *
 * Module path encoding (Go proxy):
 *   Uppercase letters in module paths are escaped as "!<lower>" to avoid
 *   ambiguity on case-insensitive filesystems. So github.com/Shopify/sarama
 *   becomes github.com/!shopify/sarama in proxy URLs.
 */

import {
  buildGitHubCommitmentProfile,
  parseGitHubInput,
  type GitHubCommitmentProfile,
} from "./github.ts";

const PROXY_BASE = "https://proxy.golang.org";
const DEPSDEV_BASE = "https://api.deps.dev/v3";
const USER_AGENT = "proof-of-commitment/1.6 (https://getcommit.dev)";

// ── API response types ──────────────────────────────────────────────

interface ProxyVersionInfo {
  Version: string;
  Time: string; // ISO-8601
  Origin?: {
    VCS?: string;
    URL?: string;
    Hash?: string;
    Ref?: string;
  };
}

interface DepsDevVersion {
  versionKey: { system: string; name: string; version: string };
  publishedAt: string;
  isDefault: boolean;
  isDeprecated: boolean;
}

interface DepsDevPackage {
  packageKey: { system: string; name: string };
  versions: DepsDevVersion[];
}

interface DepsDevScorecardCheck {
  name: string;
  score: number;
}

interface DepsDevScorecard {
  overallScore?: number; // 0–10
  checks?: DepsDevScorecardCheck[];
}

interface DepsDevProject {
  projectKey: { id: string };
  openIssuesCount?: number;
  starsCount?: number;
  forksCount?: number;
  license?: string;
  description?: string;
  scorecard?: { scorecard?: DepsDevScorecard } & DepsDevScorecard;
}

// ── Public profile type ─────────────────────────────────────────────

export interface GolangCommitmentProfile {
  modulePath: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;

  // Behavioral signals
  ageYears: number;
  versionCount: number;
  contributorCount: number | null; // GitHub push-access proxy for "publisher depth"
  starsCount: number; // popularity proxy (no real download data exists)
  daysSinceLastPublish: number;
  repositoryUrl: string | null;
  isGitHubHosted: boolean;
  scorecardScore: number | null; // 0–10 OpenSSF Scorecard

  // Scores
  commitmentScore: number;
  scoreBreakdown: {
    longevity: number;
    releaseConsistency: number;
    maintainerDepth: number;
    githubBacking: number;
    popularityProxy: number;
  };
  githubScore: number | null; // raw 0–100 GitHub commitment profile score

  summary: string;
}

// ── Scoring functions (same scale family as npm/pypi/cargo) ─────────

function scoreLongevity(ageYears: number): number {
  if (ageYears >= 6) return 25;
  if (ageYears >= 4) return 20;
  if (ageYears >= 2) return 14;
  if (ageYears >= 1) return 8;
  if (ageYears >= 0.5) return 4;
  return 1;
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

function scoreMaintainerDepth(contributorCount: number | null): number {
  // Maps to npm's "maintainer depth" / cargo's "publisher depth".
  // For Go, GitHub push-access contributors are the closest equivalent —
  // anyone with push access can tag a release, which is how publishing happens.
  if (contributorCount === null) return 0;
  if (contributorCount >= 30) return 15;
  if (contributorCount >= 10) return 12;
  if (contributorCount >= 5) return 8;
  if (contributorCount >= 2) return 4;
  if (contributorCount >= 1) return 2;
  return 0;
}

function scoreGithubBacking(githubScore: number | null): number {
  // GitHub backing scaled to 25 pts (vs 15 in cargo) because Go has no
  // download data. The GitHub commitment score (0–100) bundles activity,
  // contributors, releases, scorecard — exactly the signals we care about.
  if (githubScore === null) return 0;
  return Math.round((githubScore / 100) * 25);
}

function scorePopularityProxy(stars: number): number {
  // Stars-as-popularity: weak signal but the only popularity number we have.
  // (No "weekly downloads" exists for Go modules.)
  if (stars >= 20_000) return 15;
  if (stars >= 5_000) return 12;
  if (stars >= 1_000) return 9;
  if (stars >= 300) return 6;
  if (stars >= 50) return 3;
  if (stars > 0) return 1;
  return 0;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Encode a module path for proxy.golang.org.
 * Go proxy escapes uppercase letters as !<lower> to avoid case collisions
 * on case-insensitive filesystems.
 *
 * Example: github.com/Shopify/sarama → github.com/!shopify/sarama
 */
export function encodeModulePath(path: string): string {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

/**
 * Validate a Go module path. Must contain at least one dot in the first
 * path element (e.g., github.com, golang.org, gopkg.in, k8s.io).
 */
function isValidModulePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  const firstSegment = trimmed.split("/")[0];
  return firstSegment.includes(".");
}

/**
 * Normalize a VCS URL to a GitHub URL when possible.
 * The Go team mirrors official packages from go.googlesource.com to GitHub:
 *   go.googlesource.com/net      → github.com/golang/net
 *   go.googlesource.com/sys      → github.com/golang/sys
 */
function normalizeRepoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");

  // Go team mirror: go.googlesource.com/<repo> → github.com/golang/<repo>
  const ggMatch = cleaned.match(/^https?:\/\/go\.googlesource\.com\/(.+)$/);
  if (ggMatch) {
    return `https://github.com/golang/${ggMatch[1]}`;
  }

  // Already a GitHub URL — return as-is
  if (/^https?:\/\/github\.com\//.test(cleaned)) return cleaned;

  // Other VCS hosts (gitlab, bitbucket, custom): pass through but
  // GitHub-specific scoring won't apply.
  return cleaned;
}

async function fetchProxy<T>(
  path: string,
  parser: "json" | "text" = "json"
): Promise<T | null> {
  try {
    const res = await fetch(`${PROXY_BASE}${path}`, {
      headers: {
        Accept: parser === "json" ? "application/json" : "text/plain",
        "User-Agent": USER_AGENT,
      },
      // @ts-ignore CF Workers fetch cache hint
      cf: { cacheEverything: true, cacheTtl: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    if (parser === "text") return (await res.text()) as unknown as T;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve a Go module path to its source repository via the `go-source` /
 * `go-import` meta tag protocol — Go's canonical way of finding the VCS
 * for non-GitHub module paths (gopkg.in, k8s.io, etc).
 *
 * This is a fallback for when proxy.golang.org doesn't return an Origin URL
 * (e.g., gopkg.in modules). Only fetched when needed.
 */
async function resolveModuleSource(modulePath: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${modulePath}?go-get=1`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      // @ts-ignore CF Workers fetch cache hint
      cf: { cacheEverything: true, cacheTtl: 3600 },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try go-source first (richer — has actual repo URL)
    // <meta name="go-source" content="prefix _ home_url repo_url">
    const sourceMatch = html.match(
      /<meta\s+name=["']go-source["']\s+content=["']([^"']+)["']/i
    );
    if (sourceMatch) {
      const parts = sourceMatch[1].split(/\s+/);
      // Format: prefix homeURL dirTemplate fileTemplate
      // homeURL or dirTemplate often contains the repo URL
      for (const part of parts.slice(1)) {
        const ghMatch = part.match(/(https?:\/\/github\.com\/[^/\s{]+\/[^/\s{]+)/);
        if (ghMatch) return ghMatch[1].replace(/\/$/, "");
      }
    }

    // Fall back to go-import: "<prefix> <vcs> <repo_url>"
    const importMatch = html.match(
      /<meta\s+name=["']go-import["']\s+content=["']([^"']+)["']/i
    );
    if (importMatch) {
      const parts = importMatch[1].split(/\s+/);
      if (parts.length >= 3) {
        const repoUrl = parts[2];
        if (/^https?:\/\/github\.com\//.test(repoUrl)) {
          return repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchDepsDev<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DEPSDEV_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      // @ts-ignore CF Workers fetch cache hint
      cf: { cacheEverything: true, cacheTtl: 600 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch Go package data from deps.dev.
 * deps.dev gives us the full version list with publishedAt timestamps —
 * cheaper than calling proxy.golang.org/@v/<v>.info for each version.
 */
async function fetchDepsDevPackage(modulePath: string): Promise<DepsDevPackage | null> {
  const encoded = encodeURIComponent(modulePath);
  return fetchDepsDev<DepsDevPackage>(`/systems/go/packages/${encoded}`);
}

/**
 * Fetch GitHub project data from deps.dev (stars, scorecard, license).
 * Project ID is the path-with-host form: "github.com/owner/repo".
 */
async function fetchDepsDevProject(repoUrl: string): Promise<DepsDevProject | null> {
  const projectId = repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const encoded = encodeURIComponent(projectId);
  return fetchDepsDev<DepsDevProject>(`/projects/${encoded}`);
}

// ── Main function ───────────────────────────────────────────────────

export async function buildGolangCommitmentProfile(
  modulePath: string
): Promise<GolangCommitmentProfile | null> {
  const cleaned = modulePath.trim().replace(/\/$/, "");

  if (!isValidModulePath(cleaned)) return null;

  const encoded = encodeModulePath(cleaned);

  // 1. Verify module exists via proxy.golang.org/@latest. This is the
  //    authoritative existence check — deps.dev sometimes lags.
  const latest = await fetchProxy<ProxyVersionInfo>(`/${encoded}/@latest`);
  if (!latest) return null;

  // 2. Resolve source repository.
  //    First try proxy's Origin URL, then fall back to go-import meta tag
  //    resolution for non-GitHub paths like gopkg.in/yaml.v3.
  const repoUrlRaw = latest.Origin?.URL ?? null;
  let repositoryUrl = normalizeRepoUrl(repoUrlRaw);
  let isGitHubHosted = !!(repositoryUrl && /^https?:\/\/github\.com\//.test(repositoryUrl));

  if (!isGitHubHosted) {
    const resolved = await resolveModuleSource(cleaned);
    if (resolved && /^https?:\/\/github\.com\//.test(resolved)) {
      repositoryUrl = resolved;
      isGitHubHosted = true;
    }
  }

  // 3. Concurrent fetches: deps.dev package data, deps.dev project data, GitHub profile
  const [depsPackage, depsProject, githubProfile] = await Promise.all([
    fetchDepsDevPackage(cleaned),
    isGitHubHosted ? fetchDepsDevProject(repositoryUrl!) : Promise.resolve(null),
    isGitHubHosted
      ? (async () => {
          const parsed = parseGitHubInput(repositoryUrl!);
          if (!parsed) return null;
          return await buildGitHubCommitmentProfile(parsed.owner, parsed.repo);
        })()
      : Promise.resolve(null as GitHubCommitmentProfile | null),
  ]);

  // 4. Determine version count and earliest/latest publish dates.
  const versions = depsPackage?.versions ?? [];
  const versionCount = versions.length;

  const now = Date.now();
  let earliestMs: number | null = null;
  let latestMs: number | null = null;

  for (const v of versions) {
    const t = new Date(v.publishedAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (earliestMs === null || t < earliestMs) earliestMs = t;
    if (latestMs === null || t > latestMs) latestMs = t;
  }

  // Fallbacks if deps.dev didn't return data (rare but possible)
  if (latestMs === null) {
    const t = new Date(latest.Time).getTime();
    if (Number.isFinite(t)) latestMs = t;
  }
  if (earliestMs === null) earliestMs = latestMs;

  const ageYears = earliestMs !== null ? (now - earliestMs) / (365.25 * 24 * 3600 * 1000) : 0;
  const daysSinceLastPublish =
    latestMs !== null ? Math.round((now - latestMs) / (24 * 3600 * 1000)) : 9999;

  // 5. Pull stars / scorecard from deps.dev project data (more reliable than
  //    the single-call GitHub profile which may rate-limit).
  const starsCount = depsProject?.starsCount ?? githubProfile?.stars ?? 0;
  const scorecardScore =
    depsProject?.scorecard?.overallScore ?? githubProfile?.scorecardScore ?? null;
  const description = depsProject?.description ?? githubProfile?.description ?? null;
  const license = depsProject?.license ?? githubProfile?.license ?? null;

  // 6. Maintainer depth from GitHub contributors (when available).
  const contributorCount = githubProfile?.contributorCount ?? null;
  const githubScore = githubProfile?.commitmentScore ?? null;

  // 7. Compute scores
  const longevity = scoreLongevity(ageYears);
  const releaseConsistency = scoreReleases(versionCount, daysSinceLastPublish);
  const maintainerDepth = scoreMaintainerDepth(contributorCount);
  const githubBacking = scoreGithubBacking(githubScore);
  const popularityProxy = scorePopularityProxy(starsCount);
  const commitmentScore =
    longevity + releaseConsistency + maintainerDepth + githubBacking + popularityProxy;

  // 8. Risk flags
  const riskFlags: string[] = [];
  // No "publisher concentration" flag for Go — there's no centralized publisher account.
  // The closest is single-contributor + popular module:
  if (contributorCount !== null && contributorCount <= 1 && starsCount > 5_000) {
    riskFlags.push("HIGH: bus factor 1 + popular");
  }
  if (ageYears < 1 && starsCount > 1_000) {
    riskFlags.push("HIGH: new module (<1yr) + rapidly popular");
  }
  if (daysSinceLastPublish > 365) {
    riskFlags.push("WARN: no release in 12+ months");
  }
  if (scorecardScore !== null && scorecardScore < 3) {
    riskFlags.push("WARN: low OpenSSF Scorecard");
  }

  // 9. Build summary
  const ageStr =
    ageYears >= 1
      ? `${Math.floor(ageYears)} year${Math.floor(ageYears) !== 1 ? "s" : ""}`
      : `${Math.round(ageYears * 12)} months`;

  const recentStr =
    daysSinceLastPublish < 7 ? "released this week"
    : daysSinceLastPublish < 30 ? `released ${daysSinceLastPublish} days ago`
    : daysSinceLastPublish < 365 ? `released ${Math.round(daysSinceLastPublish / 30)} months ago`
    : `released ${Math.round(daysSinceLastPublish / 365)} year(s) ago`;

  const starsStr = starsCount >= 1000
    ? `${(starsCount / 1000).toFixed(1)}k stars`
    : `${starsCount} stars`;

  const lines = [
    `Module: ${cleaned}@${latest.Version}`,
    description ? `Description: ${description}` : null,
    `Age: ${ageStr}`,
    `Versions published: ${versionCount} | Last: ${recentStr}`,
    isGitHubHosted ? `Repository: ${repositoryUrl}` : repositoryUrl ? `Source: ${repositoryUrl} (non-GitHub)` : "No linked source",
    license ? `License: ${license}` : "License not specified",
    contributorCount !== null
      ? `GitHub contributors: ${contributorCount === 35 ? "30+" : contributorCount}`
      : null,
    `Popularity: ${starsStr} (Go has no centralized download data)`,
    scorecardScore !== null ? `OpenSSF Scorecard: ${scorecardScore.toFixed(1)}/10` : null,
    githubScore !== null ? `GitHub commitment score: ${githubScore}/100` : null,
    riskFlags.length > 0 ? `Risk flags: ${riskFlags.join(", ")}` : null,
    ``,
    `Commitment Score: ${commitmentScore}/100`,
    `  Longevity:           ${longevity}/25 (${ageStr})`,
    `  Release consistency: ${releaseConsistency}/20 (${versionCount} versions)`,
    `  Maintainer depth:    ${maintainerDepth}/15 (${contributorCount === null ? "no GitHub data" : contributorCount === 35 ? "30+ contributors" : `${contributorCount} contributor${contributorCount !== 1 ? "s" : ""}`})`,
    `  GitHub backing:      ${githubBacking}/25${githubScore !== null ? ` (GitHub: ${githubScore}/100)` : " (no GitHub repo)"}`,
    `  Popularity proxy:    ${popularityProxy}/15 (${starsStr})`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    modulePath: cleaned,
    description,
    latestVersion: latest.Version,
    license,
    ageYears,
    versionCount,
    contributorCount,
    starsCount,
    daysSinceLastPublish,
    repositoryUrl,
    isGitHubHosted,
    scorecardScore,
    commitmentScore,
    scoreBreakdown: {
      longevity,
      releaseConsistency,
      maintainerDepth,
      githubBacking,
      popularityProxy,
    },
    githubScore,
    summary: lines,
  };
}
