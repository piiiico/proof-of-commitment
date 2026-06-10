/**
 * CLI engagementSignal gate-bypass contract — npm-package@1.28.0+.
 *
 * What this pins:
 *  1. inlineSignup accepts an `opts` parameter with `engagementSignal`.
 *  2. The findings gate (`results.length < 3 && !hasFindings`) is bypassed
 *     when `engagementSignal === true`. This is the 2026-06-10 fix that
 *     captures the soft-CTA leak: single-package healthy scans where the
 *     backend's `_cta` field signals the user has hit ≥AUDIT_SOFT_CTA_AT
 *     (5) scans today. Pre-fix, those scans showed only a dim URL.
 *  3. Both audit call sites pass `{ engagementSignal: !!apiCta }` so the
 *     server's soft-CTA signal drives the prompt at every entry point.
 *  4. When engagementSignal triggers (no findings), the prompt heading uses
 *     wall-approach framing ("past the free anonymous quota — lift it
 *     to 200/day"), not baseline-lock framing.
 *  5. Source attribution: engagement-signal-driven signups (no findings)
 *     post `source: 'cli-soft-cta'`; findings-driven prompts post
 *     `source: 'cli'`. Backend VALID_SOURCES whitelist includes
 *     'cli-soft-cta'.
 *  6. Landing-page surface parity: get-started.astro HERO_BY_REF has an
 *     'audit-cli-soft-cta' entry AND REF_TO_SOURCE maps it to
 *     'cli-soft-cta' AND CLI_SOURCES set includes 'cli-soft-cta' so the
 *     post-signup view shows CLI-shaped guidance.
 *
 * Plain-text source pinning. The CLI is a stand-alone Node script in
 * npm-package/ and the worker is CF Workers TS — no shared runtime
 * harness. The bug shape (backend constants vs distribution surfaces)
 * is itself a multi-file-string drift, so a text-level invariant test
 * is the cheapest contract.
 *
 * Regression pattern: 12 funnel-surface fixes shipped 2026-06-10 alone,
 * every one was a string in one file drifting from a canonical
 * source-of-truth in another. The reflection at 19:15Z explicitly
 * pivoted from surface to proposition — this test fences the
 * surface-side leak so the next attempt can target proposition.
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

describe("CLI inlineSignup engagementSignal gate-bypass", () => {
  test("inlineSignup signature accepts opts parameter", () => {
    expect(CLI_SOURCE).toContain(
      "async function inlineSignup(results, opts = {})",
    );
  });

  test("engagementSignal is destructured from opts", () => {
    expect(CLI_SOURCE).toContain("const engagementSignal = !!opts.engagementSignal;");
  });

  test("gate bypasses findings check when engagementSignal is true", () => {
    // The gate must include !engagementSignal so a true value lets the
    // prompt proceed. Pre-fix: `if (results.length < 3 && !hasFindings) return;`
    // Post-fix: `if (results.length < 3 && !hasFindings && !engagementSignal) return;`
    expect(CLI_SOURCE).toContain(
      "if (results.length < 3 && !hasFindings && !engagementSignal) return;",
    );
    // Regression guard: the old gate must not still exist verbatim.
    expect(CLI_SOURCE).not.toContain(
      "if (results.length < 3 && !hasFindings) return;",
    );
  });

  test("heading uses wall-approach framing for engagement-only path", () => {
    // The new no-findings + engagementSignal branch should use
    // wall-approach copy distinct from baseline-lock copy.
    expect(CLI_SOURCE).toContain(
      "🔔 Past the free anonymous quota on this network — lift it to 200/day.",
    );
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

  test("HERO_BY_REF entry uses wall-approach framing", () => {
    // The page should echo the in-terminal framing so the user does not
    // see the wrong page on context-switch.
    expect(GET_STARTED_SOURCE).toContain(
      "Approaching the daily anonymous wall",
    );
  });
});

describe("Version pin", () => {
  test("package.json is at v1.28.0", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "npm-package", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.version).toBe("1.28.0");
  });

  test("CLI --help banner advertises v1.28.0", () => {
    expect(CLI_SOURCE).toContain("proof-of-commitment')} v1.28.0");
  });
});
