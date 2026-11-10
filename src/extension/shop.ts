/**
 * v0.5 «ingen skriver noe». Two layers, both zero typing, nothing stored on a Commit server.
 *
 * 1. Single-player: on a page that prints its own org.nr (footer «Org.nr: 882 692 302»), the background
 *    worker asks data.brreg.no (open, no key) and the page gets one quiet line: name, years in operation,
 *    employees, latest revenue. Red only on hard facts. No org.nr on the page = nothing shown; we never
 *    guess an org.nr from a name. On Google results, the same line for domains cached from an earlier visit.
 * 2. «Mitt kort»: from install on, this browser counts (locally) shops with an org.nr that you came back to
 *    across months and order-confirmation pages you reached. You review the list in the popup, delete rows,
 *    and send it as a link. A friend opens the link and imports it with one click; their extension then
 *    shows «Håkon: handlet her 3× (2025–26)» on that shop and under its Google results.
 * Sensitive categories are never counted (domain denylist + NACE codes).
 */

export interface Brreg {
  orgnr: string; navn: string; start: string | null; ansatte: number | null; nace: string | null;
  konkurs: boolean; avvikling: boolean; tvang: boolean; slettet: boolean;
  omsetning: number | null; aar: string | null; hjemmeside: string | null;
}
export interface CardRow { d: string; n: number; m: number; y0: number; y1: number }
export interface Card { v: 1; fra: string; laget: string; rader: CardRow[] }

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

// ── org.nr on the page ──────────────────────────────────────────────────
export function mod11(n: string): boolean {
  if (!/^[89]\d{8}$/.test(n)) return false;
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  const s = w.reduce((a, x, i) => a + x * Number(n[i]), 0);
  const k = 11 - (s % 11);
  return (k === 11 ? 0 : k) === Number(n[8]) && k !== 10;
}
const ORG_RE = /(?:org(?:anisasjons)?\.?\s*-?\s*(?:nr|nummer|no)\.?|foretaksregisteret|\bNO)\s*[:.]?\s*(?:NO\s*)?(\d{3}[\s.\u00a0]?\d{3}[\s.\u00a0]?\d{3})(?!\d)/gi;
/** Every distinct valid org.nr printed next to an org.nr label. Never a guess. */
export function findOrgNrs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(ORG_RE)) {
    const n = m[1]!.replace(/\D/g, "");
    if (mod11(n)) out.add(n);
  }
  return [...out];
}

// ── sensitive categories: never counted, never shown ────────────────────
const SENSITIVE_DOMAIN = /(apotek|pharma|farmasi|vitusapotek|boots|helse|klinikk|legesenter|tannlege|psykolog|casino|poker|bet(t|ting)?\b|bet\.|odds|spill|tipping|lotto|dating|tinder|match\.|happn|porn|xxx|sex|onlyfans|escort|kirke|church|moske|parti\b|partiet|bank|kreditt|credit|lan\.|forbruksl|refinans|forsikring)/i;
const SENSITIVE_NACE = /^(64|65|66|86|87|88|92|94)\.|^47\.7[34]/;
export const sensitive = (domain: string, nace?: string | null) => SENSITIVE_DOMAIN.test(domain) || (!!nace && SENSITIVE_NACE.test(nace));

// ── order confirmation ──────────────────────────────────────────────────
const ORDER_PATH = /(checkout\/(success|complete|confirmation|thank)|order[-_/]?(confirmation|received|complete|success)|ordrebekreftelse|kvittering|bestilling\/(takk|fullfort|bekreftelse)|\/takk(-for-(din-)?(bestilling|handelen|ordren|kjopet))?(\/|$|\?)|\/thank-?you(\/|$|\?))/i;
const ORDER_TEXT = /(takk for (din |di )?(bestilling|ordre|handelen|kjøpet)|ordrebekreftelse|din ordre er (mottatt|bekreftet|registrert)|bestillingen (din )?er mottatt|thank you for your (order|purchase)|order (confirmed|received))/i;
export function isOrderPage(path: string, headline: string): boolean {
  return ORDER_PATH.test(path) || ORDER_TEXT.test(headline);
}

// ── the line ────────────────────────────────────────────────────────────
function kr(x: number): string {
  if (x >= 1e9) return `${(x / 1e9).toFixed(1).replace(".", ",")} mrd kr`;
  if (x >= 1e6) return `${Math.round(x / 1e6).toLocaleString("nb-NO")} mill. kr`;
  return `${Math.round(x).toLocaleString("nb-NO")} kr`;
}
const norm = (s: string) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").replace(/[^a-z0-9 ]/g, " ");
const STOP = new Set(["as", "asa", "ab", "aps", "norge", "norway", "norden", "nordic", "scandinavia", "group", "holding", "drift", "handel", "og", "the", "ltd", "gmbh", "sa", "nuf", "da", "ans", "ba", "sa"]);
/** Fuzzy: does the registered name (or its registered homepage) look like this domain? */
export function nameMatches(domain: string, b: Pick<Brreg, "navn" | "hjemmeside">): boolean {
  const d = bare(domain);
  if (b.hjemmeside && bare(b.hjemmeside.replace(/^https?:\/\//, "")).split("/")[0] === d) return true;
  const label = norm(d.split(".").slice(0, -1).join(" ")).replace(/\s+/g, "");
  const toks = norm(b.navn).split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
  if (toks.some((t) => label.includes(t))) return true;
  const joined = toks.join("");
  return joined.length >= 3 && (joined.includes(label) || label.includes(joined));
}

export interface Line { text: string; red: string[] }
export function brregLine(domain: string, b: Brreg, now = new Date()): Line {
  const red: string[] = [];
  if (b.konkurs) red.push("konkurs");
  if (b.avvikling || b.tvang) red.push(b.tvang ? "under tvangsavvikling" : "under avvikling");
  if (b.slettet) red.push("slettet i Enhetsregisteret");
  const ageMonths = b.start ? (now.getTime() - new Date(b.start).getTime()) / (30.44 * 864e5) : null;
  if (ageMonths !== null && ageMonths < 12 && b.omsetning === null) red.push(`registrert ${b.start}, ingen regnskap ennå`);
  if (!nameMatches(domain, b)) red.push(`org.nr på siden tilhører ${b.navn}, som ikke ligner ${bare(domain)} (grov navnesjekk)`);
  const parts = [titleCase(b.navn)];
  if (b.start) parts.push(`i drift siden ${b.start.slice(0, 4)}`);
  if (b.ansatte) parts.push(`${b.ansatte.toLocaleString("nb-NO")} ansatte`);
  if (b.omsetning !== null && b.aar) parts.push(`omsetning ${b.aar}: ${kr(b.omsetning)}`);
  return { text: parts.join(" · "), red };
}
function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase()).replace(/\b(As|Asa|Ab|Nuf)\b/g, (x) => x.toUpperCase());
}

export function friendLine(fra: string, r: CardRow): string {
  const yrs = r.y0 === r.y1 ? `${r.y0}` : `${r.y0}–${String(r.y1).slice(2)}`;
  return r.n > 0 ? `${fra}: handlet her ${r.n}× (${yrs})` : `${fra}: kom tilbake hit ${r.m} måneder (${yrs})`;
}

// ── card encoding (link = getcommit.dev/extension#kort=…) ───────────────
export function encodeCard(c: Card): string {
  const bytes = new TextEncoder().encode(JSON.stringify(c));
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeCard(s: string): Card | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (c?.v !== 1 || !Array.isArray(c.rader)) return null;
    const rader = c.rader.filter((r: any) => typeof r?.d === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(r.d) && !sensitive(r.d))
      .map((r: any) => ({ d: r.d, n: Math.max(0, r.n | 0), m: Math.max(0, r.m | 0), y0: r.y0 | 0, y1: r.y1 | 0 })).slice(0, 200);
    return { v: 1, fra: String(c.fra || "En venn").slice(0, 40), laget: String(c.laget || "").slice(0, 10), rader };
  } catch { return null; }
}

// ── local log → card rows ───────────────────────────────────────────────
export interface ShopLog { months: string[]; orders: string[]; nace?: string | null }
export function cardRows(log: Record<string, ShopLog>): CardRow[] {
  const rows: CardRow[] = [];
  for (const [d, l] of Object.entries(log)) {
    if (sensitive(d, l.nace)) continue;
    const months = [...new Set(l.months)].sort();
    if (months.length < 2 && l.orders.length === 0) continue;
    const yrs = [...months, ...l.orders.map((o) => o.slice(0, 7))].map((m) => Number(m.slice(0, 4))).sort();
    rows.push({ d, n: l.orders.length, m: months.length, y0: yrs[0]!, y1: yrs[yrs.length - 1]! });
  }
  return rows.sort((a, b) => b.n - a.n || b.m - a.m);
}
