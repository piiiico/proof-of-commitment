/**
 * Content script for Commit browser extension.
 *
 * Two modes:
 * 1. GitHub mode: detects github.com/:owner/:repo pages and injects a
 *    trust panel in the sidebar showing the Commit Score + signals.
 * 2. Generic mode: shows a floating trust badge on sites with commitment data
 *    (visitor counts from poc-backend).
 */

const BACKEND_URL = "https://poc-backend.amdal-dev.workers.dev";

// ── GitHub trust panel ─────────────────────────────────────────────────────

interface GitHubTrustData {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  score: number;
  scoreBreakdown: {
    longevity: number;
    recentActivity: number;
    community: number;
    releaseCadence: number;
    socialProof: number;
  };
  signals: {
    ageYears: number;
    stars: number;
    forks: number;
    contributors: number;
    recentCommits30d: number;
    daysSinceLastPush: number;
    releaseCount: number;
    latestRelease: string | null;
  };
  endorsements: number;
  language: string | null;
  isArchived: boolean;
}

function extractGitHubRepo(): { owner: string; repo: string } | null {
  // Match github.com/:owner/:repo (any path under the repo)
  const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  const owner = match[1]!;
  const repo = match[2]!;
  // Skip non-repo paths
  if (["features", "pricing", "about", "orgs", "settings", "login", "join"].includes(owner)) {
    return null;
  }
  // Skip known top-level github pages
  if (repo.startsWith(".") || owner.startsWith(".")) return null;
  return { owner, repo };
}

async function fetchGitHubTrust(owner: string, repo: string): Promise<GitHubTrustData | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    if (!res.ok) return null;
    return await res.json() as GitHubTrustData;
  } catch {
    return null;
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return "#4ade80";
  if (score >= 45) return "#facc15";
  return "#f87171";
}

function formatAge(years: number): string {
  if (years < 0.1) return "< 1 month";
  if (years < 1) return `${Math.round(years * 12)} months`;
  const y = Math.floor(years);
  const m = Math.round((years - y) * 12);
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

function injectGitHubPanel(data: GitHubTrustData) {
  if (document.getElementById("commit-gh-panel")) return;

  const color = scoreColor(data.score);
  const circumference = 2 * Math.PI * 30;
  const filled = (data.score / 100) * circumference;

  // Find the sidebar on GitHub repo pages
  const sidebar = document.querySelector(".Layout-sidebar") ??
    document.querySelector('[data-target="repos-header.sidebar"]') ??
    document.querySelector(".repository-lang-stats-graph")?.parentElement ??
    null;

  const panel = document.createElement("div");
  panel.id = "commit-gh-panel";
  panel.style.cssText = `
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: #24292f;
  `;

  panel.innerHTML = `
    <style>
      #commit-gh-panel .commit-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      #commit-gh-panel .commit-brand {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: #656d76;
      }
      #commit-gh-panel .commit-score-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      #commit-gh-panel .commit-score-ring {
        position: relative;
        width: 56px;
        height: 56px;
        flex-shrink: 0;
      }
      #commit-gh-panel .commit-score-ring svg {
        transform: rotate(-90deg);
      }
      #commit-gh-panel .commit-score-number {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 700;
        color: #24292f;
      }
      #commit-gh-panel .commit-score-label {
        font-size: 11px;
        color: #656d76;
        line-height: 1.4;
      }
      #commit-gh-panel .commit-signals {
        border-top: 1px solid #d0d7de;
        padding-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 12px;
        margin-bottom: 12px;
      }
      #commit-gh-panel .commit-signal {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
      }
      #commit-gh-panel .commit-signal-key {
        color: #656d76;
      }
      #commit-gh-panel .commit-signal-val {
        font-weight: 600;
        color: #24292f;
        font-variant-numeric: tabular-nums;
      }
      #commit-gh-panel .commit-endorse-btn {
        display: block;
        width: 100%;
        padding: 6px 12px;
        background: #24292f;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        text-decoration: none;
        box-sizing: border-box;
      }
      #commit-gh-panel .commit-endorse-btn:hover {
        background: #444c56;
      }
      #commit-gh-panel .commit-footer {
        margin-top: 8px;
        font-size: 10px;
        color: #8c959f;
        text-align: center;
      }
      #commit-gh-panel .commit-footer a {
        color: #8c959f;
        text-decoration: none;
      }
      #commit-gh-panel .commit-footer a:hover { text-decoration: underline; }
    </style>

    <div class="commit-header">
      <span class="commit-brand">Commit Score</span>
    </div>

    <div class="commit-score-row">
      <div class="commit-score-ring">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="22" fill="none" stroke="#e5e7eb" stroke-width="5"/>
          <circle cx="28" cy="28" r="22" fill="none" stroke="${color}" stroke-width="5"
            stroke-linecap="round"
            stroke-dasharray="${(data.score / 100) * (2 * Math.PI * 22).toFixed(4)} ${(2 * Math.PI * 22).toFixed(4)}"
          />
        </svg>
        <span class="commit-score-number">${data.score}</span>
      </div>
      <div class="commit-score-label">
        <strong>${data.score >= 70 ? "Healthy" : data.score >= 45 ? "Moderate" : "Early stage"}</strong><br/>
        Behavioral trust score<br/>
        ${data.endorsements > 0 ? `${data.endorsements} endorsement${data.endorsements !== 1 ? "s" : ""}` : "No endorsements yet"}
      </div>
    </div>

    <div class="commit-signals">
      <div class="commit-signal">
        <span class="commit-signal-key">Age</span>
        <span class="commit-signal-val">${formatAge(data.signals.ageYears)}</span>
      </div>
      <div class="commit-signal">
        <span class="commit-signal-key">Contributors</span>
        <span class="commit-signal-val">${data.signals.contributors}</span>
      </div>
      <div class="commit-signal">
        <span class="commit-signal-key">Stars</span>
        <span class="commit-signal-val">${data.signals.stars.toLocaleString()}</span>
      </div>
      <div class="commit-signal">
        <span class="commit-signal-key">Commits (30d)</span>
        <span class="commit-signal-val">${data.signals.recentCommits30d}</span>
      </div>
    </div>

    <a class="commit-endorse-btn"
       href="https://getcommit.dev/extension"
       target="_blank"
       rel="noopener">
      Endorse this repo →
    </a>

    <div class="commit-footer">
      <a href="https://getcommit.dev" target="_blank" rel="noopener">getcommit.dev</a>
      · behavioral trust, not stars
    </div>
  `;

  // Insert panel: prepend to sidebar if found, otherwise insert after repo header
  if (sidebar) {
    sidebar.insertBefore(panel, sidebar.firstChild);
  } else {
    // Fallback: insert after the repo title area
    const repoHeader = document.querySelector("#repository-container-header") ??
      document.querySelector(".repohead") ??
      document.querySelector("main > div:first-child");
    if (repoHeader?.parentElement) {
      repoHeader.parentElement.insertBefore(panel, repoHeader.nextSibling);
    }
  }
}

// ── Generic domain trust badge ──────────────────────────────────────────────

interface DomainStats {
  domain: string;
  uniqueCommitments: number;
  totalVisits: number;
  totalSeconds: number;
  avgVisits: number;
  avgSeconds: number;
}

async function fetchDomainStats(domain: string): Promise<DomainStats | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/domain/${encodeURIComponent(domain)}`);
    if (!res.ok) return null;
    return await res.json() as DomainStats;
  } catch {
    return null;
  }
}

function injectTrustBadge(stats: DomainStats) {
  if (document.getElementById("commit-trust-badge")) return;

  const repeatRate = stats.totalVisits > stats.uniqueCommitments
    ? Math.round(((stats.totalVisits - stats.uniqueCommitments) / stats.totalVisits) * 100)
    : 0;

  let color = "#f87171";
  let bg = "rgba(248, 113, 113, 0.1)";
  if (repeatRate >= 50 && stats.uniqueCommitments >= 5) {
    color = "#4ade80"; bg = "rgba(74, 222, 128, 0.1)";
  } else if (repeatRate >= 25 || stats.uniqueCommitments >= 3) {
    color = "#facc15"; bg = "rgba(250, 204, 21, 0.1)";
  }

  const badge = document.createElement("div");
  badge.id = "commit-trust-badge";
  badge.innerHTML = `
    <style>
      #commit-trust-badge {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: ${bg};
        backdrop-filter: blur(12px);
        border: 1px solid ${color}33;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        color: ${color};
        cursor: pointer;
        transition: opacity 0.3s, transform 0.3s;
        opacity: 0.7;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      #commit-trust-badge:hover { opacity: 1; transform: scale(1.05); }
      #commit-trust-badge .commit-dot {
        width: 6px; height: 6px; border-radius: 50%; background: ${color};
      }
      #commit-trust-badge.commit-dismissed {
        opacity: 0; pointer-events: none; transform: translateY(10px);
      }
    </style>
    <span class="commit-dot"></span>
    <span>${stats.uniqueCommitments} verified visitor${stats.uniqueCommitments !== 1 ? "s" : ""}</span>
  `;

  badge.addEventListener("click", () => {
    badge.classList.add("commit-dismissed");
    setTimeout(() => badge.remove(), 300);
  });

  document.body.appendChild(badge);
}

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const result = await chrome.storage.local.get("config:contributing");
  const contributing = result["config:contributing"] !== false;

  const protocol = window.location.protocol;
  if (["chrome:", "chrome-extension:", "about:"].some(p => protocol === p)) return;

  const hostname = window.location.hostname;

  // GitHub mode: inject trust panel on repo pages
  if (hostname === "github.com") {
    const ghRepo = extractGitHubRepo();
    if (ghRepo) {
      const data = await fetchGitHubTrust(ghRepo.owner, ghRepo.repo);
      if (data) {
        injectGitHubPanel(data);
      }
    }
    return;
  }

  // Generic mode: show floating badge if domain has visit data
  if (!contributing) return;

  const stats = await fetchDomainStats(hostname);
  if (stats && stats.uniqueCommitments > 0) {
    injectTrustBadge(stats);
  }
}

// Wait for page to settle, then handle GitHub SPA navigation
setTimeout(init, 1500);

// Re-run on GitHub SPA navigation (pushState)
if (window.location.hostname === "github.com") {
  let lastPath = window.location.pathname;
  const observer = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      // Remove stale panel before re-injecting
      document.getElementById("commit-gh-panel")?.remove();
      setTimeout(init, 800);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
