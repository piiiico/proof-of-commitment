/**
 * Background service worker for Proof of Commitment extension.
 *
 * Responsibilities:
 * - Track active tab and time spent per domain
 * - Store visit data locally (chrome.storage.local)
 * - Manage World ID authentication state
 * - Sync visit deltas to aggregator backend (batched, offline-safe)
 */

interface VisitRecord {
  domain: string;
  firstSeen: number;
  lastSeen: number;
  totalSeconds: number;
  visitCount: number;
}

/** Commitment payload matching backend's POST /api/commit format. */
interface CommitPayload {
  domain: string;
  visitCount: number;
  totalSeconds: number;
  firstSeen: number;
  lastSeen: number;
}

// ── Config ────────────────────────────────────────────────────────────

const STORAGE_KEY_CONFIG = "config:backendUrl";
const STORAGE_KEY_QUEUE = "sync:queue";
const SYNC_ALARM_NAME = "poc-sync";
const SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_BACKEND_URL = "https://poc-backend.amdal-dev.workers.dev";

// In-memory tracking of the current active tab
let activeTabDomain: string | null = null;
let activeTabStart: number = Date.now();

// ── Domain helpers ────────────────────────────────────────────────────

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

// ── Visit tracking ────────────────────────────────────────────────────

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
 * Record a visit duration for a domain in local storage and sync queue.
 * Only stores domain-level data — no URLs, no paths, no queries.
 */
async function recordVisit(domain: string, seconds: number) {
  const key = `visit:${domain}`;
  const now = Date.now();
  const result = await chrome.storage.local.get([key, STORAGE_KEY_QUEUE]);

  // Update local visit record
  const existing: VisitRecord = (result[key] as VisitRecord | undefined) ?? {
    domain,
    firstSeen: now,
    lastSeen: 0,
    totalSeconds: 0,
    visitCount: 0,
  };

  existing.lastSeen = now;
  existing.totalSeconds += seconds;
  existing.visitCount += 1;

  // Append to sync queue (matches backend POST /api/commit format)
  const queue: CommitPayload[] = (result[STORAGE_KEY_QUEUE] as CommitPayload[] | undefined) ?? [];
  queue.push({
    domain,
    visitCount: 1,
    totalSeconds: seconds,
    firstSeen: now,
    lastSeen: now,
  });

  await chrome.storage.local.set({
    [key]: existing,
    [STORAGE_KEY_QUEUE]: queue,
  });
}

// ── Backend sync ──────────────────────────────────────────────────────

/**
 * Get the configured backend URL (defaults to prod).
 */
async function getBackendUrl(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY_CONFIG);
  return (result[STORAGE_KEY_CONFIG] as string | undefined) ?? DEFAULT_BACKEND_URL;
}

/**
 * Flush the sync queue to the backend.
 * If the backend is unavailable, the queue stays intact for the next attempt.
 */
async function flushSyncQueue(): Promise<void> {
  const backendUrl = await getBackendUrl();
  const result = await chrome.storage.local.get(STORAGE_KEY_QUEUE);
  const queue: CommitPayload[] = (result[STORAGE_KEY_QUEUE] as CommitPayload[] | undefined) ?? [];

  if (queue.length === 0) return;

  try {
    const res = await fetch(`${backendUrl}/api/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queue),
    });

    if (res.ok) {
      // Clear only the items we just sent (new ones may have arrived)
      const afterResult = await chrome.storage.local.get(STORAGE_KEY_QUEUE);
      const afterQueue: CommitPayload[] = (afterResult[STORAGE_KEY_QUEUE] as CommitPayload[] | undefined) ?? [];
      const remaining = afterQueue.slice(queue.length);
      await chrome.storage.local.set({ [STORAGE_KEY_QUEUE]: remaining });

      console.log(`[PoC] Synced ${queue.length} commitments to backend`);
    } else {
      console.warn(`[PoC] Backend sync failed: HTTP ${res.status} — will retry`);
    }
  } catch (err) {
    // Network error — backend offline, keep queue for next sync
    console.warn("[PoC] Backend unreachable — queued for next sync:", err);
  }
}

// ── Alarm-based periodic sync ─────────────────────────────────────────

async function setupSyncAlarm() {
  const existing = await chrome.alarms.get(SYNC_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(SYNC_ALARM_NAME, {
      periodInMinutes: SYNC_INTERVAL_MINUTES,
    });
    console.log(`[PoC] Sync alarm set: every ${SYNC_INTERVAL_MINUTES} minutes`);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    await flushSyncQueue();
  }
});

// ── Tab event listeners ────────────────────────────────────────────────

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

// ── Auth state awareness ────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["auth:credential"]) {
    const newValue = changes["auth:credential"].newValue as
      | { verificationLevel: string }
      | undefined;
    if (newValue) {
      console.log(
        "[Proof of Commitment] User authenticated:",
        newValue.verificationLevel
      );
      // Trigger an immediate sync when user authenticates
      flushSyncQueue().catch(console.warn);
    } else {
      console.log("[Proof of Commitment] User signed out");
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  await setupSyncAlarm();
  // Flush any pending queue from a previous session
  await flushSyncQueue();
}

init().catch(console.error);

console.log("[Proof of Commitment] Background service worker started");
