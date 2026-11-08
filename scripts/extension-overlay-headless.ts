import puppeteer from "/workspace/node_modules/puppeteer-core";
const ext = "/workspace/proof-of-commitment/dist/extension";
const code = (await Bun.file(process.env.SYNCODE_FILE || "/workspace/tmp/ext/syncode").text()).trim();
const serp = (q: string, ds: string[]) => `<html><body><div id="search"><div id="rso">${ds.map((d) => `<div class="g"><div><a href="https://www.${d}/produkt"><h3>${d} — ${q}</h3></a></div></div>`).join("")}</div></div></body></html>`;
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"] });
const p = await b.newPage();
await p.setRequestInterception(true);
const sent: string[] = [];
p.on("request", (r) => {
  const u = r.url();
  if (u.startsWith("https://www.google.com/search")) return r.respond({ status: 200, contentType: "text/html", body: serp(new URL(u).searchParams.get("q")!, (new URL(u).searchParams.get("ds") || "").split(",")) });
  if (u.startsWith("https://www.biltema.no/") || u.startsWith("https://www.kjell.com/")) return r.respond({ status: 200, contentType: "text/html", body: "<html><body><h1>Shop</h1></body></html>" });
  r.continue();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const overlays = () => p.evaluate(() => [...document.querySelectorAll(".commit-overlay")].map((e) => (e as HTMLElement).innerText));
// arm 0: not connected -> nothing
await p.goto("https://www.google.com/search?q=lys+audi&ds=biltema.no,kjell.com", { waitUntil: "load" }); await wait(3000);
console.log("A0 not-connected overlays:", JSON.stringify(await overlays()));
// connect
await p.goto(`https://getcommit.dev/anbefal/i/${code}`, { waitUntil: "networkidle2" }); await wait(1500);
console.log("bar:", await p.evaluate(() => document.getElementById("commit-connect-bar")?.innerText));
await p.click("#commit-on"); await wait(500);
console.log("bar after:", await p.evaluate(() => document.getElementById("commit-connect-bar")?.innerText));
// arm 1: lys audi -> biltema endorsed, kjell silent on endorsement
await p.goto("https://www.google.com/search?q=lys+audi&ds=biltema.no,kjell.com", { waitUntil: "load" }); await wait(4000);
console.log("A1 overlays:", JSON.stringify(await overlays(), null, 1));
await p.screenshot({ path: "serp.png" });
// arm 2: shop page badge from cache; and silent on kjell
await p.goto("https://www.biltema.no/produkt", { waitUntil: "load" }); await wait(2500);
console.log("A2 biltema badge:", await p.evaluate(() => document.getElementById("commit-anbefal-badge")?.innerText));
await p.screenshot({ path: "shop.png" });
await p.goto("https://www.kjell.com/produkt", { waitUntil: "load" }); await wait(2500);
console.log("A3 kjell badge:", await p.evaluate(() => document.getElementById("commit-anbefal-badge")?.innerText ?? "NONE"));
await b.close();
