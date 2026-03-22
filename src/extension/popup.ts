/**
 * Popup script for Proof of Commitment extension.
 *
 * Shows:
 * - Authentication state (World ID)
 * - Top domains by time spent (your commitment profile)
 */

interface VisitRecord {
  domain: string;
  firstSeen: number;
  lastSeen: number;
  totalSeconds: number;
  visitCount: number;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

async function loadStats() {
  const all = await chrome.storage.local.get(null);
  const visits: VisitRecord[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith("visit:")) {
      visits.push(value as VisitRecord);
    }
  }

  // Sort by total time, descending
  visits.sort((a, b) => b.totalSeconds - a.totalSeconds);

  const statsList = document.getElementById("stats")!;
  const emptyDiv = document.getElementById("empty")!;

  if (visits.length === 0) {
    statsList.style.display = "none";
    emptyDiv.style.display = "block";
    return;
  }

  emptyDiv.style.display = "none";
  statsList.style.display = "block";

  // Show top 15
  const top = visits.slice(0, 15);
  statsList.innerHTML = top
    .map(
      (v) => `
    <li>
      <span class="domain">${v.domain}</span>
      <span class="time">${formatTime(v.totalSeconds)} · ${v.visitCount} visits</span>
    </li>
  `
    )
    .join("");
}

// Auth button (placeholder — World ID integration is next step)
document.getElementById("auth-btn")?.addEventListener("click", () => {
  // TODO: World ID OIDC flow
  console.log("World ID auth not yet implemented");
});

// Load stats on popup open
loadStats();
