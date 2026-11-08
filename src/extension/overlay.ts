/**
 * v0.4 overlay: «Fra nettverket ditt» — confirmed Anbefal endorsements from the user's OWN graph,
 * shown where the decision happens (Google results, then the shop page the user clicks into).
 *
 * Privacy: off until the user connects their own Anbefal link (opt-in). Only the result DOMAINS
 * visible on a Google results page are sent (to getcommit.dev/anbefal/api/sites, nothing stored
 * server-side). Shop pages send nothing: the badge reads a local cache filled from the results page.
 * A domain with no endorsement shows nothing — no fake signal.
 */

export interface Endorsement { name: string; field: string; item: string; brand: string; place: string; verdict: string; why: string; evidence: string; date: string }
export interface Site { endorsements: Endorsement[]; registered: string | null }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const VERDICT: Record<string, string> = { again: "ville kjøpt igjen", use: "bruker", avoid: "ville unngått" };

export function line(e: Endorsement): string {
  const who = [e.name, e.field || e.evidence].filter(Boolean).join(", ");
  const what = [e.item, e.brand].filter(Boolean).join(" ");
  return `${who}: ${what}${e.place ? ` hos ${e.place}` : ""} — ${VERDICT[e.verdict] || e.verdict}${e.why ? `. «${e.why}»` : ""} (${e.date})`;
}

function isGoogleSerp() {
  return /(^|\.)google\.[a-z.]+$/.test(location.hostname) && location.pathname === "/search";
}

function chip(site: Site): HTMLElement | null {
  const el = document.createElement("div");
  el.className = "commit-overlay";
  el.style.cssText = "font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:4px 0 8px;color:#5f6368";
  const rows = site.endorsements.slice(0, 3).map((e) =>
    `<div style="padding:4px 8px;border-left:3px solid ${e.verdict === "avoid" ? "#d93025" : "#188038"};background:#f8f9fa;margin-top:2px;color:#202124"><b>Fra nettverket ditt</b> · ${esc(line(e))}</div>`).join("");
  const time = site.registered ? `<span title="Registreringsdato i RDAP (domeneregisteret)">Domene registrert ${esc(site.registered)}</span>` : "";
  if (!rows && !time) return null;
  el.innerHTML = rows + (time ? `<div style="margin-top:2px">${time} · <a href="https://getcommit.dev/extension" style="color:#5f6368">Commit</a></div>` : "");
  return el;
}

async function serp() {
  // Google's result DOM could not be read from here (Google blocks automated reads), so fall back to any titled link.
  const pick = (sel: string) => [...document.querySelectorAll<HTMLAnchorElement>(sel)].filter((a) => a.querySelector("h3"));
  const links = pick("#search a[href^='http'], #rso a[href^='http']").length ? pick("#search a[href^='http'], #rso a[href^='http']") : pick("a[href^='http']");
  const byDomain = new Map<string, HTMLAnchorElement[]>();
  for (const a of links) {
    const d = host(a.href);
    if (!d || /(^|\.)google\./.test(d)) continue;
    byDomain.set(d, [...(byDomain.get(d) || []), a]);
  }
  if (!byDomain.size) return;
  const res = await chrome.runtime.sendMessage({ type: "commit-sites", domains: [...byDomain.keys()].slice(0, 20) }).catch(() => null);
  const sites: Record<string, Site> | undefined = res?.sites;
  if (!sites) return;
  for (const [d, anchors] of byDomain) {
    const s = sites[d];
    if (!s) continue;
    const a = anchors[0]!;
    if (a.parentElement?.querySelector(":scope > .commit-overlay")) continue;
    const c = chip(s);
    if (c) a.parentElement?.appendChild(c);
  }
}

async function shopBadge() {
  const d = location.hostname.toLowerCase().replace(/^www\./, "");
  const { "overlay:seen": seen } = await chrome.storage.local.get("overlay:seen");
  const s: Site | undefined = seen?.[d];
  if (!s?.endorsements?.length || document.getElementById("commit-anbefal-badge")) return;
  const b = document.createElement("div");
  b.id = "commit-anbefal-badge";
  b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:360px;padding:10px 12px;background:#fff;border:1px solid #dadce0;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.15);font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#202124;cursor:pointer";
  b.title = "Klikk for å lukke";
  b.innerHTML = `<b>Fra nettverket ditt</b>${s.endorsements.slice(0, 3).map((e) => `<div style="margin-top:4px">${esc(line(e))}</div>`).join("")}`;
  b.addEventListener("click", () => b.remove());
  document.body.appendChild(b);
}

// On the user's own Anbefal page: offer to connect (the opt-in). The code never leaves this browser
// except as the key for /api/sites.
async function connectBar() {
  const m = location.pathname.match(/^\/anbefal\/i\/([a-z0-9]{6,20})$/);
  if (!m) return;
  const code = m[1]!;
  const { "overlay:code": cur } = await chrome.storage.local.get("overlay:code");
  const bar = document.createElement("div");
  bar.id = "commit-connect-bar";
  bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#202124;color:#fff;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;gap:12px;align-items:center;justify-content:center";
  const render = (on: boolean) => {
    bar.innerHTML = on
      ? `Commit-utvidelsen viser anbefalingene fra nettverket ditt i Google-søk. <button id="commit-off">Slå av</button>`
      : `Vis anbefalingene fra nettverket ditt i Google-søk? Bare domenene i søkeresultatene sendes, ingen historikk. <button id="commit-on">Slå på</button> <a href="https://getcommit.dev/extension#personvern" style="color:#8ab4f8">Personvern</a>`;
    bar.querySelector("#commit-on")?.addEventListener("click", async () => { await chrome.storage.local.set({ "overlay:code": code }); render(true); });
    bar.querySelector("#commit-off")?.addEventListener("click", async () => { await chrome.storage.local.remove(["overlay:code", "overlay:seen"]); render(false); });
  };
  render(cur === code);
  document.body.appendChild(bar);
}

export async function initOverlay() {
  if (location.hostname === "getcommit.dev") return connectBar();
  const { "overlay:code": code } = await chrome.storage.local.get("overlay:code");
  if (!code) return;
  if (isGoogleSerp()) return serp();
  return shopBadge();
}
