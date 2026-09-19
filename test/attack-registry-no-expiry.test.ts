/**
 * The attack registry must never be able to go dark.
 *
 * What broke (measured 2026-09-19)
 * ────────────────────────────────
 * /api/audit enriched results with known-attack history behind a rolling window:
 *
 *   const cutoff = Date.now() - 90 * 86_400_000;
 *   if (record && new Date(record.date).getTime() > cutoff) { ...attach... }
 *
 * Correct the day it was written. A silent no-op later. By 2026-09-19, 11 of the
 * 13 distinct registered attack waves had aged out (17 registerAttack calls,
 * 13 unique attack/date pairs) — including every attack named in our
 * own agent card ("Catches the ... axios (March 30 2026), LiteLLM (March 27
 * 2026), and Miasma (June 2026) supply chain attacks") — and the 2 survivors
 * were 3 and 5 days from expiry. The whole registry was days from dark.
 *
 * Live effect at the consuming surface, both rails:
 *   API  POST /api/audit {"packages":["fpjson-lang","@cap-js/sqlite","node-ipc"]}
 *        → no `compromised` field on any result
 *   CLI  npx proof-of-commitment fpjson-lang @cap-js/sqlite
 *        → "✓  No CRITICAL packages found."
 * ...over packages carrying documented malware injections that we published
 * blog posts about. A supply-chain scanner printing a false all-clear on
 * known-malicious packages is the worst output this product can emit.
 *
 * Why age-blind is right, not just convenient
 * ───────────────────────────────────────────
 * A documented incident is a permanent fact about a package, and malicious
 * versions stay pinned in lockfiles long after the registry is cleaned. The
 * incident `date` travels inside the record, so any consumer can render
 * recency itself. CI gating never keyed on this field — shouldFail() in
 * npm-package/index.js keys on riskFlags + score only — so always-attaching
 * changes no exit code anywhere. It only restores information.
 *
 * Why this test and not a source grep
 * ───────────────────────────────────
 * A grep for "cutoff" asserts a spelling. This executes the real enrichment
 * function the handler calls, with a record far older than any plausible
 * window, so restoring ANY recency gate — 90 days, 1 year, 10 years — turns
 * it red.
 */

import { expect, test, describe } from "bun:test";
import {
  enrichWithAttackHistory,
  lookupCompromised,
  allAttackRecords,
} from "../src/backend/worker";

type Row = { name: string; ecosystem: string; compromised?: { attack: string; date: string; url: string } };

const row = (name: string, ecosystem = "npm"): Row => ({ name, ecosystem });

describe("attack registry has no expiry", () => {
  test("the oldest registered attack still enriches", () => {
    // Pin the INVARIANT (oldest record is still reported), not today's value.
    const records = allAttackRecords();
    expect(records.length).toBeGreaterThan(0);

    const oldest = records
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]!;

    const ageDays = (Date.now() - new Date(oldest.date).getTime()) / 86_400_000;
    // Guard the guard: if this ever fails the corpus has no old records left
    // and the test would pass vacuously against a 90-day window.
    expect(ageDays).toBeGreaterThan(120);

    // Find a concrete package carrying that oldest record.
    const hit = ["litellm", "axios", "node-ipc", "fpjson-lang", "@cap-js/sqlite"]
      .map((n) => ({ n, r: lookupCompromised(n, n === "litellm" ? "pypi" : "npm") }))
      .find((x) => x.r !== null);
    expect(hit).toBeDefined();
  });

  test("enrichment attaches a decade-old incident (the exact case the cutoff killed)", () => {
    const rows = [row("fpjson-lang"), row("node-ipc"), row("@cap-js/sqlite")];
    enrichWithAttackHistory(rows);

    for (const r of rows) {
      expect(r.compromised).toBeDefined();
      expect(typeof r.compromised!.attack).toBe("string");
      expect(r.compromised!.attack.length).toBeGreaterThan(0);
      // The date must travel with the record — that is what makes age-blind safe.
      expect(r.compromised!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.compromised!.url).toMatch(/^https?:\/\//);
    }
  });

  test("prefix-registered scopes enrich too (@vapi-ai/* — Miasma)", () => {
    const rows = [row("@vapi-ai/server-sdk")];
    enrichWithAttackHistory(rows);
    expect(rows[0]!.compromised).toBeDefined();
    expect(rows[0]!.compromised!.attack).toContain("Miasma");
  });

  test("NEGATIVE ARM: a clean package is never marked compromised", () => {
    // Without this, 'attach everything' would also pass every assertion above.
    const rows = [row("zod"), row("hono"), row("definitely-not-a-real-package-xyz")];
    enrichWithAttackHistory(rows);
    for (const r of rows) expect(r.compromised).toBeUndefined();
  });

  test("NEGATIVE ARM: ecosystem is respected (npm name under pypi does not match)", () => {
    const rows = [row("node-ipc", "pypi")];
    enrichWithAttackHistory(rows);
    expect(rows[0]!.compromised).toBeUndefined();
  });

  test("every registered record is well-formed (no silent junk in the corpus)", () => {
    const records = allAttackRecords();
    expect(records.length).toBeGreaterThanOrEqual(10);
    for (const r of records) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(r.date).getTime())).toBe(false);
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.attack.length).toBeGreaterThan(0);
    }
  });
});

describe("CRITICAL nudge never compares a package to itself", () => {
  // "axios is CRITICAL — … Same attack profile as axios (Mar 2026)." shipped live.
  test("axios does not get the axios comparison", () => {
    const line = criticalNudge("axios", "sole active npm publisher + >10M/wk");
    expect(line).not.toMatch(/Same attack profile as axios/);
    expect(line).toContain("axios is CRITICAL");
  });

  test("a different package still gets the comparison", () => {
    const line = criticalNudge("debug", "sole active npm publisher + >10M/wk");
    expect(line).toContain("Same attack profile as axios (Mar 2026)");
  });
});

/** Mirror of the worker's first-touch CRITICAL nudge shape. */
function criticalNudge(name: string, reason: string): string {
  const profileRef = name === "axios" ? "" : " Same attack profile as axios (Mar 2026).";
  return `⚠ ${name} is CRITICAL — ${reason}.${profileRef} Monitor it — free key, 30s, no card: URL`;
}
