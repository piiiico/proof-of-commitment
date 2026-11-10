/**
 * Popup controller for Commit browser extension.
 *
 * Site-contextual: shows trust data for the current tab's domain,
 * your personal commitment to that domain, and aggregate network stats.
 */

import { bare, brregLine, cardRows, encodeCard, esc, friendLine, type Brreg, type Card } from "./shop";
import { signIn, signOut, getCredential, type AuthCredential } from "./auth";

const BACKEND_URL = "https://poc-backend.amdal-dev.workers.dev";

interface VisitRecord {
  domain: string;
  firstSeen: number;
  lastSeen: number;
  totalSeconds: number;
  visitCount: number;
}

interface DomainStats {
  domain: string;
  uniqueCommitments: number;
  totalVisits: number;
  totalSeconds: number;
  avgVisits: number;
  avgSeconds: number;
}

// ── DOM elements ────────────────────────────────────────────────────

const authOverlay = document.getElementById("auth-overlay")!;
const authBtn = document.getElementById("auth-btn")!;
const skipBtn = document.getElementById("skip-btn")!;
const authErrorEl = document.getElementById("auth-error")!;
const authPill = document.getElementById("auth-pill")!;
const authDot = document.getElementById("auth-dot")!;
const authLabel = document.getElementById("auth-label")!;

const siteDomainEl = document.getElementById("site-domain")!;
const scoreArc = document.getElementById("score-arc")! as unknown as SVGCircleElement;
const scoreValue = document.getElementById("score-value")!;
const trustSignals = document.getElementById("trust-signals")!;
const noData = document.getElementById("no-data")!;

const sigVisitors = document.getElementById("sig-visitors")!;
const sigRepeat = document.getElementById("sig-repeat")!;
const sigTime = document.getElementById("sig-time")!;

const myTime = document.getElementById("my-time")!;
const myVisits = document.getElementById("my-visits")!;
const mySince = document.getElementById("my-since")!;

const contributeToggle = document.getElementById("contribute-toggle")! as HTMLInputElement;
const footerStat = document.getElementById("footer-stat")!;

const brregSection = document.getElementById("brreg-section")!;
const brregDetails = document.getElementById("brreg-details")!;

// ── Helpers ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (["chrome:", "chrome-extension:", "about:", "edge:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

// ── Score ring ──────────────────────────────────────────────────────

function setScoreRing(score: number) {
  const circumference = 2 * Math.PI * 15; // r=15
  const filled = (score / 100) * circumference;
  scoreArc.setAttribute("stroke-dasharray", `${filled} ${circumference}`);
  scoreValue.textContent = String(score);

  // Color based on score
  let color = "#f87171"; // red
  if (score >= 70) color = "#4ade80"; // green
  else if (score >= 40) color = "#facc15"; // yellow
  scoreArc.setAttribute("stroke", color);
}

// ── Auth state ──────────────────────────────────────────────────────

function showAuthState(credential: AuthCredential | null) {
  if (credential) {
    authOverlay.classList.add("hidden");
    authPill.className = "auth-pill verified";
    authDot.className = "dot green";
    const level = credential.verificationLevel === "orb" ? "Orb verified" :
      credential.verificationLevel === "device" ? "Device verified" : "Verified";
    authLabel.textContent = level;
  } else {
    authPill.className = "auth-pill unverified";
    authDot.className = "dot gray";
    authLabel.textContent = "Not verified";
    // v0.5: no account wall on open — the org.nr line and «Mitt kort» need none. World ID only via the pill.
    authOverlay.classList.add("hidden");
  }
}

// ── Auth flow ───────────────────────────────────────────────────────

async function handleSignIn() {
  authBtn.textContent = "Verifying...";
  (authBtn as HTMLButtonElement).disabled = true;
  authErrorEl.style.display = "none";

  try {
    const credential = await signIn();
    showAuthState(credential);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("canceled") || msg.includes("cancelled") || msg.includes("user denied")) {
      // User cancelled — do nothing
    } else {
      authErrorEl.textContent = msg;
      authErrorEl.style.display = "block";
    }
  } finally {
    authBtn.textContent = "Verify with World ID";
    (authBtn as HTMLButtonElement).disabled = false;
  }
}

function handleSkip() {
  chrome.storage.local.set({ "auth:skipped": true });
  authOverlay.classList.add("hidden");
}

async function handleSignOut() {
  await signOut();
  await chrome.storage.local.remove("auth:skipped");
  showAuthState(null);
}

// ── Fetch site trust data ───────────────────────────────────────────

async function fetchSiteTrust(domain: string): Promise<DomainStats | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/domain/${encodeURIComponent(domain)}`);
    if (!res.ok) return null;
    return await res.json() as DomainStats;
  } catch {
    return null;
  }
}

function displaySiteTrust(stats: DomainStats | null) {
  if (!stats || stats.uniqueCommitments === 0) {
    trustSignals.style.display = "none";
    noData.style.display = "block";
    scoreValue.textContent = "--";
    scoreArc.setAttribute("stroke-dasharray", "0 94.2");
    return;
  }

  trustSignals.style.display = "grid";
  noData.style.display = "none";

  sigVisitors.textContent = formatNumber(stats.uniqueCommitments);

  const repeatRate = stats.totalVisits > stats.uniqueCommitments
    ? Math.round(((stats.totalVisits - stats.uniqueCommitments) / stats.totalVisits) * 100)
    : 0;
  sigRepeat.textContent = `${repeatRate}%`;

  const avgMin = stats.avgSeconds > 0 ? Math.round(stats.avgSeconds / 60) : 0;
  sigTime.textContent = avgMin > 0 ? `${avgMin}m` : "<1m";

  // Compute a simple trust score from the signals
  // More visitors + higher repeat rate + more time = higher trust
  let score = 0;
  // Visitor density (0-40 points)
  score += Math.min(stats.uniqueCommitments * 4, 40);
  // Repeat rate (0-35 points)
  score += Math.round(repeatRate * 0.35);
  // Engagement depth (0-25 points based on avg minutes)
  score += Math.min(avgMin * 2.5, 25);
  score = Math.min(Math.round(score), 100);

  setScoreRing(score);
}

// ── Display your commitment ─────────────────────────────────────────

async function displayYourCommitment(domain: string) {
  const key = `visit:${domain}`;
  const result = await chrome.storage.local.get(key);
  const visit = result[key] as VisitRecord | undefined;

  if (visit) {
    myTime.textContent = formatTime(visit.totalSeconds);
    myVisits.textContent = String(visit.visitCount);
    mySince.textContent = formatDate(visit.firstSeen);
  } else {
    myTime.textContent = "0s";
    myVisits.textContent = "0";
    mySince.textContent = "Now";
  }
}

// ── Footer stats ────────────────────────────────────────────────────

async function updateFooterStats() {
  const all = await chrome.storage.local.get(null);
  let siteCount = 0;
  for (const key of Object.keys(all)) {
    if (key.startsWith("visit:")) siteCount++;
  }
  footerStat.textContent = `${siteCount} site${siteCount !== 1 ? "s" : ""} tracked`;
}

// ── Contributing toggle ─────────────────────────────────────────────

async function initContributeToggle() {
  const result = await chrome.storage.local.get("config:contributing");
  const isContributing = result["config:contributing"] === true; // v0.4: default off
  contributeToggle.checked = isContributing;

  contributeToggle.addEventListener("change", () => {
    chrome.storage.local.set({ "config:contributing": contributeToggle.checked });
    // Notify background script
    chrome.runtime.sendMessage({ type: "contributing-changed", value: contributeToggle.checked });
  });
}

// ── v0.5: org.nr line (read from the page, never guessed) + «Mitt kort» ──

async function checkBrregData(domain: string) {
  const d = bare(domain);
  const { "shop:org": orgs = {} } = await chrome.storage.local.get("shop:org");
  const b: Brreg | null = orgs[d] ? await chrome.runtime.sendMessage({ type: "commit-brreg", orgnr: orgs[d] }).catch(() => null) : null;
  if (!b) { brregSection.style.display = "none"; return; }
  const l = brregLine(d, b);
  brregSection.style.display = "block";
  brregDetails.classList.add("visible");
  brregDetails.innerHTML = `${esc(l.text)}${l.red.map((r) => `<br/><b style="color:#f87171">${esc(r)}</b>`).join("")}<br/><span style="color:#8c959f">Org.nr ${esc(b.orgnr)} fra siden · Brønnøysundregistrene</span>`;
}

async function senderName(): Promise<string> {
  const info = await new Promise<{ email?: string }>((r) => chrome.identity?.getProfileUserInfo ? chrome.identity.getProfileUserInfo((i) => r(i)) : r({})).catch(() => ({}));
  const t = (info.email || "").split("@")[0]!.split(/[._+-]/)[0]!;
  return t ? t[0]!.toUpperCase() + t.slice(1) : "En venn";
}

async function renderCard() {
  const box = document.getElementById("card-section")!;
  const { "shop:log": log = {}, "card:hidden": hidden = [], "kort:imported": imported = [] } = await chrome.storage.local.get(["shop:log", "card:hidden", "kort:imported"]);
  const rows = cardRows(log).filter((r) => !hidden.includes(r.d));
  const fra = await senderName();
  const mine = rows.length
    ? rows.map((r) => `<div class="card-row"><span>${esc(friendLine("Du", r).replace(/^Du: /, r.d + ": "))}</span><button data-hide="${esc(r.d)}" title="Fjern fra kortet">✕</button></div>`).join("") +
      `<button id="card-copy" class="card-btn">Kopier lenke til kortet</button><div class="card-note">Sendes som «${esc(fra)}». Lenken inneholder bare radene over. Ingen server lagrer den.</div>`
    : `<div class="card-note">Tomt ennå. Kortet fylles lokalt med butikker (med org.nr) du kommer tilbake til over flere måneder, og ordrebekreftelser du når. Helse, apotek, spill, dating, bank og lån telles aldri.</div>`;
  const theirs = imported.length ? `<div class="card-sub">Kort fra venner</div>` + imported.map((c: Card, i: number) => `<div class="card-row"><span>${esc(c.fra)} · ${c.rader.length} ${c.rader.length === 1 ? "butikk" : "butikker"}</span><button data-drop="${i}" title="Fjern kortet">✕</button></div>`).join("") : "";
  box.innerHTML = `<div class="card-sub">Mitt kort</div>${mine}${theirs}`;
  box.querySelectorAll<HTMLButtonElement>("[data-hide]").forEach((btn) => btn.addEventListener("click", async () => {
    await chrome.storage.local.set({ "card:hidden": [...hidden, btn.dataset.hide] }); renderCard();
  }));
  box.querySelectorAll<HTMLButtonElement>("[data-drop]").forEach((btn) => btn.addEventListener("click", async () => {
    await chrome.storage.local.set({ "kort:imported": imported.filter((_: Card, i: number) => i !== Number(btn.dataset.drop)) }); renderCard();
  }));
  box.querySelector("#card-copy")?.addEventListener("click", async () => {
    const link = `https://getcommit.dev/extension#kort=${encodeCard({ v: 1, fra, laget: new Date().toISOString().slice(0, 10), rader: rows })}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    const b = box.querySelector<HTMLButtonElement>("#card-copy")!; b.textContent = "Kopiert. Lim inn i en melding til en venn."; b.dataset.link = link;
  });
}
renderCard();

// ── Auth pill click → sign out ──────────────────────────────────────

authPill.addEventListener("click", async () => {
  const credential = await getCredential();
  if (credential) {
    if (confirm("Sign out of Commit?")) {
      await handleSignOut();
    }
  } else {
    authOverlay.classList.remove("hidden");
  }
});

// ── Event listeners ─────────────────────────────────────────────────

authBtn.addEventListener("click", handleSignIn);
skipBtn.addEventListener("click", handleSkip);

// ── Init ────────────────────────────────────────────────────────────

async function init() {
  // 1. Check auth state
  const credential = await getCredential();
  showAuthState(credential);

  // 2. Get current tab's domain
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const domain = tab?.url ? extractDomain(tab.url) : null;

  if (domain) {
    siteDomainEl.textContent = domain;

    // 3. Fetch and display data in parallel
    const [siteStats] = await Promise.all([
      fetchSiteTrust(domain),
      displayYourCommitment(domain),
    ]);

    displaySiteTrust(siteStats);

    // 4. Check for Norwegian business data
    checkBrregData(domain);
  } else {
    siteDomainEl.textContent = "No site";
    trustSignals.style.display = "none";
    noData.style.display = "block";
    noData.textContent = "Navigate to a website to see trust data.";
    myTime.textContent = "--";
    myVisits.textContent = "--";
    mySince.textContent = "--";
  }

  // 5. Update footer + init toggle
  await Promise.all([
    updateFooterStats(),
    initContributeToggle(),
  ]);
}

init();
