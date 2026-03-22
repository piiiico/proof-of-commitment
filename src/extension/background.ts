/**
 * Background service worker for Proof of Commitment extension.
 *
 * Responsibilities:
 * - Track active tab and time spent per domain
 * - Store visit data locally (chrome.storage.local)
 * - Manage World ID authentication state
 */

interface VisitRecord {
  domain: string;
  firstSeen: number;
  lastSeen: number;
  totalSeconds: number;
  visitCount: number;
}

// In-memory tracking of the current active tab
let activeTabDomain: string | null = null;
let activeTabStart: number = Date.now();

/**
 * Extract the domain from a URL
 */
function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Skip internal browser pages
    if (
      parsed.protocol === "chrome:" ||
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "about:"
    ) {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Record time spent on the previous domain and switch to a new one
 */
async function switchDomain(newDomain: string | null) {
  const now = Date.now();

  if (activeTabDomain) {
    const elapsed = Math.round((now - activeTabStart) / 1000);
    if (elapsed > 0) {
      await recordVisit(activeTabDomain, elapsed);
    }
  }

  activeTabDomain = newDomain;
  activeTabStart = now;
}

/**
 * Record a visit duration for a domain in local storage
 */
async function recordVisit(domain: string, seconds: number) {
  const key = `visit:${domain}`;
  const result = await chrome.storage.local.get(key);

  const existing: VisitRecord = result[key] || {
    domain,
    firstSeen: Date.now(),
    lastSeen: 0,
    totalSeconds: 0,
    visitCount: 0,
  };

  existing.lastSeen = Date.now();
  existing.totalSeconds += seconds;
  existing.visitCount += 1;

  await chrome.storage.local.set({ [key]: existing });
}

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const domain = tab.url ? extractDomain(tab.url) : null;
    await switchDomain(domain);
  } catch {
    await switchDomain(null);
  }
});

// Listen for URL changes in the active tab
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    const domain = extractDomain(changeInfo.url);
    await switchDomain(domain);
  }
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — stop tracking
    await switchDomain(null);
  } else {
    // Browser gained focus — start tracking active tab
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        windowId,
      });
      const domain = tab?.url ? extractDomain(tab.url) : null;
      await switchDomain(domain);
    } catch {
      await switchDomain(null);
    }
  }
});

console.log("[Proof of Commitment] Background service worker started");
