/**
 * Content script for Commit browser extension.
 *
 * Injects a minimal trust indicator on pages where commitment data exists.
 * The badge is non-intrusive — small floating pill in the bottom-right corner.
 *
 * Future: detect order confirmation pages for zkTLS proof generation.
 */

const BACKEND_URL = "https://poc-backend.amdal-dev.workers.dev";

interface DomainStats {
  domain: string;
  uniqueCommitments: number;
  totalVisits: number;
  totalSeconds: number;
  avgVisits: number;
  avgSeconds: number;
}

function extractDomain(): string {
  return window.location.hostname;
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
  // Don't inject if already present
  if (document.getElementById("commit-trust-badge")) return;

  const repeatRate = stats.totalVisits > stats.uniqueCommitments
    ? Math.round(((stats.totalVisits - stats.uniqueCommitments) / stats.totalVisits) * 100)
    : 0;

  const badge = document.createElement("div");
  badge.id = "commit-trust-badge";

  // Determine color
  let color = "#f87171"; // red
  let bg = "rgba(248, 113, 113, 0.1)";
  if (repeatRate >= 50 && stats.uniqueCommitments >= 5) {
    color = "#4ade80"; bg = "rgba(74, 222, 128, 0.1)";
  } else if (repeatRate >= 25 || stats.uniqueCommitments >= 3) {
    color = "#facc15"; bg = "rgba(250, 204, 21, 0.1)";
  }

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
      #commit-trust-badge:hover {
        opacity: 1;
        transform: scale(1.05);
      }
      #commit-trust-badge .commit-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${color};
      }
      #commit-trust-badge.commit-dismissed {
        opacity: 0;
        pointer-events: none;
        transform: translateY(10px);
      }
    </style>
    <span class="commit-dot"></span>
    <span>${stats.uniqueCommitments} verified visitor${stats.uniqueCommitments !== 1 ? "s" : ""}</span>
  `;

  // Click to dismiss
  badge.addEventListener("click", () => {
    badge.classList.add("commit-dismissed");
    setTimeout(() => badge.remove(), 300);
  });

  document.body.appendChild(badge);
}

// ── Init ────────────────────────────────────────────────────────────

async function init() {
  // Check if contributing is enabled
  const result = await chrome.storage.local.get("config:contributing");
  if (result["config:contributing"] === false) return;

  const domain = extractDomain();
  if (!domain) return;

  // Don't inject on internal pages
  if (["chrome:", "chrome-extension:", "about:"].some(p => window.location.protocol === p)) return;

  const stats = await fetchDomainStats(domain);
  if (stats && stats.uniqueCommitments > 0) {
    injectTrustBadge(stats);
  }
}

// Wait a bit for page to settle
setTimeout(init, 1500);
