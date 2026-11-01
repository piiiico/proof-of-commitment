/**
 * The `compromised` field must never go dark, and never read clean when we could not check.
 *
 * History. Until 2026-09-19 a 90-day cutoff silently expired every registered attack.
 * After that fix the hand-kept registry itself went quiet: no entry after 2026-06-26,
 * so keyv@6.0.0 (MAL-2026-11524), jscrambler@8.14.0, @joyfill/components and
 * litellm 1.107.0 audited clean in October while OSV carried all of them.
 * Since 2026-11-01 the field comes from OSV's OpenSSF malicious-packages records.
 *
 * Invariants pinned here, all against the real enrichWithAttackHistory with a
 * mocked FETCH seam (never mock.module):
 *   - age-blind: a decade-old MAL record still attaches, with its date
 *   - only non-withdrawn MAL- ids count (GHSA advisories are not "compromised")
 *   - an exact version is sent to OSV; a range is not
 *   - OSV unreachable/malformed → compromised_check:"unavailable", never clean
 * Live arm: OSV_LIVE=1 bun test test/attack-registry-no-expiry.test.ts
 */
import { expect, test, describe } from "bun:test";
import { enrichWithAttackHistory, parseAuditPackages } from "../src/backend/worker";

type Row = { name: string; ecosystem: string; compromised?: any; compromised_check?: string };
const row = (name: string, ecosystem = "npm"): Row => ({ name, ecosystem });

const RECORDS: Record<string, any> = {
  "MAL-2016-0001": { id: "MAL-2016-0001", published: "2016-01-02T00:00:00Z", affected: [{ package: { name: "old-evil", ecosystem: "npm" }, versions: ["1.0.0"] }] },
  "MAL-2026-0002": { id: "MAL-2026-0002", published: "2026-08-04T11:19:14Z", affected: [{ package: { name: "keyv", ecosystem: "npm" }, versions: ["6.0.0"] }] },
  "MAL-2026-0003": { id: "MAL-2026-0003", published: "2026-05-01T00:00:00Z", withdrawn: "2026-05-03T00:00:00Z", affected: [] },
};
const HITS: Record<string, string[]> = { "old-evil": ["MAL-2016-0001"], keyv: ["MAL-2026-0002", "GHSA-xxxx-yyyy-zzzz"], fastapi: ["MAL-2026-0003"], lodash: ["GHSA-f23m-r3pf-42rh"] };

function fakeOsv(opts: { down?: "status" | "throw" | "malformed" } = {}) {
  const queries: any[] = [];
  const fn = (async (url: string, init?: any) => {
    if (opts.down === "throw") throw new Error("network");
    if (opts.down === "status") return new Response("oops", { status: 503 });
    if (url.endsWith("/querybatch")) {
      const qs = JSON.parse(init.body).queries;
      queries.push(...qs);
      if (opts.down === "malformed") return Response.json({ results: [] });
      return Response.json({ results: qs.map((q: any) => ({ vulns: (HITS[q.package.name] ?? []).map((id) => ({ id })) })) });
    }
    const id = url.split("/").pop()!;
    return RECORDS[id] ? Response.json(RECORDS[id]) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, queries };
}

describe("compromised comes from OSV MAL records", () => {
  test("age-blind: a decade-old record still attaches, with its date", async () => {
    const rows = [row("old-evil")];
    await enrichWithAttackHistory(rows, new Map(), fakeOsv().fn);
    expect(rows[0]!.compromised.ids).toEqual(["MAL-2016-0001"]);
    expect(rows[0]!.compromised.date).toBe("2016-01-02");
    expect(rows[0]!.compromised.url).toBe("https://osv.dev/vulnerability/MAL-2016-0001");
    expect(rows[0]!.compromised.attack).toContain("1.0.0");
    expect(rows[0]!.compromised_check).toBe("osv");
  });

  test("only non-withdrawn MAL- ids count; GHSA-only and clean packages stay unmarked", async () => {
    const rows = [row("keyv"), row("lodash"), row("fastapi", "pypi"), row("zod")];
    await enrichWithAttackHistory(rows, new Map(), fakeOsv().fn);
    expect(rows[0]!.compromised.ids).toEqual(["MAL-2026-0002"]);
    for (const r of rows.slice(1)) {
      expect(r.compromised).toBeUndefined();
      expect(r.compromised_check).toBe("osv");
    }
  });

  test("exact version goes to OSV, a range does not; ecosystems map to OSV names", async () => {
    const osv = fakeOsv();
    const rows = [row("keyv"), row("express"), row("litellm", "pypi"), row("serde", "cargo"), row("golang.org/x/net", "golang")];
    await enrichWithAttackHistory(rows, new Map([["keyv", "6.0.0"], ["express", "4.x"]]), osv.fn);
    expect(osv.queries[0]).toEqual({ package: { name: "keyv", ecosystem: "npm" }, version: "6.0.0" });
    expect(osv.queries[1]).toEqual({ package: { name: "express", ecosystem: "npm" } });
    expect(osv.queries.slice(2).map((q) => q.package.ecosystem)).toEqual(["PyPI", "crates.io", "Go"]);
    expect(rows[0]!.compromised.version_checked).toBe("6.0.0");
  });

  for (const down of ["status", "throw", "malformed"] as const) {
    test(`OSV ${down} → compromised_check "unavailable", never read as clean`, async () => {
      const rows = [row("keyv"), row("zod")];
      await enrichWithAttackHistory(rows, new Map(), fakeOsv({ down }).fn);
      for (const r of rows) {
        expect(r.compromised_check).toBe("unavailable");
        expect(r.compromised).toBeUndefined();
      }
    });
  }
});

describe("parseAuditPackages", () => {
  test("strings, name@version, scoped names and the {name, version} shape", () => {
    const { packages, versions } = parseAuditPackages(["zod", "keyv@6.0.0", "@joyfill/components", "@a/b@1.2.3", { name: "litellm", version: "1.107.0" }, 7, null]);
    expect(packages).toEqual(["zod", "keyv", "@joyfill/components", "@a/b", "litellm"]);
    expect(versions.get("keyv")).toBe("6.0.0");
    expect(versions.get("@a/b")).toBe("1.2.3");
    expect(versions.get("litellm")).toBe("1.107.0");
  });

  test("one name, two versions (or one bare) → whole-package check, so a clean version cannot hide a bad one", async () => {
    for (const items of [["keyv@6.0.0", "keyv@5.0.0"], ["keyv@5.0.0", "keyv@6.0.0"], ["keyv", "keyv@5.0.0"], ["keyv@5.0.0", "keyv"]]) {
      const { versions } = parseAuditPackages(items);
      const osv = fakeOsv();
      await enrichWithAttackHistory([row("keyv")], versions, osv.fn);
      expect(osv.queries[0]).toEqual({ package: { name: "keyv", ecosystem: "npm" } });
    }
    expect(parseAuditPackages(["keyv@6.0.0", "keyv@6.0.0"]).versions.get("keyv")).toBe("6.0.0");
  });
});

describe.if(process.env.OSV_LIVE === "1")("live OSV", () => {
  test("known MAL hits and misses", async () => {
    const rows = [row("keyv"), row("jscrambler"), row("lodash"), row("react"), row("litellm", "pypi")];
    await enrichWithAttackHistory(rows, new Map([["keyv", "6.0.0"], ["lodash", "4.17.21"], ["litellm", "1.107.0"]]));
    expect(rows[0]!.compromised.ids).toContain("MAL-2026-11524");
    expect(rows[1]!.compromised.ids).toContain("MAL-2026-10187");
    expect(rows[2]!.compromised).toBeUndefined();
    expect(rows[3]!.compromised).toBeUndefined();
    expect(rows[4]!.compromised.ids).toContain("MAL-2026-2144");
    const clean = [row("litellm", "pypi")];
    await enrichWithAttackHistory(clean, new Map([["litellm", "1.106.0"]]));
    expect(clean[0]!.compromised).toBeUndefined();
    expect(clean[0]!.compromised_check).toBe("osv");
  });
});
