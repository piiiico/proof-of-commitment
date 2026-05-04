/**
 * GitHub Repository Commitment Profile
 *
 * Queries the public GitHub API (no auth required) to compute a
 * behavioral trust score for any repo or GitHub user/org.
 *
 * Score dimensions:
 *   Longevity       (30 pts) — how long the project has existed
 *   Recent activity (25 pts) — commits in the last 30 days
 *   Community       (20 pts) — contributor count
 *   Release cadence (15 pts) — has versioned releases
 *   Social proof    (10 pts) — stars (skin-in-the-game proxy)
 *
 * 60 unauthenticated requests/hour from CF Workers egress IPs.
 * Uses If-None-Match + CF cache via fetch cache hints to stay within limits.
 */

const GH_API = "https://api.github.com";
const SCORECARD_API = "https://api.securityscorecards.dev";
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "proof-of-commitment-mcp/1.0",
  "X-GitHub-Api-Version": "2022-11-28",
};

interface RepoData {
  full_name: string;
  description: string | null;
  created_at: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { spdx_id: string } | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  owner: { login: string; type: "User" | "Organization" };
}

interface Commit {
  sha: string;
}

interface Contributor {
  login: string;
  contributions: number;
}

interface Release {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
}

export interface GitHubCommitmentProfile {
  fullName: string;
  description: string | null;
  owner: string;
  repo: string;
  language: string | null;
  license: string | null;
  topics: string[];
  isArchived: boolean;
  isFork: boolean;

  // Behavioral signals
  ageYears: number;
  stars: number;
  forks: number;
  recentCommits30d: number;
  contributorCount: number;
  latestRelease: string | null;
  releaseCount: number;
  daysSinceLastPush: number;

  // Build/process integrity (OpenSSF Scorecard)
  scorecardScore: number | null; // 0–10 overall Scorecard score (null = not available)
  hasDangerousWorkflow: boolean | null; // true = Dangerous-Workflow check failed (score 0)

  // Score
  commitmentScore: number;
  scoreBreakdown: {
    longevity: number;
    recentActivity: number;
    community: number;
    releaseCadence: number;
    socialProof: number;
  };

  summary: string;
}

async function ghFetch(path: string): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    headers: GH_HEADERS,
    // @ts-ignore CF Workers fetch cache hint
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
}

function scoreAge(years: number): number {
  if (years >= 5) return 30;
  if (years >= 3) return 22;
  if (years >= 1) return 14;
  if (years >= 0.5) return 7;
  return 2;
}

function scoreActivity(commits30d: number): number {
  if (commits30d >= 50) return 25;
  if (commits30d >= 20) return 20;
  if (commits30d >= 6) return 15;
  if (commits30d >= 1) return 8;
  return 0;
}

function scoreCommunity(contributors: number): number {
  if (contributors >= 20) return 20;
  if (contributors >= 6) return 15;
  if (contributors >= 2) return 10;
  return 5;
}

function scoreReleases(count: number): number {
  if (count >= 10) return 15;
  if (count >= 3) return 10;
  if (count >= 1) return 5;
  return 0;
}

function scoreStars(stars: number): number {
  if (stars >= 10_000) return 10;
  if (stars >= 1_000) return 8;
  if (stars >= 100) return 5;
  if (stars >= 10) return 2;
  return 0;
}

/**
 * Build a behavioral commitment profile for a GitHub repo.
 * @param owner  GitHub username or org
 * @param repo   Repository name
 */
export async function buildGitHubCommitmentProfile(
  owner: string,
  repo: string
): Promise<GitHubCommitmentProfile | null> {
  // 1. Repo metadata
  const repoRes = await ghFetch(`/repos/${owner}/${repo}`);
  if (!repoRes.ok) return null;
  const repoData = (await repoRes.json()) as RepoData;

  const now = Date.now();
  const createdAt = new Date(repoData.created_at).getTime();
  const pushedAt = new Date(repoData.pushed_at).getTime();
  const ageYears = (now - createdAt) / (365.25 * 24 * 3600 * 1000);
  const daysSinceLastPush = (now - pushedAt) / (24 * 3600 * 1000);

  // 2. Recent commits (last 30 days) — single page, count what we get
  const since = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
  let recentCommits30d = 0;
  try {
    const commitRes = await ghFetch(
      `/repos/${owner}/${repo}/commits?since=${since}&per_page=100`
    );
    if (commitRes.ok) {
      const commits = (await commitRes.json()) as Commit[];
      recentCommits30d = commits.length;
    }
  } catch {
    // Non-fatal
  }

  // 3. Contributor count (first page — 30 by default)
  let contributorCount = 1;
  try {
    const contribRes = await ghFetch(
      `/repos/${owner}/${repo}/contributors?per_page=30&anon=false`
    );
    if (contribRes.ok) {
      const contribs = (await contribRes.json()) as Contributor[];
      contributorCount = Math.max(contribs.length, 1);
      // If we got a full page, there are likely more — indicate 30+
      if (contribs.length === 30) contributorCount = 35;
    }
  } catch {
    // Non-fatal
  }

  // 4. Releases + Scorecard (concurrent)
  let releaseCount = 0;
  let latestRelease: string | null = null;
  let scorecardScore: number | null = null;
  let hasDangerousWorkflow: boolean | null = null;

  const [relResult, scorecardResult] = await Promise.allSettled([
    (async () => {
      // per_page=100 is GitHub's max — gives accurate stable-release count up to
      // 100 (which exceeds our scoring threshold of >=10). per_page=10 truncates
      // and under-reports both releaseCount and the displayed value when many of
      // the latest 10 releases are prereleases (e.g. tj/commander.js: 8 stable
      // surface vs 67 actual).
      const relRes = await ghFetch(
        `/repos/${owner}/${repo}/releases?per_page=100`
      );
      if (!relRes.ok) return { releaseCount: 0, latestRelease: null };
      const releases = (await relRes.json()) as Release[];
      const stable = releases.filter((r) => !r.prerelease);
      return { releaseCount: stable.length, latestRelease: stable[0]?.tag_name ?? null };
    })(),
    fetchScorecardScore(owner, repo),
  ]);

  if (relResult.status === "fulfilled" && relResult.value) {
    releaseCount = relResult.value.releaseCount;
    latestRelease = relResult.value.latestRelease;
  }
  if (scorecardResult.status === "fulfilled" && scorecardResult.value) {
    scorecardScore = scorecardResult.value.score;
    hasDangerousWorkflow = scorecardResult.value.hasDangerousWorkflow;
  }

  // 5. Score
  const longevity = scoreAge(ageYears);
  const recentActivity = scoreActivity(recentCommits30d);
  const community = scoreCommunity(contributorCount);
  const releaseCadence = scoreReleases(releaseCount);
  const socialProof = scoreStars(repoData.stargazers_count);
  const commitmentScore =
    longevity + recentActivity + community + releaseCadence + socialProof;

  // 6. Penalty: archived or no activity in 2+ years
  const adjustedScore =
    repoData.archived || daysSinceLastPush > 730
      ? Math.round(commitmentScore * 0.5)
      : commitmentScore;

  // 7. Summary
  const ageStr =
    ageYears >= 1
      ? `${Math.floor(ageYears)} year${Math.floor(ageYears) > 1 ? "s" : ""}`
      : `${Math.round(ageYears * 12)} months`;

  const activityStr =
    repoData.archived
      ? "ARCHIVED"
      : daysSinceLastPush > 365
      ? `inactive (last push ${Math.round(daysSinceLastPush / 30)} months ago)`
      : recentCommits30d > 0
      ? `${recentCommits30d} commits in the last 30 days`
      : `no commits in the last 30 days (last push ${Math.round(daysSinceLastPush)} days ago)`;

  const scorecardStr =
    scorecardScore !== null
      ? `OpenSSF Scorecard: ${scorecardScore}/10${hasDangerousWorkflow ? " ⚠️  Dangerous workflow detected" : ""}`
      : null;

  const lines = [
    `Repository: ${repoData.full_name}`,
    repoData.description ? `Description: ${repoData.description}` : null,
    `Age: ${ageStr}`,
    `Stars: ${repoData.stargazers_count.toLocaleString()} | Forks: ${repoData.forks_count}`,
    `Contributors: ${contributorCount === 35 ? "30+" : contributorCount}`,
    `Activity: ${activityStr}`,
    latestRelease ? `Latest release: ${latestRelease}` : "No stable releases",
    repoData.language ? `Primary language: ${repoData.language}` : null,
    repoData.license ? `License: ${repoData.license.spdx_id}` : "No license",
    repoData.archived ? "⚠️  Repository is archived (read-only)" : null,
    scorecardStr,
    ``,
    `Commitment Score: ${adjustedScore}/100`,
    `  Longevity:       ${longevity}/30`,
    `  Recent activity: ${recentActivity}/25`,
    `  Community:       ${community}/20`,
    `  Release cadence: ${releaseCadence}/15`,
    `  Social proof:    ${socialProof}/10`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    fullName: repoData.full_name,
    description: repoData.description,
    owner: repoData.owner.login,
    repo,
    language: repoData.language,
    license: repoData.license?.spdx_id ?? null,
    topics: repoData.topics,
    isArchived: repoData.archived,
    isFork: repoData.fork,
    ageYears,
    stars: repoData.stargazers_count,
    forks: repoData.forks_count,
    recentCommits30d,
    contributorCount,
    latestRelease,
    releaseCount,
    daysSinceLastPush: Math.round(daysSinceLastPush),
    scorecardScore,
    hasDangerousWorkflow,
    commitmentScore: adjustedScore,
    scoreBreakdown: {
      longevity,
      recentActivity,
      community,
      releaseCadence,
      socialProof,
    },
    summary: lines,
  };
}

/**
 * Fetch the OpenSSF Scorecard score for a GitHub repo.
 * Returns { score, hasDangerousWorkflow } or null on error / repo not found.
 * Best-effort — never throws.
 */
export async function fetchScorecardScore(
  owner: string,
  repo: string
): Promise<{ score: number; hasDangerousWorkflow: boolean } | null> {
  try {
    const res = await fetch(
      `${SCORECARD_API}/projects/github.com/${owner}/${repo}`,
      {
        headers: { "User-Agent": "proof-of-commitment-mcp/1.0" },
        // @ts-ignore CF Workers fetch cache hint
        cf: { cacheEverything: true, cacheTtl: 3600 },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      score: number;
      checks: { name: string; score: number }[];
    };
    const dangerousWorkflow = data.checks?.find(
      (c) => c.name === "Dangerous-Workflow"
    );
    return {
      score: data.score,
      hasDangerousWorkflow: dangerousWorkflow?.score === 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse "owner/repo" or full GitHub URL into {owner, repo}.
 * Returns null if repo part is missing.
 */
export function parseGitHubInput(input: string): {
  owner: string;
  repo: string;
} | null {
  const normalized = input
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0]!, repo: parts[1]! };
}
