/**
 * CLI critical-concentration footer reframe — printTable activation lever.
 *
 * What this pins
 * ──────────────
 * When a lockfile audit returns a CRITICAL count that exceeds 20% of the
 * scanned tree, printTable() must replace the per-package alarm framing
 * ("⚠  157 CRITICAL packages found") with a calibration message that
 * (a) shows the ratio as a percentage, (b) acknowledges this as npm baseline
 * rather than user error, (c) gives a concrete next action (watch the top
 * 3-5 above, pin lockfile, audit deltas).
 *
 * Why this exists
 * ───────────────
 * Real npm projects routinely report 40–60% of scanned packages as CRITICAL
 * because the threshold (sole publisher + >10M wk DL) is structurally
 * widespread. Pre-fix, a new user dogfooding `poc --file package-lock.json`
 * on commit-landing-v2 (Astro project) saw "157 CRITICAL packages found"
 * with no calibration — observed activation killer (2026-06-16 dogfood
 * reflection). The high-density branch turns the noise into a usable signal.
 *
 * What we don't want
 * ──────────────────
 * The reframe must not fire on small scans (<10 packages) or on low-ratio
 * lockfile scans — the original alarm framing is correct when CRITICAL is
 * actually unusual.
 *
 * Source-level (no harness): the CLI is a single-file ESM script with TLA;
 * spinning it up with HTTP mocks to assert footer output adds harness debt
 * for what is fundamentally string drift. Text-level pinning is the same
 * pattern as cli-watch-cta-contract.test.ts and cli-soft-cta-gate.test.ts.
 *
 * Run: bun test test/cli-critical-concentration.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const CLI_SOURCE = readFileSync(
  join(import.meta.dir, "..", "npm-package", "index.js"),
  "utf-8",
);

describe("summarizeCriticalConcentration helper", () => {
  test("function exists and is named consistently with its consumer", () => {
    expect(CLI_SOURCE).toMatch(
      /function\s+summarizeCriticalConcentration\s*\(/,
    );
  });

  test("threshold is 20% (0.20) — pinned so a future tune is intentional", () => {
    const fnBlock =
      CLI_SOURCE.match(
        /function\s+summarizeCriticalConcentration\s*\([\s\S]{0,800}?\n\}/,
      )?.[0] ?? "";
    expect(fnBlock).toMatch(/<\s*0\.20/);
  });

  test("returns null on small totals (<10) — avoids reframing trivial scans", () => {
    const fnBlock =
      CLI_SOURCE.match(
        /function\s+summarizeCriticalConcentration\s*\([\s\S]{0,800}?\n\}/,
      )?.[0] ?? "";
    expect(fnBlock).toMatch(/totalScanned\s*<\s*10[\s\S]{0,40}return\s+null/);
  });

  test("returns null on zero/missing CRITICAL — avoids reframing healthy scans", () => {
    const fnBlock =
      CLI_SOURCE.match(
        /function\s+summarizeCriticalConcentration\s*\([\s\S]{0,800}?\n\}/,
      )?.[0] ?? "";
    expect(fnBlock).toMatch(
      /criticalCount\s*<=\s*0[\s\S]{0,40}return\s+null/,
    );
  });

  test("returns {ratio, percent, baseline} on activation — caller renders the recast", () => {
    const fnBlock =
      CLI_SOURCE.match(
        /function\s+summarizeCriticalConcentration\s*\([\s\S]{0,800}?\n\}/,
      )?.[0] ?? "";
    expect(fnBlock).toMatch(/ratio,/);
    expect(fnBlock).toMatch(/percent:/);
    expect(fnBlock).toMatch(/baseline:/);
  });
});

describe("printTable high-density footer", () => {
  test("printTable consumes summarizeCriticalConcentration when CRITICAL > 0", () => {
    // The helper is called in the footer branch — pin the call site so a
    // refactor doesn't accidentally drop the reframe.
    expect(CLI_SOURCE).toMatch(
      /summarizeCriticalConcentration\(effectiveCritical,\s*totalScanned\)/,
    );
  });

  test("recast headline shows percent + scanned total (not just the raw count)", () => {
    // The percent + ratio framing is the whole point — pin both pieces.
    expect(CLI_SOURCE).toMatch(/conc\.percent/);
    expect(CLI_SOURCE).toMatch(/totalScanned/);
  });

  test("recast copy frames the density as npm baseline (not user error)", () => {
    // The new copy must lead with the calibration insight, not alarm.
    // Source has `npm\'s baseline` (escaped single-quote inside a single-
    // quoted string literal); the runtime string is `npm's baseline`. Match
    // either with an optional escape, plus the curly-apostrophe variant.
    expect(CLI_SOURCE).toMatch(/npm(?:\\?['’])s baseline/);
  });

  test("recast copy ends on a concrete next action (top 3-5 + pin lockfile)", () => {
    // The user must leave with something to do, not a vague disclaimer.
    expect(CLI_SOURCE).toMatch(/top 3-5/);
    expect(CLI_SOURCE).toMatch(/pin your lockfile/);
  });

  test("low-density branch (original framing) preserved as fallback", () => {
    // Sub-20% ratios still get the old "X CRITICAL package(s) found" framing —
    // the reframe is opt-in via the helper, not a wholesale replacement.
    expect(CLI_SOURCE).toMatch(
      /CRITICAL package\$\{effectiveCritical\s*>\s*1\s*\?\s*['"]s['"]\s*:\s*['"]['"]\s*\}\s*found/,
    );
  });
});
