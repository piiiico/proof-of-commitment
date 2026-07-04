/**
 * Tests for /api/keys/stats aggregation helpers.
 *
 * Why these helpers and not the HTTP handler?
 *   The handler is thin glue: admin-secret auth + Promise.all of the helpers
 *   + json shape. The risk lives in the SQL aggregations and the email-pattern
 *   matching — that's what these tests cover.
 *
 *   buildMcpTrafficStats and buildOrganicMcpKeyStats take a D1Database. We
 *   drive them through a tiny bun:sqlite-backed shim that implements the
 *   methods the helpers actually use (prepare → first / all / bind). The
 *   shim is intentionally minimal — it's NOT a full D1 emulator. If a future
 *   change in the helpers reaches for env.DB.batch or .exec, the shim will
 *   throw, which is the test catching scope creep, not a test bug.
 *
 * Run: `bun test test/keys-stats.test.ts` from the project root.
 */

import { describe, expect, test } from "bun:test";
import { Database, type Statement } from "bun:sqlite";
import {
  buildMcpTrafficStats,
  buildAuditTrafficStats,
  buildOrganicMcpKeyStats,
  parseEmailPatterns,
  isInternalTestEmail,
  DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS,
  READ_ONLY_KEY_PATHS,
  resolveApiKey,
} from "../src/backend/worker.ts";

// ── Minimal D1 shim over bun:sqlite ──────────────────────────────────────
// D1 surface used by the helpers:
//   db.prepare(sql).bind(...).first<T>()
//   db.prepare(sql).bind(...).all<T>() → { results: T[] }
//
// bun:sqlite returns plain rows from .get()/.all(). We adapt.

function d1Shim(sqlite: Database): unknown {
  function prepare(sql: string) {
    let stmt: Statement | null = null;
    let boundArgs: unknown[] = [];
    const lazyStmt = () => {
      if (stmt === null) stmt = sqlite.query(sql);
      return stmt;
    };
    const api = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return api;
      },
      async first<T = unknown>(): Promise<T | null> {
        const row = lazyStmt().get(...(boundArgs as never[])) as T | null;
        return row ?? null;
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        const rows = lazyStmt().all(...(boundArgs as never[])) as T[];
        return { results: rows };
      },
      async run(): Promise<{ success: boolean }> {
        lazyStmt().run(...(boundArgs as never[]));
        return { success: true };
      },
    };
    return api;
  }
  return { prepare };
}

function setupSchema(db: Database) {
  db.exec(`
    CREATE TABLE mcp_rate_limits (
      ip TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip, date)
    );
    CREATE TABLE audit_rate_limits (
      ip TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip, date)
    );
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      key_prefix TEXT,
      email TEXT,
      tier TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      revoked_at TEXT,
      created_at TEXT
    );
  `);
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// ── parseEmailPatterns / isInternalTestEmail ─────────────────────────────

describe("parseEmailPatterns", () => {
  test("empty input → empty array", () => {
    expect(parseEmailPatterns("")).toEqual([]);
    expect(parseEmailPatterns(undefined)).toEqual([]);
    expect(parseEmailPatterns(null)).toEqual([]);
    expect(parseEmailPatterns("   ")).toEqual([]);
  });

  test("single literal pattern", () => {
    const pats = parseEmailPatterns("foo@bar.com");
    expect(pats).toHaveLength(1);
    expect(pats[0]!.test("foo@bar.com")).toBe(true);
    expect(pats[0]!.test("FOO@BAR.COM")).toBe(true); // case-insensitive
    expect(pats[0]!.test("foo@bar.co")).toBe(false);
  });

  test("glob wildcard matches", () => {
    const pats = parseEmailPatterns("pico+*@*");
    expect(pats[0]!.test("pico+test@amdal.dev")).toBe(true);
    expect(pats[0]!.test("pico+anything@anything.co")).toBe(true);
    expect(pats[0]!.test("pico@amdal.dev")).toBe(false); // no `+`
    expect(pats[0]!.test("foo+bar@baz.com")).toBe(false);
  });

  test("comma-separated multiple patterns", () => {
    const pats = parseEmailPatterns("pico+*@*,hawkaa+*@*,test@example.com");
    expect(pats).toHaveLength(3);
    expect(isInternalTestEmail("pico+x@y.z", pats)).toBe(true);
    expect(isInternalTestEmail("hawkaa+probe@example.com", pats)).toBe(true);
    expect(isInternalTestEmail("test@example.com", pats)).toBe(true);
    expect(isInternalTestEmail("stranger@example.com", pats)).toBe(false);
  });

  test("regex metacharacters in pattern are escaped, not interpreted", () => {
    // If `.` were treated as regex, `a.b@c.d` would match `axb@cyd`. It must not.
    const pats = parseEmailPatterns("a.b@c.d");
    expect(pats[0]!.test("a.b@c.d")).toBe(true);
    expect(pats[0]!.test("axb@cyd")).toBe(false);
  });
});

// ── buildMcpTrafficStats ─────────────────────────────────────────────────

describe("buildMcpTrafficStats", () => {
  test("empty table → all zeros", async () => {
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const db = d1Shim(sqlite) as Parameters<typeof buildMcpTrafficStats>[0];

    const stats = await buildMcpTrafficStats(db);
    expect(stats.today.calls).toBe(0);
    expect(stats.today.unique_ips).toBe(0);
    expect(stats.today.ips_at_soft_cta).toBe(0);
    expect(stats.today.ips_at_strong_cta).toBe(0);
    expect(stats.today.ips_at_hard_limit).toBe(0);
    expect(stats.last_7d.calls).toBe(0);
    expect(stats.last_7d.unique_ips_per_day_avg).toBe(0);
    expect(stats.last_7d.max_daily_calls).toBe(0);
    expect(stats.last_7d.ips_that_hit_soft_cta_in_7d).toBe(0);
    expect(stats.today.date).toBe(utcToday());
  });

  test("single IP at count=7 → ips_at_soft_cta=1, not strong/hard", async () => {
    // Thresholds: MCP_SOFT_CTA_AT=5, MCP_STRONG_CTA_AT=10, MCP_HARD_LIMIT=15
    // (tightened from 41/81/100 to drive free-key signups). count=7 sits
    // between soft and strong — exactly the "saw the CTA, hasn't escalated"
    // bucket the dashboard surfaces.
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    sqlite
      .query(`INSERT INTO mcp_rate_limits (ip, date, count) VALUES (?, ?, ?)`)
      .run("1.2.3.4", utcToday(), 7);

    const db = d1Shim(sqlite) as Parameters<typeof buildMcpTrafficStats>[0];
    const stats = await buildMcpTrafficStats(db);

    expect(stats.today.calls).toBe(7);
    expect(stats.today.unique_ips).toBe(1);
    expect(stats.today.ips_at_soft_cta).toBe(1);
    expect(stats.today.ips_at_strong_cta).toBe(0);
    expect(stats.today.ips_at_hard_limit).toBe(0);
  });

  test("threshold edges — 4/5/10/15", async () => {
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const today = utcToday();
    const insert = sqlite.query(
      `INSERT INTO mcp_rate_limits (ip, date, count) VALUES (?, ?, ?)`
    );
    insert.run("ip-4", today, 4);    // below soft CTA
    insert.run("ip-5", today, 5);    // at soft CTA (inclusive)
    insert.run("ip-9", today, 9);    // soft only
    insert.run("ip-10", today, 10);  // at strong CTA (inclusive)
    insert.run("ip-14", today, 14);  // strong only
    insert.run("ip-15", today, 15);  // at hard limit (inclusive)
    insert.run("ip-20", today, 20);  // past hard limit

    const db = d1Shim(sqlite) as Parameters<typeof buildMcpTrafficStats>[0];
    const stats = await buildMcpTrafficStats(db);

    // soft CTA threshold (≥5): 5, 9, 10, 14, 15, 20 = 6 IPs
    expect(stats.today.ips_at_soft_cta).toBe(6);
    // strong CTA threshold (≥10): 10, 14, 15, 20 = 4 IPs
    expect(stats.today.ips_at_strong_cta).toBe(4);
    // hard limit threshold (≥15): 15, 20 = 2 IPs
    expect(stats.today.ips_at_hard_limit).toBe(2);

    expect(stats.today.unique_ips).toBe(7);
    expect(stats.today.calls).toBe(4 + 5 + 9 + 10 + 14 + 15 + 20);
  });

  test("multi-day aggregates correctly in last_7d", async () => {
    // Soft CTA threshold = 5 (tightened from 41 in 2026 to drive signups).
    // count=4 sits below; count≥5 trips the CTA bucket.
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const insert = sqlite.query(
      `INSERT INTO mcp_rate_limits (ip, date, count) VALUES (?, ?, ?)`
    );
    // Today and 5 prior days within window
    insert.run("a", utcOffset(0), 2);
    insert.run("b", utcOffset(0), 8);    // soft-CTA hitter today (≥5)
    insert.run("a", utcOffset(-1), 1);
    insert.run("c", utcOffset(-1), 6);   // distinct soft-CTA hitter yesterday
    insert.run("d", utcOffset(-3), 25);  // max-daily candidate
    // Outside the 7d window (8 days back) — must NOT count
    insert.run("e", utcOffset(-8), 999);

    const db = d1Shim(sqlite) as Parameters<typeof buildMcpTrafficStats>[0];
    const stats = await buildMcpTrafficStats(db);

    // Today: a + b = 10 calls, 2 unique IPs
    expect(stats.today.calls).toBe(10);
    expect(stats.today.unique_ips).toBe(2);
    expect(stats.today.ips_at_soft_cta).toBe(1); // only b (8 ≥ 5)
    // 7d totals exclude the 8-days-back row
    expect(stats.last_7d.calls).toBe(2 + 8 + 1 + 6 + 25);
    // max_daily_calls: 25 (day -3, single row)
    expect(stats.last_7d.max_daily_calls).toBe(25);
    // Distinct soft-CTA IPs: b (today, 8), c (-1, 6), d (-3, 25) = 3
    expect(stats.last_7d.ips_that_hit_soft_cta_in_7d).toBe(3);
    // unique_ips_per_day_avg over 7 days: 3 observed days have ips 2,2,1,
    //   total ips_sum=5, divided by 7 calendar days → round(0.71...) = 1
    expect(stats.last_7d.unique_ips_per_day_avg).toBe(1);
    // Window boundaries
    expect(stats.last_7d.to_date).toBe(utcToday());
    expect(stats.last_7d.from_date).toBe(utcOffset(-6));
  });

  test("missing mcp_rate_limits table → throws (handler catches)", async () => {
    const sqlite = new Database(":memory:");
    // No setupSchema — table doesn't exist
    const db = d1Shim(sqlite) as Parameters<typeof buildMcpTrafficStats>[0];
    await expect(buildMcpTrafficStats(db)).rejects.toThrow();
  });
});

// ── buildAuditTrafficStats (mirrors MCP) ─────────────────────────────────

describe("buildAuditTrafficStats", () => {
  test("empty table → all zeros", async () => {
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const db = d1Shim(sqlite) as Parameters<typeof buildAuditTrafficStats>[0];

    const stats = await buildAuditTrafficStats(db);
    expect(stats.today.calls).toBe(0);
    expect(stats.today.unique_ips).toBe(0);
    expect(stats.today.ips_at_soft_cta).toBe(0);
    expect(stats.today.ips_at_strong_cta).toBe(0);
    expect(stats.today.ips_at_hard_limit).toBe(0);
    expect(stats.today.date).toBe(utcToday());
  });

  test("traffic at threshold edges — 4/5/10/15", async () => {
    // Audit thresholds: soft=5, strong=10, hard=15 (tightened from 41/81/100).
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const today = utcToday();
    const insert = sqlite.query(
      `INSERT INTO audit_rate_limits (ip, date, count) VALUES (?, ?, ?)`
    );
    insert.run("ip-4", today, 4);    // below soft
    insert.run("ip-5", today, 5);    // at soft (inclusive)
    insert.run("ip-10", today, 10);  // at strong (inclusive)
    insert.run("ip-15", today, 15);  // at hard (inclusive of soft/strong/hard)
    insert.run("ip-16", today, 16);  // beyond hard

    const db = d1Shim(sqlite) as Parameters<typeof buildAuditTrafficStats>[0];
    const stats = await buildAuditTrafficStats(db);

    expect(stats.today.calls).toBe(4 + 5 + 10 + 15 + 16);
    expect(stats.today.unique_ips).toBe(5);
    expect(stats.today.ips_at_soft_cta).toBe(4);     // 5, 10, 15, 16
    expect(stats.today.ips_at_strong_cta).toBe(3);   // 10, 15, 16
    expect(stats.today.ips_at_hard_limit).toBe(2);   // 15, 16
  });

  test("audit and mcp counters are independent", async () => {
    // Per-channel budgets — heavy MCP user shouldn't lock out CLI, and v.v.
    // Soft threshold = 5; we use audit=2 (well below) to confirm no leak from
    // the mcp side where the same IP is past strong-CTA (count=12).
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const today = utcToday();
    sqlite
      .query(`INSERT INTO mcp_rate_limits (ip, date, count) VALUES (?, ?, ?)`)
      .run("shared-ip", today, 12); // heavy MCP (≥strong)
    sqlite
      .query(`INSERT INTO audit_rate_limits (ip, date, count) VALUES (?, ?, ?)`)
      .run("shared-ip", today, 2); // light audit (below soft)

    const db = d1Shim(sqlite) as Parameters<typeof buildAuditTrafficStats>[0];
    const auditStats = await buildAuditTrafficStats(db);
    expect(auditStats.today.calls).toBe(2);
    expect(auditStats.today.ips_at_soft_cta).toBe(0);

    const mcpStats = await buildMcpTrafficStats(db);
    expect(mcpStats.today.calls).toBe(12);
    expect(mcpStats.today.ips_at_strong_cta).toBe(1);
  });

  test("missing audit_rate_limits table → throws (handler catches)", async () => {
    const sqlite = new Database(":memory:");
    // No setupSchema — table doesn't exist
    const db = d1Shim(sqlite) as Parameters<typeof buildAuditTrafficStats>[0];
    await expect(buildAuditTrafficStats(db)).rejects.toThrow();
  });
});

// ── buildOrganicMcpKeyStats ──────────────────────────────────────────────

describe("buildOrganicMcpKeyStats", () => {
  test("no mcp-soft-cta keys → zeros", async () => {
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    sqlite
      .query(`INSERT INTO api_keys (id, email, source) VALUES ('k1', 'web@user.com', 'web')`)
      .run();
    const db = d1Shim(sqlite) as Parameters<typeof buildOrganicMcpKeyStats>[0];
    const stats = await buildOrganicMcpKeyStats(db, undefined);
    expect(stats.total_with_source_mcp).toBe(0);
    expect(stats.organic).toBe(0);
    expect(stats.internal_test).toBe(0);
  });

  test("mix of internal + organic with default patterns", async () => {
    // 2026-06-13 expansion: the defaults widened from +alias-only patterns to
    // full-domain wildcards on operator-owned domains. Plain pico@, hakon@,
    // *@getcommit.dev, *@pico.amdal.dev, *@example.invalid all now correctly
    // classify as internal_test. hawkaamdal@gmail.com is the one third-party
    // literal — gmail.com cannot be wildcarded (rate-limit bypass vector).
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    const insert = sqlite.query(
      `INSERT INTO api_keys (id, email, source) VALUES (?, ?, 'mcp-soft-cta')`
    );
    insert.run("k1", "pico+test1@amdal.dev");                 // internal (*@amdal.dev)
    insert.run("k2", "hawkaa+probe@amdal.dev");               // internal (*@amdal.dev)
    insert.run("k3", "test-evaluator-probe@example.com");     // internal (*@example.com)
    insert.run("k4", "real-user@stranger.com");               // organic
    insert.run("k5", "pico+spoof@evil.com");                  // organic — cross-domain spoof
                                                              // would have leaked as internal
                                                              // under the old `pico+*@*` pattern
    insert.run("k6", "pico@amdal.dev");                       // internal — plain @amdal.dev
                                                              // (would have been organic under
                                                              // the old +alias-only patterns)
    insert.run("k7", "hawkaamdal@gmail.com");                 // internal — literal Håkon Gmail
    insert.run("k8", "noreply@getcommit.dev");                // internal — Håkon-owned domain
    insert.run("k9", "anyone@example.invalid");               // internal — RFC 2606 reserved
    insert.run("k10", "hakon.dogfood-test-123@protonmail.com"); // internal — hakon*@protonmail.com

    const db = d1Shim(sqlite) as Parameters<typeof buildOrganicMcpKeyStats>[0];
    const stats = await buildOrganicMcpKeyStats(db, undefined);

    expect(stats.total_with_source_mcp).toBe(10);
    expect(stats.internal_test).toBe(8);
    expect(stats.organic).toBe(2); // k4 stranger.com + k5 evil.com
    expect(stats.internal_test_patterns).toEqual([
      "*@amdal.dev",
      "*@pico.amdal.dev",
      "*@getcommit.dev",
      "*@hawkaa.net",
      "*@example.com",
      "*@example.invalid",
      "hawkaamdal@gmail.com",
      "hawkaa+commit-tier-verify@gmail.com",
      "hawkaa+mcp-test@gmail.com",
      "hakon@test.com",
      "test@test.com",
      "hakon*@protonmail.com",
    ]);
  });

  test("custom patterns override defaults", async () => {
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    sqlite
      .query(
        `INSERT INTO api_keys (id, email, source) VALUES ('k1', 'pico+x@y.z', 'mcp-soft-cta')`
      )
      .run();
    sqlite
      .query(
        `INSERT INTO api_keys (id, email, source) VALUES ('k2', 'special@brand.com', 'mcp-soft-cta')`
      )
      .run();

    const db = d1Shim(sqlite) as Parameters<typeof buildOrganicMcpKeyStats>[0];
    // Custom env var matches only special@brand.com — so pico+ is now ORGANIC.
    const stats = await buildOrganicMcpKeyStats(db, "special@brand.com");
    expect(stats.internal_test).toBe(1);
    expect(stats.organic).toBe(1);
    expect(stats.internal_test_patterns).toEqual(["special@brand.com"]);
  });

  test("revoked keys excluded", async () => {
    const sqlite = new Database(":memory:");
    setupSchema(sqlite);
    sqlite
      .query(
        `INSERT INTO api_keys (id, email, source, revoked_at) VALUES ('k1', 'real@user.com', 'mcp-soft-cta', '2026-01-01T00:00:00Z')`
      )
      .run();
    sqlite
      .query(
        `INSERT INTO api_keys (id, email, source) VALUES ('k2', 'other@user.com', 'mcp-soft-cta')`
      )
      .run();
    const db = d1Shim(sqlite) as Parameters<typeof buildOrganicMcpKeyStats>[0];
    const stats = await buildOrganicMcpKeyStats(db, undefined);
    expect(stats.total_with_source_mcp).toBe(1); // k1 excluded
    expect(stats.organic).toBe(1);
  });

  test("DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS matches wrangler.toml default", () => {
    // Guardrail: the default constant in worker.ts and the default in
    // wrangler.toml must stay in sync, otherwise a missing env var binding
    // silently flips ALL internal keys into the "organic" bucket.
    // Domain-anchored — every wildcard pattern targets an operator-owned or
    // RFC 2606 reserved domain. The single gmail.com entry is a LITERAL —
    // wildcarding gmail.com would open the /api/keys/create rate-limit bypass
    // to any attacker with a Gmail account. hakon*@protonmail.com is local-part
    // anchored (only "hakon..." prefix) — protonmail.com as a domain stays open.
    expect(DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS).toBe(
      "*@amdal.dev,*@pico.amdal.dev,*@getcommit.dev,*@hawkaa.net,*@example.com,*@example.invalid,hawkaamdal@gmail.com,hawkaa+commit-tier-verify@gmail.com,hawkaa+mcp-test@gmail.com,hakon@test.com,test@test.com,hakon*@protonmail.com"
    );
  });

  test("default pattern rejects cross-domain spoofs but accepts all operator-owned addresses", () => {
    // Two properties this test pins:
    //   (1) wildcards never apply to third-party domains (no @evil.com /
    //       @gmail.com spoof can claim internal-test status and bypass
    //       /api/keys/create rate-limit)
    //   (2) plain (non-+aliased) operator-owned addresses DO classify as
    //       internal — closes the 2026-06-13 gap where pico@amdal.dev and
    //       hawkaamdal@gmail.com were leaking into the "organic" count.
    const pats = parseEmailPatterns(DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS);
    // Operator-owned, +aliased — must still match (was the only path that worked before)
    expect(isInternalTestEmail("pico+dogfood@amdal.dev", pats)).toBe(true);
    expect(isInternalTestEmail("hawkaa+test@amdal.dev", pats)).toBe(true);
    // Operator-owned, plain — new positive coverage (was leaking as organic)
    expect(isInternalTestEmail("pico@amdal.dev", pats)).toBe(true);
    expect(isInternalTestEmail("hakon@amdal.dev", pats)).toBe(true);
    expect(isInternalTestEmail("hawkaamdal@gmail.com", pats)).toBe(true);
    expect(isInternalTestEmail("noreply@getcommit.dev", pats)).toBe(true);
    expect(isInternalTestEmail("anything@pico.amdal.dev", pats)).toBe(true);
    expect(isInternalTestEmail("anyone@example.invalid", pats)).toBe(true);
    // Protonmail dogfood — hakon-prefixed matches, others don't
    expect(isInternalTestEmail("hakon.dogfood-test-123@protonmail.com", pats)).toBe(true);
    expect(isInternalTestEmail("hakon@protonmail.com", pats)).toBe(true);
    expect(isInternalTestEmail("realuser@protonmail.com", pats)).toBe(false);
    // Cross-domain spoof — must NOT match (rate-limit bypass guard)
    expect(isInternalTestEmail("pico+x@evil.com", pats)).toBe(false);
    expect(isInternalTestEmail("pico+anything@gmail.com", pats)).toBe(false);
    expect(isInternalTestEmail("hawkaa+x@evil.com", pats)).toBe(false);
    expect(isInternalTestEmail("attacker@gmail.com", pats)).toBe(false);
    // Cousin-domain spoofs — must NOT match (no prefix/suffix wildcard creep)
    expect(isInternalTestEmail("anyone@amdal.dev.evil.com", pats)).toBe(false);
    expect(isInternalTestEmail("anyone@notamdal.dev", pats)).toBe(false);
  });

  test("missing api_keys table → empty stats, no throw", async () => {
    const sqlite = new Database(":memory:");
    // intentionally no setupSchema
    const db = d1Shim(sqlite) as Parameters<typeof buildOrganicMcpKeyStats>[0];
    const stats = await buildOrganicMcpKeyStats(db, undefined);
    expect(stats.total_with_source_mcp).toBe(0);
    expect(stats.organic).toBe(0);
    expect(stats.internal_test).toBe(0);
  });
});

// ── resolveApiKey countAsRequest / READ_ONLY_KEY_PATHS ──────────────────
//
// 2026-06-03: Metadata routes (/api/keys/usage) must NOT burn a user's daily
// quota or 429 them on a self-inspection call. Pre-fix dogfood reproduced the
// bug live (1 audit + 2 usage checks → counter showed 3). Lock the contract:
// (a) read-only paths are declared on a single source of truth,
// (b) resolveApiKey with countAsRequest=false skips both increment + 429 gate,
// (c) regular paths still count.

describe("READ_ONLY_KEY_PATHS", () => {
  test("/api/keys/usage is exempt", () => {
    expect(READ_ONLY_KEY_PATHS.has("/api/keys/usage")).toBe(true);
  });
  test("/api/audit is NOT exempt — audit must count", () => {
    expect(READ_ONLY_KEY_PATHS.has("/api/audit")).toBe(false);
  });
  test("/api/keys/create is NOT exempt — create is unauthenticated anyway", () => {
    // Belt-and-suspenders: create runs as POST without Bearer, so the
    // middleware path never reaches resolveApiKey. The set should still not
    // accidentally exempt it (would be a foot-gun if create ever became authed).
    expect(READ_ONLY_KEY_PATHS.has("/api/keys/create")).toBe(false);
  });
});

function setupApiKeysSchemaForResolve(db: Database) {
  // Mirrors the production schema for the columns resolveApiKey reads/writes.
  db.exec(`
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL,
      key_prefix TEXT,
      email TEXT,
      tier TEXT,
      requests_this_period INTEGER NOT NULL DEFAULT 0,
      period_reset_at TEXT,
      source TEXT NOT NULL DEFAULT 'web',
      revoked_at TEXT,
      created_at TEXT,
      last_used_at TEXT
    );
  `);
}

// SHA-256 hex (Node + bun:sqlite path — production worker uses crypto.subtle).
// Mirrored here so test fixtures can pre-seed key_hash without touching the worker.
import { createHash } from "node:crypto";
function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("resolveApiKey countAsRequest", () => {
  const key = "sk_commit_test_metadata_path_0123456789abcdef";
  const keyHash = sha256Hex(key);
  const futureReset = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  test("countAsRequest=false: does NOT increment requests_this_period", async () => {
    const sqlite = new Database(":memory:");
    setupApiKeysSchemaForResolve(sqlite);
    sqlite.query(
      `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, created_at)
       VALUES ('k1', ?, 'sk_commit_test', 'u@x.co', 'free', 42, ?, datetime('now'))`
    ).run(keyHash, futureReset);
    const db = d1Shim(sqlite) as Parameters<typeof resolveApiKey>[0];

    await resolveApiKey(db, `Bearer ${key}`, false);

    const row = sqlite
      .query(`SELECT requests_this_period, last_used_at FROM api_keys WHERE id='k1'`)
      .get() as { requests_this_period: number; last_used_at: string | null };
    expect(row.requests_this_period).toBe(42); // unchanged
    expect(row.last_used_at).toBeNull(); // unchanged — metadata calls don't bump activity
  });

  test("countAsRequest=true (default): DOES increment requests_this_period", async () => {
    const sqlite = new Database(":memory:");
    setupApiKeysSchemaForResolve(sqlite);
    sqlite.query(
      `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, created_at)
       VALUES ('k2', ?, 'sk_commit_test', 'u@x.co', 'free', 42, ?, datetime('now'))`
    ).run(keyHash, futureReset);
    const db = d1Shim(sqlite) as Parameters<typeof resolveApiKey>[0];

    await resolveApiKey(db, `Bearer ${key}`);

    const row = sqlite
      .query(`SELECT requests_this_period FROM api_keys WHERE id='k2'`)
      .get() as { requests_this_period: number };
    expect(row.requests_this_period).toBe(43); // +1
  });

  test("countAsRequest=false: bypasses 429 over-limit gate", async () => {
    // A user who's at the limit should still be able to check /api/keys/usage
    // to see why they're 429'd. If the metadata call itself 429s, the dashboard
    // breaks at exactly the moment the user needs it most.
    const sqlite = new Database(":memory:");
    setupApiKeysSchemaForResolve(sqlite);
    sqlite.query(
      `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, created_at)
       VALUES ('k3', ?, 'sk_commit_test', 'u@x.co', 'free', 200, ?, datetime('now'))`
    ).run(keyHash, futureReset);
    const db = d1Shim(sqlite) as Parameters<typeof resolveApiKey>[0];

    const result = await resolveApiKey(db, `Bearer ${key}`, false);
    expect(result.error).toBeUndefined();
    expect(result.key?.requests_this_period).toBe(200);
  });

  test("countAsRequest=true at-limit: returns 429 (regression guard)", async () => {
    // Sanity check the gate still triggers for normal (counting) paths.
    const sqlite = new Database(":memory:");
    setupApiKeysSchemaForResolve(sqlite);
    sqlite.query(
      `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, created_at)
       VALUES ('k4', ?, 'sk_commit_test', 'u@x.co', 'free', 200, ?, datetime('now'))`
    ).run(keyHash, futureReset);
    const db = d1Shim(sqlite) as Parameters<typeof resolveApiKey>[0];

    const result = await resolveApiKey(db, `Bearer ${key}`);
    expect(result.error?.status).toBe(429);
  });
});
