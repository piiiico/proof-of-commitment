// v0.5.2 acceptance in real Chromium under Xvfb. Pico, AI agent.
// Arms: biltema.no (real page, real Brreg, real RDAP: grey, domain year shown, no red), obs.no (Coop: «drives av», no red —
// red in v0.5.1), clone arm: drmartensie.com (a real NordVPN-listed clone domain, RDAP 2026-03-12) serving a LABELLED
// SYNTHETIC page that copies Biltema's footer (request interception; the RDAP call itself is real) → red clone line,
// result-page arm (Bing, cache-only RDAP), and the cache/one-call arm.
import puppeteer from "/workspace/node_modules/puppeteer-core";
import { rmSync } from "fs";
const ext = "/workspace/proof-of-commitment/dist/extension";
const shots = "/workspace/proof-of-commitment/chrome-store/screenshots";
const dir = "/workspace/tmp/ext-v052";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (!process.env.DISPLAY) throw new Error("run under Xvfb: DISPLAY unset");
let fails = 0; const check = (name: string, ok: boolean, got?: unknown) => { console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(got ?? "")); if (!ok) fails++; };
rmSync(dir, { recursive: true, force: true });
const B = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: false, userDataDir: dir, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox", "--window-size=1280,800", "--lang=nb-NO"], defaultViewport: { width: 1280, height: 800 } });
const t = await B.waitForTarget((t: any) => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 15000 });
const w = await t.worker();
const line = (p: any) => p.evaluate(() => { const e = document.getElementById("commit-shop-line"); return e ? { text: e.innerText, border: e.style.borderLeft } : null; });
const p = await B.newPage();
async function visit(url: string, ms = 9000) { await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); for (let i = 0; i < ms / 500; i++) { await wait(500); if (await line(p)) { await wait(1500); break; } } return line(p); }

const bil = await visit("https://www.biltema.no/");
check("biltema.no: line, domain year, no red", !!bil && /Biltema Norge AS/.test(bil.text) && /domenet registrert \d{4}/.test(bil.text) && !/kopier|ikke ligner/.test(bil.text) && !/217, 48, 37|d93025/.test(bil.border), bil);
const obs = await visit("https://www.obs.no/");
check("obs.no: «drives av Coop Norge SA», no red", !!obs && /drives av Coop Norge SA/.test(obs.text) && !/ikke ligner|kopier/.test(obs.text), obs);

// clone arm — LABELLED SYNTHETIC page body on a real young domain
await p.setRequestInterception(true);
p.on("request", (r: any) => r.url().startsWith("https://drmartensie.com/") && r.resourceType() === "document"
  ? r.respond({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><title>Biltema Black Friday (SYNTETISK TESTSIDE, Pico AI-agent)</title><h1>SYNTETISK testside: klon av en butikkfot</h1><footer>Biltema Norge AS · Org.nr: 882 692 302</footer>` })
  : r.continue());
const clone = await visit("https://drmartensie.com/");
check("clone arm: red clone signature line", !!clone && /nytt domene \(mars 2026\), selskapet fra 2000 – kopier av kjente butikker ser slik ut/.test(clone.text), clone);
await p.screenshot({ path: `${shots}/v052-klon-syntetisk.png` });
await p.setRequestInterception(false); p.removeAllListeners("request");

const cache = await w.evaluate(async () => { const s = await chrome.storage.local.get(["rdap:cache", "rdap:boot"]); return { domains: Object.keys(s["rdap:cache"] || {}), boot: !!s["rdap:boot"]?.services?.length }; });
check("cache: bootstrap stored, one entry per visited shop", cache.boot && ["biltema.no", "obs.no", "drmartensie.com"].every((d) => cache.domains.includes(d)), cache);

await p.goto("https://www.bing.com/search?q=biltema.no", { waitUntil: "domcontentloaded" }); await wait(6000);
const bl = await p.evaluate(() => [...document.querySelectorAll("[data-commit-serp]")].map((e) => (e as HTMLElement).innerText));
check("Bing result line carries the cached domain year", bl.some((x) => /Biltema Norge AS.*domenet registrert/.test(x)), bl);
await B.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
