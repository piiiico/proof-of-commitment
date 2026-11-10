/** v0.5 DOM side of shop.ts: shop-page line, result-page lines, card import bar. */
import { bare, brregLine, decodeCard, esc, findOrgNrs, friendLine, isOrderPage, nameMatches, sensitive, type Brreg, type Card, type ShopLog } from "./shop";

const S = chrome.storage.local;
const FONT = "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const month = () => new Date().toISOString().slice(0, 7);

async function brreg(orgnr: string): Promise<Brreg | null> {
  return chrome.runtime.sendMessage({ type: "commit-brreg", orgnr }).catch(() => null);
}
async function friends(domain: string): Promise<string[]> {
  const { "kort:imported": cards = [] } = await S.get("kort:imported") as { "kort:imported"?: Card[] };
  const out: string[] = [];
  for (const c of cards) for (const r of c.rader) if (r.d === domain || domain.endsWith("." + r.d)) out.push(friendLine(c.fra, r));
  return out;
}
function html(domain: string, b: Brreg | null, fr: string[]): string {
  const rows: string[] = fr.map((f) => `<div style="color:#188038"><b>${esc(f)}</b></div>`);
  if (b) {
    const l = brregLine(domain, b);
    rows.push(`<div>${esc(l.text)}</div>`);
    for (const r of l.red) rows.push(`<div style="color:#d93025"><b>${esc(r)}</b></div>`);
  }
  return rows.join("");
}

// ── 1. shop page ────────────────────────────────────────────────────────
export async function shopPage() {
  const domain = bare(location.hostname);
  // innerText skips collapsed footers (jula.no keeps «Org. nr» in a closed accordion), so add footer textContent.
  const text = (document.body?.innerText || "").slice(-400_000) + " " + [...document.querySelectorAll("footer")].map((f) => f.textContent || "").join(" ").slice(-100_000);
  const found = findOrgNrs(text);
  const { "shop:org": orgs = {}, "shop:log": log = {} } = await S.get(["shop:org", "shop:log"]) as { "shop:org"?: Record<string, string>; "shop:log"?: Record<string, ShopLog> };
  let b: Brreg | null = null;
  if (found.length) {
    // Several numbers on one page (e.g. shop + payment provider): prefer the one whose name fits the domain.
    const all = (await Promise.all(found.slice(0, 3).map(brreg))).filter(Boolean) as Brreg[];
    b = all.find((x) => nameMatches(domain, x)) || all[0] || null;
    if (b) { orgs[domain] = b.orgnr; await S.set({ "shop:org": orgs }); }
  }
  // Card log: only pages that are shops (an org.nr seen on this domain), never sensitive ones. Local only.
  if (orgs[domain] && !sensitive(domain, b?.nace)) {
    const l: ShopLog = log[domain] || { months: [], orders: [] };
    if (!l.months.includes(month())) l.months.push(month());
    if (b) l.nace = b.nace;
    const head = [document.title, ...[...document.querySelectorAll("h1,h2")].slice(0, 6).map((h) => (h as HTMLElement).innerText)].join(" | ");
    const key = new Date().toISOString().slice(0, 10) + location.pathname;
    if (isOrderPage(location.pathname, head) && !l.orders.some((o) => o.slice(10) === location.pathname && o.slice(0, 10) === key.slice(0, 10))) l.orders.push(key);
    log[domain] = l;
    await S.set({ "shop:log": log });
  }
  const fr = sensitive(domain, b?.nace) ? [] : await friends(domain);
  if (!b && !fr.length) return; // nothing found → nothing shown
  if (document.getElementById("commit-shop-line")) return;
  const el = document.createElement("div");
  el.id = "commit-shop-line";
  el.title = "Commit · Brønnøysundregistrene · klikk for å lukke";
  el.style.cssText = `position:fixed;bottom:16px;left:16px;z-index:2147483647;max-width:440px;padding:8px 12px;background:#fff;border:1px solid #dadce0;border-left:3px solid ${b && brregLine(domain, b).red.length ? "#d93025" : "#5f6368"};border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.15);${FONT};color:#202124;cursor:pointer`;
  el.innerHTML = html(domain, b, fr) + `<div style="font-size:11px;color:#80868b;margin-top:2px">${b ? `Org.nr ${esc(b.orgnr)} fra siden · Brønnøysundregistrene · ` : ""}Commit (laget av Pico, en AI-agent)</div>`;
  el.addEventListener("click", () => el.remove());
  document.body.appendChild(el);
}

// ── 2. result pages: Google, Bing, DuckDuckGo ───────────────────────────
export function isSerp(): boolean {
  const h = location.hostname;
  return (/(^|\.)google\.[a-z.]+$/.test(h) && location.pathname === "/search") || (/(^|\.)bing\.com$/.test(h) && location.pathname === "/search") || /(^|\.)duckduckgo\.com$/.test(h);
}
/** Result target, unwrapping Bing (/ck/a?u=a1<base64>) and DuckDuckGo (/l/?uddg=) redirects. */
export function resultDomain(href: string): string {
  try {
    const u = new URL(href);
    let t = u.searchParams.get("uddg") || "";
    const bu = u.searchParams.get("u");
    if (!t && bu?.startsWith("a1")) t = atob(bu.slice(2).replace(/-/g, "+").replace(/_/g, "/"));
    return bare(new URL(t || href).hostname);
  } catch { return ""; }
}
export async function serpLines() {
  const { "shop:org": orgs = {} } = await S.get("shop:org") as { "shop:org"?: Record<string, string> };
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href^='http']")].filter((a) => a.querySelector("h2,h3") || a.closest("h2,h3"));
  const done = new Set<string>();
  for (const a of anchors) {
    const d = resultDomain(a.href);
    if (!d || done.has(d) || /(^|\.)(google|bing|duckduckgo|microsoft)\./.test(d)) continue;
    done.add(d);
    const fr = sensitive(d) ? [] : await friends(d);
    const b = orgs[d] ? await brreg(orgs[d]) : null; // only org.nrs read on an earlier visit; never guessed
    if (!b && !fr.length) continue;
    const host = (a.closest("h2,h3")?.parentElement || a.parentElement)!;
    if (host.querySelector(":scope > [data-commit-serp]")) continue;
    const el = document.createElement("div");
    el.dataset.commitSerp = d; // a data attribute, not a class: Bing strips unknown-class nodes from result items
    el.style.cssText = `${FONT};font-size:12px;margin:2px 0 6px;padding:3px 8px;border-left:3px solid #dadce0;background:#f8f9fa;color:#3c4043`;
    el.innerHTML = html(d, b, fr);
    host.appendChild(el);
  }
}

// ── 3. card import on getcommit.dev/extension#kort=… ────────────────────
export async function importBar() {
  const m = location.hash.match(/kort=([A-Za-z0-9_-]+)/);
  if (!m) return;
  const card = decodeCard(m[1]!);
  if (!card || document.getElementById("commit-import-bar")) return;
  const bar = document.createElement("div");
  bar.id = "commit-import-bar";
  bar.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:12px 16px;background:#202124;color:#fff;${FONT};font-size:14px;text-align:center`;
  const list = card.rader.slice(0, 6).map((r) => esc(r.d)).join(", ") + (card.rader.length > 6 ? ` og ${card.rader.length - 6} til` : "");
  bar.innerHTML = `Kortet til <b>${esc(card.fra)}</b>: ${card.rader.length} ${card.rader.length === 1 ? "butikk" : "butikker"} (${list}). <button id="commit-import">Importer</button>`;
  bar.querySelector("#commit-import")!.addEventListener("click", async () => {
    const { "kort:imported": cards = [] } = await S.get("kort:imported") as { "kort:imported"?: Card[] };
    const next = [...cards.filter((c) => !(c.fra === card.fra && c.laget === card.laget)), card];
    await S.set({ "kort:imported": next });
    bar.innerHTML = `Importert. Du ser nå <b>${esc(card.fra)}</b> på disse butikkene og under søketreffene deres. Fjern kortet i Commit-menyen.`;
  });
  document.body.appendChild(bar);
}
