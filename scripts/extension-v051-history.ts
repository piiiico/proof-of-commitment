// v0.5.1 acceptance: «Lag kortet fra de siste 90 dagene». Real Chromium, non-headless under Xvfb (DISPLAY must be set).
// All history is SYNTHETIC (labelled): seeded into the profile's History SQLite before launch. Pico, AI agent.
// Arms: positive (seeded profile), negative (empty profile), permission (before grant / declined → nothing read),
// revoke, export → import in a fresh profile → friend line on a real shop page and a real Bing result.
import puppeteer from "/workspace/node_modules/puppeteer-core";
import { $ } from "bun";
import { rmSync } from "fs";
const ext = "/workspace/proof-of-commitment/dist/extension";
const shots = "/workspace/proof-of-commitment/chrome-store/screenshots";
const tmp = "/workspace/tmp/ext-v051";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (!process.env.DISPLAY) throw new Error("run under Xvfb: DISPLAY unset");
const key = (k: string) => $`python3 /workspace/proof-of-commitment/scripts/xkey.py ${k}`.quiet();
const launch = (dir: string, _confirm = "accept") => puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: false, userDataDir: dir, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox", "--window-size=1280,800", "--lang=nb-NO"], defaultViewport: { width: 1280, height: 800 } });
async function sw(b: any) { const t = await b.waitForTarget((t: any) => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 15000 }); return { w: await t.worker(), id: new URL(t.url()).host }; }
let fails = 0; const check = (name: string, ok: boolean, got?: unknown) => { console.log(ok ? "PASS" : "FAIL", name, ok ? "" : JSON.stringify(got)); if (!ok) fails++; };

// SYNTHETIC history: day offsets from now. Expected card: biltema (order + 3 months), europris (order), kjell (months only, org.nr seen).
const SEED: [string, string, number][] = [
  ["https://www.biltema.no/bil/lyspaere-h7", "Lyspære H7 | Biltema", 70],
  ["https://www.biltema.no/checkout/success", "Takk for din bestilling | Biltema", 40],
  ["https://www.biltema.no/fritid/", "Fritid | Biltema", 5],
  ["https://www.europris.no/ordrebekreftelse?id=SYNTH1", "Ordrebekreftelse | Europris", 30],
  ["https://www.kjell.com/no/produkter/kabler", "Kabler | Kjell", 60],
  ["https://www.kjell.com/no/", "Kjell & Company", 8],
  ["https://www.clas.no/", "Clas Ohlson", 50], ["https://www.clas.no/verktoy", "Verktøy | Clas Ohlson", 9], // shop, but no order & no org.nr seen → absent
  ["https://www.vg.no/nyheter", "VG", 65], ["https://www.vg.no/sport", "VG Sport", 20], ["https://www.vg.no/takk-lampe", "VG", 10], // news → absent
  ["https://www.vitusapotek.no/checkout/success", "Takk for din bestilling", 25], ["https://www.vitusapotek.no/", "Vitusapotek", 70], // sensitive → absent
];
async function seedHistory(dir: string, rows: typeof SEED) {
  const b = await launch(dir); const p = await b.newPage(); await p.goto("about:blank"); await wait(2500); await b.close(); await wait(1000);
  const py = `import sqlite3,sys,json,time
c=sqlite3.connect(sys.argv[1]); now=int((time.time()+11644473600)*1e6)
for url,title,days in json.loads(sys.argv[2]):
  t=now-int(days*86400*1e6)
  cur=c.execute("insert into urls(url,title,visit_count,typed_count,last_visit_time,hidden) values(?,?,1,0,?,0)",(url,title,t))
  c.execute("insert into visits(url,visit_time,from_visit,transition,segment_id,visit_duration) values(?,?,0,805306368,0,0)",(cur.lastrowid,t))
c.commit(); print(c.execute("select count(*) from urls").fetchone()[0])`;
  return (await $`python3 -c ${py} ${dir}/Default/History ${JSON.stringify(rows)}`.text()).trim();
}
const cardText = (p: any) => p.evaluate(() => document.getElementById("card-section")?.innerText ?? "");

for (const d of ["A", "B", "C", "D"]) rmSync(`${tmp}-${d}`, { recursive: true, force: true });
console.log("seeded urls A:", await seedHistory(`${tmp}-A`, SEED));
console.log("seeded urls D:", await seedHistory(`${tmp}-D`, SEED));

// ── A: permission control, positive control, export, revoke ──
const A = await launch(`${tmp}-A`); const { w: wA, id } = await sw(A);
// LABELLED SYNTHETIC: kjell.com's org.nr as if seen on an earlier visit (the content script writes shop:org this way).
await wA.evaluate(() => chrome.storage.local.set({ "shop:org": { "kjell.com": "980406989" } }));
// The user's real path: the toolbar popup (chrome.action.openPopup), click, Chrome's native dialog (focus starts on Deny → Tab, Return = Allow).
const openPopup = async () => { await wA.evaluate(() => chrome.action.openPopup()); const t = await A.waitForTarget((t: any) => t.url().endsWith("/popup.html"), { timeout: 10000 }); const pg = await t.asPage(); await wait(1500); return pg; };
let pop = await openPopup();
const pre = await pop.evaluate(async () => ({ granted: await chrome.permissions.contains({ permissions: ["history"] }), api: typeof (chrome as any).history, log: (await chrome.storage.local.get("shop:log"))["shop:log"] ?? null }));
check("before grant: no permission, no history API, nothing in shop:log", !pre.granted && pre.api === "undefined" && pre.log === null, pre);
check("button present", /Lag kortet fra de siste 90 dagene/.test(await cardText(pop)), await cardText(pop));
await pop.click("#hist-read"); await wait(1500);
await $`python3 /workspace/proof-of-commitment/scripts/xshot.py ${shots}/v051-chrome-dialog.png`.quiet();
await key("Tab"); await key("Return"); await wait(3000);
const stored = await wA.evaluate(async () => (await chrome.storage.local.get("shop:history"))["shop:history"] ?? null);
check("grant → background read stored shop:history", !!stored && stored.touched === 3, stored);
if (!pop.isClosed()) await pop.close().catch(() => {});
pop = await openPopup();
const after = await cardText(pop);
console.log("CARD A:", JSON.stringify(after));
for (const d of ["biltema.no", "europris.no", "kjell.com"]) check(`row ${d}`, after.includes(d + ":"), after);
for (const d of ["clas.no", "vg.no", "vitusapotek.no"]) check(`absent ${d}`, !after.includes(d), after);
check("biltema counts 1 order", /biltema\.no: handlet her 1×/.test(after), after);
check("kjell months-only", /kjell\.com: kom tilbake hit 2 måneder/.test(after), after);
check("rule + date span shown", /Lest lokalt fra nettleserhistorikken \d\d\.\d\d\.\d{4}–\d\d\.\d\d\.\d{4}: 3 butikker/.test(after) && /Ingenting sendes/.test(after), after);
await pop.evaluate(() => { const n = document.createElement("div"); n.textContent = "SYNTETISK HISTORIKK (testprofil)"; n.style.cssText = "background:#facc15;color:#000;font-weight:700;padding:4px;text-align:center"; document.body.prepend(n); });
await pop.screenshot({ path: `${shots}/v051-popup-historikk-SYNTETISK.png` });
await pop.evaluate(() => (document.getElementById("card-copy") as HTMLButtonElement)?.click()); await wait(800);
const link = await pop.evaluate(() => (document.getElementById("card-copy") as HTMLElement)?.dataset.link);
check("export link", !!link && link.startsWith("https://getcommit.dev/extension#kort="), link);
// revoke
await pop.evaluate(() => (document.getElementById("hist-off") as HTMLElement)?.click()); await wait(1200);
check("revoked", !(await pop.evaluate(() => chrome.permissions.contains({ permissions: ["history"] }))));
await A.close();

// ── C: negative control (empty profile) ──
const C = await launch(`${tmp}-C`); const { id: idC } = await sw(C);
const pc = await C.newPage(); await pc.goto(`chrome-extension://${idC}/popup.html`); await wait(1500);
await pc.click("#hist-read"); await wait(1500); await key("Tab"); await key("Return"); await wait(2500);
const ct = await cardText(pc); console.log("CARD C:", JSON.stringify(ct));
check("empty profile: empty-state text, 0 butikker, no rows", /Tomt ennå/.test(ct) && /: 0 butikker/.test(ct) && !/handlet her|kom tilbake/.test(ct), ct);
await C.close();

// ── D: declined prompt → nothing read ──
const D = await launch(`${tmp}-D`, "cancel"); const { id: idD } = await sw(D);
const pd = await D.newPage(); await pd.goto(`chrome-extension://${idD}/popup.html`); await wait(1500);
await pd.click("#hist-read"); await wait(1500); await key("Return"); await wait(2500); // default button = Deny
const dd = await pd.evaluate(async () => ({ granted: await chrome.permissions.contains({ permissions: ["history"] }), log: (await chrome.storage.local.get("shop:log"))["shop:log"] ?? null, hist: (await chrome.storage.local.get("shop:history"))["shop:history"] ?? null }));
check("declined: no permission, nothing read", !dd.granted && dd.log === null && dd.hist === null, dd);
await D.close();

// ── B: friend imports the card, sees the line on a real shop and a real Bing result ──
if (link) {
  const B = await launch(`${tmp}-B`); await sw(B);
  const q = await B.newPage(); await q.goto(link, { waitUntil: "domcontentloaded" }); await wait(3500);
  await q.click("#commit-import"); await wait(600);
  check("import", /Importert/.test(await q.evaluate(() => document.getElementById("commit-import-bar")?.innerText ?? "")));
  await q.goto("https://www.biltema.no/", { waitUntil: "domcontentloaded", timeout: 45000 }); await wait(9000);
  const sl = await q.evaluate(() => document.getElementById("commit-shop-line")?.innerText ?? "NONE");
  console.log("B SHOP:", JSON.stringify(sl)); check("friend line on shop", /handlet her 1×/.test(sl), sl);
  await q.evaluate(() => { const n = document.createElement("div"); n.textContent = "Vennelinjen kommer fra et kort laget av SYNTETISK HISTORIKK"; n.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#facc15;color:#000;font:700 14px sans-serif;padding:6px;text-align:center"; document.body.appendChild(n); });
  await q.screenshot({ path: `${shots}/v051-friend-on-shop-SYNTETISK.png` });
  await q.goto("https://www.bing.com/search?q=biltema.no+europris.no", { waitUntil: "domcontentloaded" }); await wait(6000);
  const bl = await q.evaluate(() => [...document.querySelectorAll("[data-commit-serp]")].map((e) => (e as HTMLElement).dataset.commitSerp + " => " + (e as HTMLElement).innerText));
  console.log("B BING:", JSON.stringify(bl)); check("friend line on a Bing result", bl.some((x) => /handlet her 1×/.test(x)), bl);
  await q.screenshot({ path: `${shots}/v051-friend-serp-bing-SYNTETISK.png` });
  await B.close();
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
