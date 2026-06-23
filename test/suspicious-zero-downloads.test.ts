/**
 * isSuspiciouslyZeroDownloads — fetch-failure detection for the audit response.
 *
 * Why this matters
 * ────────────────
 * 2026-06-23 dogfood, first batch of an audit-page session:
 *
 *   POST /api/audit { packages: [express, axios, lodash, chalk, zod, react,
 *                                next, webpack, typescript, tailwindcss] }
 *   → response: weeklyDownloads=0 for EVERY package, no CRITICAL flags
 *     (wdl>10M gate failed), scores 50-72 (downloadMomentum=0 component)
 *
 *   Subsequent same-IP calls (single and partial batches): correct data,
 *   tens-of-millions weekly each, CRITICAL flags surfacing as expected.
 *
 * Root cause is the documented CF colo cache poisoning path: npm responds
 * with Cache-Control: public,max-age=300, so one degraded npm-edge response
 * sticks to the colo for ~5 min and defeats bulk + per-package rescue +
 * slow-path retry because they all hit the same colo. Existing resilience
 * (bulkFetchNpmWeeklyDownloads rescue pass + slow-path range/point retries
 * with cacheTtl:0) is necessary but insufficient when the npm-side cache
 * itself is the broken layer.
 *
 * What this gate adds
 * ───────────────────
 * Cheap, deterministic post-hoc detection. A mature, multi-version package
 * essentially never has literal 0 downloads — even unmaintained ones get
 * legacy installs. So weeklyDownloads=0 + versionCount>=30 + ageYears>=1
 * means "fetch failed", not "no traffic". The /api/audit handler reports
 * null instead of 0 in that case, and surfaces downloadDataMissing: true
 * so the UI can render "—" with a discreet retry affordance instead of a
 * confident-but-wrong "0/wk" cell.
 *
 * Why this is the right level
 * ───────────────────────────
 * - Stable cache LKG (caches.default keyed by package name, 7d TTL) would
 *   serve more useful data but adds a new cache shape, write paths to keep
 *   coherent, and a separate poisoning surface.
 * - Re-routing through a different data source (jsdelivr, npms.io) adds an
 *   external dependency and only covers a subset of npm.
 * - This gate is one pure function, zero runtime cost on the happy path
 *   (just a comparison), and stops the lying immediately.
 *
 * Run: bun test test/suspicious-zero-downloads.test.ts
 */

import { describe, expect, test } from "bun:test";
import { isSuspiciouslyZeroDownloads } from "../src/backend/npm.ts";

describe("isSuspiciouslyZeroDownloads — fetch-failure detection gate", () => {
  test("fires on a popular mature package with 0 downloads (the bug case)", () => {
    // axios on a poisoned colo: 100+ versions, 11+ years old, real downloads
    // ~125M/wk — but the fetch returned 0.
    expect(isSuspiciouslyZeroDownloads(0, 250, 11.8)).toBe(true);
  });

  test("fires on the full 2026-06-23 batch profile", () => {
    // express (200+ versions, 15.5y), lodash (300+ versions, 14.2y),
    // chalk (150+ versions, 12.9y), react (700+ versions, 14.7y) — all came
    // back as 0/wk on the same first request.
    expect(isSuspiciouslyZeroDownloads(0, 200, 15.5)).toBe(true);
    expect(isSuspiciouslyZeroDownloads(0, 300, 14.2)).toBe(true);
    expect(isSuspiciouslyZeroDownloads(0, 150, 12.9)).toBe(true);
    expect(isSuspiciouslyZeroDownloads(0, 700, 14.7)).toBe(true);
  });

  test("does NOT fire when downloads are positive (the normal case)", () => {
    expect(isSuspiciouslyZeroDownloads(161_340_389, 300, 14.2)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(50, 200, 5)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(1, 100, 2)).toBe(false);
  });

  test("does NOT fire on a young package (could legitimately be 0)", () => {
    // 6 months old, 5 versions, 0 downloads — plausibly real (just-launched
    // experimental package). Don't mask, even if the result is unflattering.
    expect(isSuspiciouslyZeroDownloads(0, 5, 0.5)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(0, 50, 0.5)).toBe(false);
  });

  test("does NOT fire on a sparsely-versioned package (legitimately niche)", () => {
    // 5 years old but only 12 versions, 0 downloads — probably abandoned
    // early or never gained traction. Real zero, not a fetch bug.
    expect(isSuspiciouslyZeroDownloads(0, 12, 5)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(0, 29, 3)).toBe(false);
  });

  test("does NOT fire on null/undefined downloads (already handled upstream)", () => {
    // The gate is for the 0 case specifically. null/undefined is the
    // already-surfaced "data unavailable" path; passing through is correct.
    expect(isSuspiciouslyZeroDownloads(null, 200, 10)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(undefined, 200, 10)).toBe(false);
  });

  test("handles missing companion fields gracefully", () => {
    // If versionCount or ageYears didn't make it into the profile (some
    // failure paths leave them as null), don't fire the gate — we don't
    // have enough signal to call it suspicious.
    expect(isSuspiciouslyZeroDownloads(0, null, 10)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(0, 200, null)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(0, undefined, undefined)).toBe(false);
  });

  test("threshold boundary cases", () => {
    // Right at the threshold values — should fire.
    expect(isSuspiciouslyZeroDownloads(0, 30, 1)).toBe(true);
    // Just below either threshold — should NOT fire.
    expect(isSuspiciouslyZeroDownloads(0, 29, 1)).toBe(false);
    expect(isSuspiciouslyZeroDownloads(0, 30, 0.99)).toBe(false);
  });
});
