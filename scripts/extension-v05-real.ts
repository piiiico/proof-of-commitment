// v0.5 acceptance: real Chromium (new headless = full browser; Xvfb absent in this container), real shops, real SERPs.
// Card arm: seeds ONE prior month into profile A's local log (labelled), exports via the real popup, imports in a fresh profile B.
import puppeteer from "/workspace/node_modules/puppeteer-core";
const ext = "/workspace/proof-of-commitment/dist/extension";
const shots = "/workspace/proof-of-commitment/chrome-store/screenshots";
const HEADLESS = process.env.DISPLAY ? false : "new";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const launch = (dir: string) => puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: HEADLESS as any, userDataDir: dir, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox", "--window-size=1280,800", "--lang=nb-NO"], defaultViewport: { width: 1280, height: 800 } });
async function sw(b: any) { const t = await b.waitForTarget((t: any) => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 15000 }); return { w: await t.worker(), id: new URL(t.url()).host }; }
const line = (p: any) => p.evaluate(() => document.getElementById("commit-shop-line")?.innerText ?? "NONE");
const SHOPS = (process.env.SHOPS || "https://www.biltema.no/,https://www.elkjop.no/,https://www.kjell.com/no/").split(",");

const A = await launch("/workspace/tmp/ext-v05-A"); const { w: wA, id } = await sw(A);
const p = await A.newPage();
for (const u of SHOPS) {
  try { await p.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { console.log("GOTO-FAIL", u, String(e).slice(0, 80)); continue; }
  await wait(9000);
  console.log("SHOP", u, "→", JSON.stringify(await line(p)));
  await p.screenshot({ path: `${shots}/v05-shop-${new URL(u).hostname.replace(/^www\./, "")}.png` });
}
console.log("shop:org", JSON.stringify(await wA.evaluate(() => chrome.storage.local.get("shop:org"))));
// SERPs (real). Google may serve /sorry — not routed around.
for (const [name, u] of [["google", "https://www.google.com/search?q=biltema+lyspære&hl=no"], ["bing", "https://www.bing.com/search?q=biltema.no+europris.no"], ["ddg", "https://duckduckgo.com/html/?q=biltema+lysp%C3%A6re"]] as const) {
  try { await p.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch { console.log("SERP-GOTO-FAIL", name); continue; }
  await wait(6000);
  const r = await p.evaluate(() => ({ url: location.href, captcha: /sorry|captcha|unusual traffic|robot/i.test(location.href + document.body.innerText.slice(0, 3000)), lines: [...document.querySelectorAll("[data-commit-serp]")].map((e) => (e as HTMLElement).innerText) }));
  console.log("SERP", name, JSON.stringify(r));
  await p.screenshot({ path: `${shots}/v05-serp-${name}.png` });
}
// Card: seed one earlier month for biltema (SEEDED, test only), plus one order — then export via the popup.
await wA.evaluate(async () => {
  const { "shop:log": log = {} } = await chrome.storage.local.get("shop:log");
  const l = log["biltema.no"]; if (!l) return;
  l.months = [...new Set(["2025-06", ...l.months])]; l.orders = [...l.orders, "2025-06-14/checkout/success (SEEDED-TEST)"];
  await chrome.storage.local.set({ "shop:log": log });
});
const pop = await A.newPage(); await pop.goto(`chrome-extension://${id}/popup.html`); await wait(2500);
console.log("POPUP card:", JSON.stringify(await pop.evaluate(() => document.getElementById("card-section")?.innerText)));
console.log("POPUP footer:", JSON.stringify(await pop.evaluate(() => document.querySelector(".footer")?.textContent?.trim())));
await pop.screenshot({ path: `${shots}/v05-popup-mitt-kort.png` });
await pop.evaluate(() => (document.getElementById("card-copy") as HTMLButtonElement)?.click()); await wait(800);
const link = await pop.evaluate(() => (document.getElementById("card-copy") as HTMLElement)?.dataset.link);
console.log("LINK", link?.length, link?.slice(0, 80));
await A.close();
if (!link) process.exit(1);
// Profile B: fresh friend, one click import, then the shop shows the friend line.
const B = await launch("/workspace/tmp/ext-v05-B"); await sw(B);
const q = await B.newPage(); await q.goto(link, { waitUntil: "domcontentloaded" }); await wait(3500);
console.log("IMPORT bar:", JSON.stringify(await q.evaluate(() => document.getElementById("commit-import-bar")?.innerText)));
await q.click("#commit-import"); await wait(600);
console.log("IMPORT after:", JSON.stringify(await q.evaluate(() => document.getElementById("commit-import-bar")?.innerText)));
await q.screenshot({ path: `${shots}/v05-import.png` });
await q.goto(SHOPS[0]!, { waitUntil: "domcontentloaded", timeout: 45000 }); await wait(9000);
console.log("B SHOP", JSON.stringify(await line(q)));
await q.screenshot({ path: `${shots}/v05-friend-on-shop.png` });
await q.goto("https://www.bing.com/search?q=biltema.no+europris.no", { waitUntil: "domcontentloaded" }); await wait(6000);
console.log("B SERP bing", JSON.stringify(await q.evaluate(() => [...document.querySelectorAll("[data-commit-serp]")].map((e) => (e as HTMLElement).innerText))));
await q.screenshot({ path: `${shots}/v05-friend-serp-bing.png` });
// Google: real SERP served /sorry to this browser (not routed around) → v0.4-style FIXTURE result page, labelled.
await q.setRequestInterception(true);
q.on("request", (r: any) => r.url().startsWith("https://www.google.com/search") ? r.respond({ status: 200, contentType: "text/html", body: `<html><body><div id="search"><div id="rso">${["biltema.no", "europris.no", "elkjop.no"].map((d) => `<div class="g"><div><a href="https://www.${d}/"><h3>${d} (FIXTURE)</h3></a></div></div>`).join("")}</div></div></body></html>` }) : r.continue());
await q.goto("https://www.google.com/search?q=fixture", { waitUntil: "load" }); await wait(4000);
console.log("B SERP google-FIXTURE", JSON.stringify(await q.evaluate(() => [...document.querySelectorAll("[data-commit-serp]")].map((e) => (e as HTMLElement).dataset.commitSerp + " => " + (e as HTMLElement).innerText))));
await q.screenshot({ path: `${shots}/v05-friend-serp-google-FIXTURE.png` });
await B.close();
