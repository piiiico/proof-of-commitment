/**
 * CLI engagementSignal + watchlist-seed proposition contract — npm-package@1.29.2+.
 *
 * 2026-06-11 v1.29.2 proposition shift:
 *   - Gate relaxed from `results.length < 3 && !hasFindings && !engagementSignal`
 *     to `results.length < 1` — single-package healthy scans (most common
 *     entry point, e.g. `npx proof-of-commitment axios` after reading about
 *     an attack) now see the prompt, because the watchlist auto-seed shipped
 *     earlier today (abe53f1) made single-package signups buy real value.
 *   - Heading rephrased from quota-wall ("Past the free anonymous quota —
 *     lift it to 200/day") to ongoing-value ("Auto-watch X. Email if
 *     attacked. Free."). Quota framing was friction-removal for a user
 *     already identified as security-engaged — wrong frame.
 *   - Subline rephrased from "Free, no card, 10 seconds. Saves to
 *     ~/.commit/config" (friction-only) to "Seeds your watchlist from
 *     this scan. 10s, no card" (value + friction).
 *
 * Diagnosis from 2026-06-10 /api/keys/stats dogfood: 4 IPs hit soft-CTA
 * in 7d, ZERO organic signups. Hypothesis: copy was quota-focused at
 * the moment the user was actually security-shopping.
 *
 * What this pins:
 *  1. inlineSignup accepts an `opts` parameter with `engagementSignal`.
 *  2. Gate fires for any TTY scan with ≥1 result (post-2026-06-11 contract).
 *  3. Both audit call sites pass `{ engagementSignal: !!apiCta }`.
 *  4. Heading copy leads with the auto-watch proposition (not the quota
 *     wall). engagementSignal path acknowledges repeated use; findings
 *     path acknowledges criticality; baseline path pitches ongoing value.
 *  5. Subline mentions watchlist seeding (the actual value of signup).
 *  6. Source attribution unchanged: engagement-signal-driven signups (no
 *     findings) post `source: 'cli-soft-cta'`; findings-driven prompts
 *     post `source: 'cli'`. Backend VALID_SOURCES still includes
 *     'cli-soft-cta'.
 *  7. Landing-page surface parity: get-started.astro HERO_BY_REF entry
 *     for 'audit-cli-soft-cta' echoes the same auto-watch framing.
 *
 * Plain-text source pinning. The CLI is a stand-alone Node script and the
 * worker is CF Workers TS — no shared runtime harness. The bug shape
 * (multi-file string drift) is exactly what a text-level invariant catches.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const CLI_SOURCE = readFileSync(
  join(import.meta.dir, "..", "npm-package", "index.js"),
  "utf-8",
);

const WORKER_SOURCE = readFileSync(
  join(import.meta.dir, "..", "src", "backend", "worker.ts"),
  "utf-8",
);

const GET_STARTED_SOURCE = readFileSync(
  join(
    import.meta.dir,
    "..",
    "..",
    "commit-landing-v2",
    "src",
    "pages",
    "get-started.astro",
  ),
  "utf-8",
);

describe("CLI inlineSignup gate + proposition copy (v1.29.2)", () => {
  test("inlineSignup signature accepts opts parameter", () => {
    expect(CLI_SOURCE).toContain(
      "async function inlineSignup(results, opts = {})",
    );
  });

  test("engagementSignal is destructured from opts", () => {
    expect(CLI_SOURCE).toContain("const engagementSignal = !!opts.engagementSignal;");
  });

  test("gate fires for any TTY scan with ≥1 result (relaxed v1.29.2)", () => {
    // Watchlist auto-seed (abe53f1) made single-package signups valuable.
    // Single-package healthy scans (most common entry point) now see the
    // prompt instead of dropping silently.
    expect(CLI_SOURCE).toContain("if (results.length < 1) return;");
    // Regression guard: old gates must not still exist verbatim.
    expect(CLI_SOURCE).not.toContain(
      "if (results.length < 3 && !hasFindings) return;",
    );
    expect(CLI_SOURCE).not.toContain(
      "if (results.length < 3 && !hasFindings && !engagementSignal) return;",
    );
  });

  test("heading rejects quota-wall framing (regression guard)", () => {
    // v1.28.0–v1.29.1 heading: "Past the free anonymous quota — lift it
    // to 200/day." Friction-removal framing. 4 IPs / 0 conversions in 7d.
    expect(CLI_SOURCE).not.toContain("Past the free anonymous quota");
    expect(CLI_SOURCE).not.toContain("lift it to 200/day");
  });

  test("engagementSignal heading leads with auto-watch proposition", () => {
    // v1.29.2 engagementSignal copy: behavior-recognition + ongoing-value
    // ("You're scanning a lot. Watch X for the next attack? Free.").
    expect(CLI_SOURCE).toContain("You're scanning a lot");
    expect(CLI_SOURCE).toContain("for the next attack");
  });

  test("findings heading mentions auto-watch + attack-or-score-drop", () => {
    // Findings path: "Auto-watch X. Email if Y attacked or score drops."
    expect(CLI_SOURCE).toMatch(/Auto-watch \$\{pkgRef\}\. Email if/);
    expect(CLI_SOURCE).toContain("attacked or score drops");
  });

  test("baseline (no findings, no engagement) heading uses auto-watch framing", () => {
    // Baseline path: "Auto-watch X. Free email alert if Y attacked."
    expect(CLI_SOURCE).toContain("Free email alert if");
  });

  test("subline names watchlist seeding (the actual value bought)", () => {
    // Pre-v1.29.2 subline: "Free, no card, 10 seconds. Saves to ~/.commit/config."
    //   Friction-only — said nothing about what the signup buys.
    // v1.29.2 subline: "Seeds your watchlist from this scan. 10s, no card."
    //   Value + friction. Echoes the watchlist auto-seed proposition.
    expect(CLI_SOURCE).toContain("Seeds your watchlist from this scan");
    // Regression guard: old subline gone.
    expect(CLI_SOURCE).not.toContain("Free, no card, 10 seconds. Saves to ~/.commit/config");
  });

  test("source: 'cli-soft-cta' when engagementSignal && !hasFindings", () => {
    expect(CLI_SOURCE).toContain(
      "const source = engagementSignal && !hasFindings ? 'cli-soft-cta' : 'cli';",
    );
  });

  test("inlineSignup call sites pass engagementSignal from apiCta", () => {
    // Both audit branches (≤20 packages and batched >20) pass the signal.
    const calls = CLI_SOURCE.match(
      /await inlineSignup\([^)]*\{ engagementSignal: !!apiCta \}\)/g,
    );
    expect(calls?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("Backend VALID_SOURCES whitelist", () => {
  test("includes 'cli-soft-cta'", () => {
    // VALID_SOURCES is the gate on /api/keys/create: unknown sources are
    // silently downgraded to 'web', which would hide cli-soft-cta lift
    // in api_keys.source breakdown.
    expect(WORKER_SOURCE).toMatch(/"cli-soft-cta"/);
    // Sanity: VALID_SOURCES still contains the existing 'cli' bucket.
    expect(WORKER_SOURCE).toMatch(/"cli",/);
  });
});

describe("Landing-page surface parity (get-started.astro)", () => {
  test("HERO_BY_REF has 'audit-cli-soft-cta' entry", () => {
    expect(GET_STARTED_SOURCE).toContain("'audit-cli-soft-cta':");
  });

  test("REF_TO_SOURCE maps 'audit-cli-soft-cta' to 'cli-soft-cta'", () => {
    expect(GET_STARTED_SOURCE).toContain(
      "'audit-cli-soft-cta': 'cli-soft-cta',",
    );
  });

  test("CLI_SOURCES set includes 'cli-soft-cta' for post-signup view", () => {
    expect(GET_STARTED_SOURCE).toContain(
      "new Set(['audit-cli-429', 'audit-baseline', 'cli', 'audit-cli', 'cli-soft-cta'])",
    );
  });

  test("HERO_BY_REF entry echoes auto-watch framing (v1.29.2)", () => {
    // Page echo must match the new in-terminal heading. Pre-v1.29.2 the
    // page said "Approaching the daily anonymous wall" — quota framing
    // that no longer matches the CLI copy.
    expect(GET_STARTED_SOURCE).toContain(
      "Watch your packages for the next attack",
    );
    // Regression guard: old quota framing must not still be present.
    expect(GET_STARTED_SOURCE).not.toContain(
      "Approaching the daily anonymous wall",
    );
  });
});

describe("Version pin", () => {
  test("package.json is at v1.29.2", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "npm-package", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.version).toBe("1.29.2");
  });

  test("CLI --help banner advertises v1.29.2", () => {
    expect(CLI_SOURCE).toContain("proof-of-commitment')} v1.29.2");
  });
});
