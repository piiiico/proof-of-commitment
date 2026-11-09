// 1280x800 store screenshots of the v0.4 overlay, from the same fixture flow as
// scripts/extension-overlay-headless.ts: a synthetic results page (intercepted google.com/search),
// the live getcommit.dev/anbefal/api/sites, and a synthetic Anbefal code (SYNCODE_FILE).
// Every shot carries a visible «Demo data» label. Run after `bun run build:ext`. Pico, AI agent.
import puppeteer from "/workspace/node_modules/puppeteer-core";
const ext = new URL("../dist/extension", import.meta.url).pathname;
const out = new URL("./screenshots/", import.meta.url).pathname;
const code = (await Bun.file(process.env.SYNCODE_FILE || "/workspace/tmp/ext/syncode").text()).trim();
const q = "lys audi";
const results = [
  ["biltema.no", "Lyspærer og LED til bil | Biltema", "H7, H4 og LED-pærer til de fleste bilmerker. Finn riktig pære for din bil."],
  ["kjell.com", "Billys og pærer | Kjell.com", "Pærer, LED-lister og lys til bilen. Se utvalget i nettbutikk og butikk."],
];
const serp = `<html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;margin:0;color:#202124}header{padding:20px 160px 12px;border-bottom:1px solid #ebebeb}
.box{width:560px;border:1px solid #dfe1e5;border-radius:24px;padding:10px 20px;font-size:16px}
#search{padding:20px 160px;max-width:650px}.g{margin-bottom:28px}.u{font-size:14px;color:#4d5156}
h3{font-size:20px;font-weight:400;color:#1a0dab;margin:4px 0}.s{font-size:14px;color:#4d5156}
</style></head><body><header><div class="box">${q}</div></header><div id="search"><div id="rso">${results
  .map(([d, t, s]) => `<div class="g"><div><a href="https://www.${d}/produkt"><div class="u">https://www.${d}</div><h3>${t}</h3></a><div class="s">${s}</div></div></div>`)
  .join("")}</div></div></body></html>`;
const shop = `<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;padding:60px 160px"><h1>Biltema</h1><p>H7 LED-pære, 2-pk</p></body></html>`;

const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"], defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
await p.setRequestInterception(true);
p.on("request", (r) => {
  const u = r.url();
  if (u.startsWith("https://www.google.com/search")) return r.respond({ status: 200, contentType: "text/html", body: serp });
  if (u.startsWith("https://www.biltema.no/") || u.startsWith("https://www.kjell.com/")) return r.respond({ status: 200, contentType: "text/html", body: shop });
  r.continue();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const label = () => p.evaluate(() => {
  const d = document.createElement("div");
  d.textContent = "Demo data: synthetic search results and a test network";
  d.style.cssText = "position:fixed;top:12px;right:16px;z-index:2147483647;background:#202124;color:#fff;font:600 13px Arial,sans-serif;padding:6px 10px;border-radius:4px";
  document.body.appendChild(d);
});
await p.goto(`https://getcommit.dev/anbefal/i/${code}`, { waitUntil: "networkidle2" }); await wait(1500);
await p.click("#commit-on"); await wait(500);
await p.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}`, { waitUntil: "load" }); await wait(4000);
const n = await p.evaluate(() => document.querySelectorAll(".commit-overlay").length);
if (!n) throw new Error("no overlay rendered — screenshot would show nothing");
await label(); await p.screenshot({ path: `${out}1-results.png` });
await p.goto("https://www.biltema.no/produkt", { waitUntil: "load" }); await wait(2500);
if (!(await p.evaluate(() => !!document.getElementById("commit-anbefal-badge")))) throw new Error("no shop badge");
await label(); await p.screenshot({ path: `${out}2-shop.png` });
await b.close();
console.log(`overlays=${n}; wrote ${out}1-results.png, ${out}2-shop.png`);
