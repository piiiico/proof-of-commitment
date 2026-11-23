import { expect, test } from "bun:test";
import { brregLine, cardRows, decodeCard, encodeCard, findOrgNrs, isOrderPage, mod11, nameMatches, sensitive } from "./shop";

const bil = { orgnr: "882692302", navn: "BILTEMA NORGE AS", start: "2000-10-25", ansatte: 1845, nace: "47.520", konkurs: false, avvikling: false, tvang: false, slettet: false, omsetning: 5644138240, aar: "2023", hjemmeside: "www.biltema.no" };

test("org.nr: labelled + mod11 valid only, never a bare 9-digit number", () => {
  expect(mod11("882692302")).toBe(true);
  expect(mod11("882692303")).toBe(false);
  expect(findOrgNrs("Biltema Norge AS · Org.nr: 882 692 302")).toEqual(["882692302"]);
  expect(findOrgNrs("Organisasjonsnummer 882692302 MVA")).toEqual(["882692302"]);
  expect(findOrgNrs("NO 882 692 302 MVA")).toEqual(["882692302"]);
  expect(findOrgNrs("Ring 882 692 302 for hjelp")).toEqual([]); // unlabelled
  expect(findOrgNrs("Org.nr: 882 692 303")).toEqual([]); // bad checksum
});

test("line: quiet when healthy, red on hard facts", () => {
  const l = brregLine("biltema.no", bil, new Date("2026-11-10"));
  expect(l.text.replace(/\s/g, " ")).toBe("Biltema Norge AS · i drift siden 2000 · 1 845 ansatte · omsetning 2023: 5,6 mrd kr");
  expect(l.red).toEqual([]);
  expect(brregLine("biltema.no", { ...bil, konkurs: true }).red).toContain("konkurs");
  expect(brregLine("x.no", { ...bil, navn: "NY BUTIKK AS", hjemmeside: null, start: "2026-08-01", omsetning: null, aar: null }, new Date("2026-11-10")).red.join()).toMatch(/ingen regnskap/);
  // v0.5.2: a name that doesn't resemble the domain is grey info, never red (75/341 legit .no sites were red)
  const obs = brregLine("obs.no", { ...bil, navn: "COOP NORGE SA", hjemmeside: null }, new Date("2026-11-10"));
  expect(obs.red).toEqual([]);
  expect(obs.text).toMatch(/^drives av Coop Norge SA · i drift siden 2000/);
  expect(brregLine("biltema.no", bil, new Date("2026-11-10")).text).toMatch(/^Biltema Norge AS/);
});

import { rdapBase, rdapRegistered, registrable } from "./shop";
const NOW = new Date("2026-11-23");
const red = (d: string, b: typeof bil, reg: string | null) => brregLine(d, b, NOW, reg).red.join(" | ");
test("clone signature: domain < 12 months, company >= 3 years older than the domain → red", () => {
  // brand-in-URL clones that copy Biltema's footer (all passed grey in v0.5.1)
  for (const d of ["biltema-outlet.shop", "biltemanorge-tilbud.com", "biltema-blackfriday.store"])
    expect(red(d, bil, "2026-10-28T09:00:00Z")).toBe("nytt domene (oktober 2026), selskapet fra 2000 – kopier av kjente butikker ser slik ut");
  const l = brregLine("biltema.no", bil, NOW, "1999-11-14T23:00:00Z");
  expect(l.red).toEqual([]);
  expect(l.text).toMatch(/i drift siden 2000 · domenet registrert 1999 ·/);
  // the 4 measured legit false positives keep a TRUE sentence (dates from the 11-23 RDAP census)
  expect(red("sparebankennorge.no", { ...bil, navn: "SPAREBANKEN NORGE", start: "1982-01-01" }, "2026-06-29T17:55:03Z")).toMatch(/^nytt domene \(juni 2026\), selskapet fra 1982/);
  expect(red("regnskapsbasen.no", { ...bil, navn: "ELGFARM AS", start: "2021-02-01" }, "2026-03-20T09:01:12Z")).toMatch(/^nytt domene \(mars 2026\), selskapet fra 2021/);
  expect(red("gaiagruppen.no", { ...bil, navn: "GAIA GRUPPEN AS", start: "2007-06-01" }, "2026-11-12T14:25:04Z")).toMatch(/^nytt domene \(november 2026\), selskapet fra 2007/);
  expect(red("lystclub.no", { ...bil, navn: "INVEST CK DA", start: "2015-04-01" }, "2026-01-25T18:05:12Z")).toMatch(/^nytt domene \(januar 2026\), selskapet fra 2015/);
  // boundaries: a 13-month-old domain, a company only 2 years older, unknown company start, no date → no clone red
  expect(red("x.no", bil, "2025-10-01T00:00:00Z")).toBe("");
  expect(red("x.no", { ...bil, start: "2024-08-01" }, "2026-08-01T00:00:00Z")).toBe("");
  expect(red("x.no", { ...bil, start: null }, "2026-08-01T00:00:00Z")).toBe("");
  expect(red("x.no", bil, null)).toBe("");
  expect(brregLine("x.no", bil, NOW, null).text).not.toMatch(/domenet/);
});

const BOOT: [string[], string[]][] = [[["no"], ["https://rdap.norid.no/"]], [["com", "net"], ["http://x.invalid/", "https://rdap.verisign.com/com/v1/"]]];
const rdapRes = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
test("RDAP: bootstrap, registrable domain, needle, 429 and no-bootstrap arms", async () => {
  expect(registrable("www.shop.biltema.no")).toBe("biltema.no");
  expect(registrable("www.example.co.uk")).toBe("example.co.uk");
  expect(rdapBase("biltema.no", BOOT)).toBe("https://rdap.norid.no/");
  expect(rdapBase("drmartensie.com", BOOT)).toBe("https://rdap.verisign.com/com/v1/"); // https only
  const seen: string[] = [];
  const ok = (async (u: string) => { seen.push(u); return new Response(JSON.stringify({ events: [{ eventAction: "last changed", eventDate: "2026-11-01T00:00:00Z" }, { eventAction: "registration", eventDate: "2026-03-12T07:57:30Z" }] })); }) as unknown as typeof fetch;
  expect(await rdapRegistered("drmartensie.com", BOOT, ok)).toBe("2026-03-12T07:57:30Z");
  expect(seen).toEqual(["https://rdap.verisign.com/com/v1/domain/drmartensie.com"]);
  expect(await rdapRegistered("biltema.no", BOOT, rdapRes(429, { errorCode: 429 }))).toBeNull();
  expect(await rdapRegistered("biltema.no", BOOT, rdapRes(200, { events: [] }))).toBeNull();
  expect(await rdapRegistered("biltema.no", BOOT, (async () => { throw new Error("net"); }) as unknown as typeof fetch)).toBeNull();
  let called = 0;
  expect(await rdapRegistered("vero-moda.es", BOOT, (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch)).toBeNull();
  expect(called).toBe(0); // no bootstrap → no request, no date, never «nytt»
});

test("name match is fuzzy both ways", () => {
  expect(nameMatches("elkjop.no", { navn: "ELKJØP NORGE AS", hjemmeside: null })).toBe(true);
  expect(nameMatches("komplett.no", { navn: "KOMPLETT SERVICES AS", hjemmeside: null })).toBe(true);
  expect(nameMatches("fake-shop.no", { navn: "BILTEMA NORGE AS", hjemmeside: null })).toBe(false);
  expect(nameMatches("biltema-blackfriday.store", { navn: "BILTEMA NORGE AS", hjemmeside: null })).toBe(true); // why a name can't catch a clone
});

test("order pages", () => {
  expect(isOrderPage("/checkout/success", "")).toBe(true);
  expect(isOrderPage("/x", "Takk for din bestilling!")).toBe(true);
  expect(isOrderPage("/produkt/takk-lampe", "Lampe")).toBe(false);
  expect(isOrderPage("/handlekurv", "Handlekurv")).toBe(false);
  expect(isOrderPage("/takk", "")).toBe(true);
  expect(isOrderPage("/thank-you-cards", "")).toBe(false);
});

test("card: sensitive never counted; 1 month without order not counted; round-trips", () => {
  const rows = cardRows({
    "biltema.no": { months: ["2025-03", "2026-10"], orders: ["2025-03-02/checkout/success", "2026-10-01/checkout/success", "2026-10-09/checkout/success"] },
    "vitusapotek.no": { months: ["2025-01", "2026-01"], orders: ["2026-01-01/x"] },
    "kjell.com": { months: ["2026-10"], orders: [] },
    "x.no": { months: ["2025-01", "2025-02"], orders: [], nace: "92.000" },
  });
  expect(rows).toEqual([{ d: "biltema.no", n: 3, m: 2, y0: 2025, y1: 2026 }]);
  const c = decodeCard(encodeCard({ v: 1, fra: "Håkon", laget: "2026-11-10", rader: [...rows, { d: "casino.no", n: 1, m: 1, y0: 2026, y1: 2026 }] }))!;
  expect(c.fra).toBe("Håkon");
  expect(c.rader.map((r) => r.d)).toEqual(["biltema.no"]); // importer re-filters sensitive
  expect(decodeCard("not-a-card")).toBeNull();
  expect(sensitive("norsk-tipping.no")).toBe(true);
  expect(sensitive("biltema.no", "47.520")).toBe(false);
});

import { mergeHistory, monthWindows } from "./shop";
const T = (s: string) => new Date(s).getTime();
test("history merge: orders only via isOrderPage, months-only only for shops with a known org.nr, sensitive/news never", () => {
  const items = [
    { url: "https://www.biltema.no/checkout/success", title: "Takk", t: T("2026-09-03T10:00Z") },
    { url: "https://www.biltema.no/bil/lyspaere", title: "Lyspære", t: T("2026-10-12T10:00Z") },
    { url: "https://www.europris.no/x", title: "Takk for din bestilling!", t: T("2026-10-20T10:00Z") },
    { url: "https://www.kjell.com/no/", title: "Kjell", t: T("2026-08-20T10:00Z") },
    { url: "https://www.kjell.com/no/kabler", title: "Kabler", t: T("2026-10-02T10:00Z") },
    { url: "https://www.clas.no/", title: "Clas", t: T("2026-09-02T10:00Z") },
    { url: "https://www.clas.no/a", title: "Clas", t: T("2026-10-02T10:00Z") },
    { url: "https://www.vg.no/nyheter", title: "VG", t: T("2026-09-01T10:00Z") },
    { url: "https://www.vg.no/sport", title: "VG", t: T("2026-10-01T10:00Z") },
    { url: "https://www.vitusapotek.no/checkout/success", title: "Takk", t: T("2026-10-01T10:00Z") },
    { url: "https://www.vg.no/takk-lampe", title: "Produkt", t: T("2026-10-03T10:00Z") },
    { url: "chrome://settings", title: "x", t: T("2026-10-03T10:00Z") },
  ];
  const { log, touched } = mergeHistory({}, items, { "kjell.com": "980406989" });
  expect(touched).toEqual(["biltema.no", "europris.no", "kjell.com"]); // clas.no: no org.nr seen, no order → out; vg.no news; apotek sensitive
  expect(cardRows(log)).toEqual([
    { d: "biltema.no", n: 1, m: 2, y0: 2026, y1: 2026 },
    { d: "europris.no", n: 1, m: 1, y0: 2026, y1: 2026 },
    { d: "kjell.com", n: 0, m: 2, y0: 2026, y1: 2026 },
  ]);
  // merging is idempotent and unions with the live log
  const again = mergeHistory({ ...log, "biltema.no": { ...log["biltema.no"]!, months: [...log["biltema.no"]!.months, "2026-11"] } }, items, {});
  expect(again.log["biltema.no"]!.orders).toEqual(["2026-09-03/checkout/success"]);
  expect(again.log["biltema.no"]!.months).toEqual(["2026-09", "2026-10", "2026-11"]);
  expect(mergeHistory({}, [], {}).touched).toEqual([]); // empty profile → no rows
});
test("month windows cover 90 days, contiguous", () => {
  const w = monthWindows(T("2026-11-10T12:00Z"));
  expect(w.map((x) => x.m)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
  expect(w[0]!.start).toBe(T("2026-11-10T12:00Z") - 90 * 864e5);
  for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBe(w[i - 1]!.end);
  expect(w[w.length - 1]!.end).toBe(T("2026-11-10T12:00Z"));
});
