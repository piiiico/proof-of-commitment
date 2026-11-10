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
  expect(brregLine("superbillig-sko.no", { ...bil, hjemmeside: null }).red.join()).toMatch(/ikke ligner/);
});

test("name match is fuzzy both ways", () => {
  expect(nameMatches("elkjop.no", { navn: "ELKJØP NORGE AS", hjemmeside: null })).toBe(true);
  expect(nameMatches("komplett.no", { navn: "KOMPLETT SERVICES AS", hjemmeside: null })).toBe(true);
  expect(nameMatches("fake-shop.no", { navn: "BILTEMA NORGE AS", hjemmeside: null })).toBe(false);
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
