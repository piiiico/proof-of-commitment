/**
 * Popup script for Proof of Commitment extension.
 *
 * Shows:
 * - Authentication state (World ID)
 * - Top domains by time spent (your commitment profile)
 */

import { signIn, signOut, getCredential, type AuthCredential } from "./auth";

interface VisitRecord {
  domain: string;
  firstSeen: number;
  lastSeen: number;
  totalSeconds: number;
  visitCount: number;
}

// ── DOM elements ────────────────────────────────────────────────────
const authPrompt = document.getElementById("auth-prompt")!;
const authStatus = document.getElementById("auth-status")!;
const authLoading = document.getElementById("auth-loading")!;
const authError = document.getElementById("auth-error")!;
const authBtn = document.getElementById("auth-btn")!;
const signoutBtn = document.getElementById("signout-btn")!;
const retryBtn = document.getElementById("retry-btn")!;
const verificationLevel = document.getElementById("verification-level")!;
const errorMessage = document.getElementById("error-message")!;

// ── Auth state views ────────────────────────────────────────────────

type AuthView = "prompt" | "authenticated" | "loading" | "error";

function showAuthView(view: AuthView) {
  authPrompt.style.display = view === "prompt" ? "block" : "none";
  authStatus.style.display = view === "authenticated" ? "block" : "none";
  authLoading.style.display = view === "loading" ? "block" : "none";
  authError.style.display = view === "error" ? "block" : "none";
}

function showAuthenticated(credential: AuthCredential) {
  const level = credential.verificationLevel;
  const label =
    level === "orb"
      ? "Orb-verified"
      : level === "device"
        ? "Device-verified"
        : "Verified";
  verificationLevel.textContent = label;
  showAuthView("authenticated");
}

function showError(message: string) {
  errorMessage.textContent = message;
  showAuthView("error");
}

// ── Auth flow ───────────────────────────────────────────────────────

async function handleSignIn() {
  showAuthView("loading");
  try {
    const credential = await signIn();
    showAuthenticated(credential);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Proof of Commitment] Auth error:", msg);

    // User cancellation is not an error — go back to prompt
    if (msg.includes("canceled") || msg.includes("cancelled") || msg.includes("user denied")) {
      showAuthView("prompt");
      return;
    }

    showError(msg);
  }
}

async function handleSignOut() {
  await signOut();
  showAuthView("prompt");
}

// ── Event listeners ─────────────────────────────────────────────────

authBtn.addEventListener("click", handleSignIn);
signoutBtn.addEventListener("click", handleSignOut);
retryBtn.addEventListener("click", handleSignIn);

// ── Stats ───────────────────────────────────────────────────────────

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

// ── Init ────────────────────────────────────────────────────────────

async function init() {
  // Check existing auth state
  const credential = await getCredential();
  if (credential) {
    showAuthenticated(credential);
  } else {
    showAuthView("prompt");
  }

  // Load visit stats
  await loadStats();
}

init();
