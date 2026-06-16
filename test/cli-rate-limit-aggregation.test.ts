/**
 * CLI rate-limit aggregation across parallel batches.
 *
 * What this pins
 * ──────────────
 * When the CLI fans out a lockfile scan into 17 parallel /api/audit
 * batches and the user's IP is in overshoot (anonymous + past
 * AUDIT_HARD_LIMIT), the backend returns 429 with RATE_LIMIT_TASTE=3
 * packages_already_scored on EVERY batch (each batch increments the IP
 * counter independently, all see auditCount > limit). The CLI must
 * aggregate those 3-package partials across batches and surface ONE
 * rescue CTA — not let the first 429 to land call handle429() and
 * process.exit(1) while discarding the other 16 batches' 3-package
 * partials each (16×3=48 packages of backend-scored value silently lost).
 *
 * Why this exists
 * ───────────────
 * Pre-fix (2026-06-16 dogfood): poc --file commit-landing-v2/package-lock.json
 * with no API key on a quota-exhausted IP showed 3 packages and "Partial
 * results scored before the limit hit (3)". The backend did 17×3=51
 * packages of work; the user saw 3. Variance across reruns came from
 * race conditions in which batch's 429 won the await race, not from
 * non-deterministic scoring.
 *
 * Post-fix: same scan shows 51 packages aggregated across all batches,
 * with ONE rescue message reflecting actual user-visible scope ("Scored
 * 51 of 326 packages") instead of one batch's slice ("Scored 3 of 20").
 *
 * What we don't want
 * ──────────────────
 * - Promise.all in auditBatched: it rejects on first 429 and the other
 *   batches' resolved values are GC'd. Must use Promise.allSettled.
 * - The first batch's 429 calling handle429() inline: discards aggregates.
 * - The main scan path losing _rescue: aggregated table without rescue
 *   CTA leaves users wondering why they only saw partial data.
 * - inlineSignup() running before/around renderRescueCta: rescue CTA
 *   itself prompts for email in TTY (free tier path); inlineSignup is a
 *   different flow targeted at full successful scans.
 *
 * Source-level (no harness): the CLI is a single-file ESM script with
 * TLA; mocking 17 parallel HTTP responses adds harness debt for what is
 * fundamentally control-flow contract pinning. Text-level pinning matches
 * the pattern in cli-critical-concentration.test.ts.
 *
 * Run: bun test test/cli-rate-limit-aggregation.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const CLI_SOURCE = readFileSync(
  join(import.meta.dir, "..", "npm-package", "index.js"),
  "utf-8",
);

describe("renderRescueCta helper extraction", () => {
  test("renderRescueCta function exists and takes parsed `data` (not Response)", () => {
    expect(CLI_SOURCE).toMatch(/async function\s+renderRescueCta\s*\(\s*data\s*\)/);
  });

  test("handle429 still delegates to renderRescueCta after printing partial table", () => {
    // handle429 owns the single-response partial-table block; renderRescueCta
    // is the shared rescue-CTA body. Split lets auditBatched call
    // renderRescueCta directly with aggregated state.
    const block =
      CLI_SOURCE.match(/async function handle429\(res\)\s*\{[\s\S]{0,1500}?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/await renderRescueCta\(data\)/);
    expect(block).toMatch(/Partial results scored before the limit hit/);
  });

  test("renderRescueCta still process.exit(1)s at the tail (contract preserved)", () => {
    // Capture renderRescueCta's body — runs until the next top-level `async function`
    // declaration (handle429 → renderRescueCta is the last 429 helper before
    // hasCritical/auditBatched et al).
    const block =
      CLI_SOURCE.match(/async function renderRescueCta\(data\)\s*\{[\s\S]+?\n\}\n/)?.[0] ?? "";
    // Multiple process.exit(1) branches inside (keyUpgrade, overshoot, plus
    // the catch-all at function tail).
    const exits = block.match(/process\.exit\(1\)/g) || [];
    expect(exits.length).toBeGreaterThanOrEqual(3);
  });
});

describe("auditBatched aggregates 200 + 429 partials across parallel batches", () => {
  test("uses Promise.allSettled (not Promise.all) — first 429 must not discard the rest", () => {
    const block =
      CLI_SOURCE.match(/async function auditBatched[\s\S]{0,5000}?\n\}\n/)?.[0] ?? "";
    expect(block).toMatch(/Promise\.allSettled/);
    // Negative: bare Promise.all on the batches.map call MUST NOT be present
    // in auditBatched (the call site this test pins).
    expect(block).not.toMatch(/await Promise\.all\(\s*\n?\s*batches\.map/);
  });

  test("batch promise resolves with {kind, data} instead of throwing — keeps 429s aggregable", () => {
    const block =
      CLI_SOURCE.match(/async function auditBatched[\s\S]{0,5000}?\n\}\n/)?.[0] ?? "";
    expect(block).toMatch(/kind:\s*['"]429['"]/);
    expect(block).toMatch(/kind:\s*['"]ok['"]/);
    // The batch handler must NOT call handle429 inline (that's what
    // discarded the other batches' partials pre-fix via process.exit(1)).
    expect(block).not.toMatch(/await handle429\(res\)/);
  });

  test("aggregates packages_already_scored from 429s + results from 200s", () => {
    const block =
      CLI_SOURCE.match(/async function auditBatched[\s\S]{0,5000}?\n\}\n/)?.[0] ?? "";
    expect(block).toMatch(/packages_already_scored/);
    expect(block).toMatch(/v\.data\.results/);
  });

  test("returns _rescue when any batch hit 429 — caller renders CTA, not the batch handler", () => {
    const block =
      CLI_SOURCE.match(/async function auditBatched[\s\S]{0,5000}?\n\}\n/)?.[0] ?? "";
    expect(block).toMatch(/_rescue:\s*rescue/);
    // The rescue payload comes from the FIRST 429 (later 429s carry
    // interchangeable overshoot/upgrade context, no merging needed).
    expect(block).toMatch(/if \(!rescue\) rescue = v\.data/);
  });

  test("dedupes by name+ecosystem — defensive against backend echoing the same pkg from two batches", () => {
    const block =
      CLI_SOURCE.match(/async function auditBatched[\s\S]{0,5000}?\n\}\n/)?.[0] ?? "";
    expect(block).toMatch(/seen\.has\(/);
    expect(block).toMatch(/\$\{[^}]*name\}:\$\{[^}]*ecosystem\}/);
  });

  test("hard-throws only when zero packages scored AND non-rate-limit error fired", () => {
    // If rescue is set, even with 0 aggregated, the caller surfaces the
    // rescue CTA — no need to throw. Throwing would land in the parent
    // catch block which does process.exit(1) with just "Error: ..." and
    // hides the rescue.
    const block =
      CLI_SOURCE.match(/async function auditBatched[\s\S]{0,5000}?\n\}\n/)?.[0] ?? "";
    expect(block).toMatch(/aggregated\.length === 0 && !rescue && nonRateErrorMsg/);
  });
});

describe("main scan path surfaces aggregated rescue exactly once", () => {
  test("captures batchResult._rescue into batchRescue", () => {
    expect(CLI_SOURCE).toMatch(/batchRescue\s*=\s*batchResult\._rescue/);
  });

  test("aggregate-aware rescue message references full user-requested count, not per-batch slice", () => {
    // Pre-fix message was "Scored 3 of 20 packages" — referenced one batch's
    // packages.length on the BACKEND side. Post-fix overrides with CLI-side
    // ${allResults.length} of ${packages.length} so the user sees the scope
    // they actually requested.
    expect(CLI_SOURCE).toMatch(/Scored \$\{allResults\.length\} of \$\{packages\.length\} packages/);
  });

  test("renders rescue BEFORE inlineSignup — rescue CTA owns the free-tier signup prompt", () => {
    // Both paths can prompt for email; running both would double-prompt.
    // renderRescueCta exits 1 at tail, so it short-circuits inlineSignup.
    const block =
      CLI_SOURCE.match(/printTable\(displayed,\s*\{[\s\S]{0,2000}?(inlineSignup\(displayed[\s\S]{0,200})/)?.[1] ?? "";
    // Find the rescue branch within the same lockfile-render block
    const fullBlock =
      CLI_SOURCE.match(/printTable\(displayed,\s*\{[\s\S]{0,3000}?inlineSignup\(displayed[\s\S]{0,400}/)?.[0] ?? "";
    const rescueIdx = fullBlock.indexOf("renderRescueCta(rescueWithAggregate)");
    const signupIdx = fullBlock.indexOf("inlineSignup(displayed");
    expect(rescueIdx).toBeGreaterThan(0);
    expect(signupIdx).toBeGreaterThan(rescueIdx);
  });

  test("jsonOutput surfaces rateLimited:true so non-TTY consumers can detect partial scans", () => {
    // CI/automation consumers piping --json need a structured signal that
    // the scan was aggregated-partial, not full. Without this, "criticalCount
    // 28" would look like a clean full-scan answer to a downstream gate.
    expect(CLI_SOURCE).toMatch(/rateLimited:\s*!!batchRescue/);
  });
});
