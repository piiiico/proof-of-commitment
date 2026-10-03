// 2026-09-27 watchlist digest printed "axios 65/100 (-24) 1p ?/wk ✓ OK": the npm
// download fetch failed, `recentWeeklyDownloads ?? 0` fed the CRITICAL check, and
// the flag silently fell to OK. A failed fetch must read UNKNOWN, never OK.
import { test, expect } from "bun:test";
import { digestRiskFlags, digestFlagLabel, flagWeeklyDownloads } from "../src/backend/npm.ts";

const axios = { versionCount: 110, ageYears: 11, activePublisherCount: 1, maintainerCount: 1, daysSinceLastPublish: 10 };

test("failed download fetch (0 on a mature package) reads UNKNOWN, not OK", () => {
  const flags = digestRiskFlags({ ...axios, recentWeeklyDownloads: 0 });
  expect(flags).toContain("UNKNOWN");
  expect(flags).not.toContain("CRITICAL");
  expect(digestFlagLabel(flags, 65)).toBe("? UNKNOWN");
  expect(flagWeeklyDownloads({ ...axios, recentWeeklyDownloads: 0 })).toBeNull();
});

test("live downloads keep CRITICAL (positive control)", () => {
  const flags = digestRiskFlags({ ...axios, recentWeeklyDownloads: 139_000_000 });
  expect(flags).toEqual(["CRITICAL"]);
  expect(digestFlagLabel(flags, 87)).toBe("⚑ CRITICAL");
});

test("young package with real 0 downloads stays a normal row", () => {
  const p = { ...axios, versionCount: 3, ageYears: 0.2, recentWeeklyDownloads: 0 };
  expect(flagWeeklyDownloads(p)).toBe(0);
  expect(digestFlagLabel(digestRiskFlags(p), 40)).toBe("✓ OK");
});

test("unknown downloads still carry WARN for a stale package", () => {
  const flags = digestRiskFlags({ ...axios, recentWeeklyDownloads: 0, daysSinceLastPublish: 400 });
  expect(flags).toEqual(["UNKNOWN", "WARN"]);
  expect(digestFlagLabel(flags, 50)).toBe("? UNKNOWN");
});

test("absent downloads (null/undefined fetch result) read UNKNOWN, never 0", () => {
  for (const w of [null, undefined, NaN]) {
    expect(flagWeeklyDownloads({ ...axios, recentWeeklyDownloads: w as any })).toBeNull();
    expect(digestRiskFlags({ ...axios, recentWeeklyDownloads: w as any })).toContain("UNKNOWN");
  }
});
