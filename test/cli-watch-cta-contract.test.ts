/**
 * CLI watchlist-CTA contract — printTable funnels non-TTY users to /get-started.
 *
 * What this pins
 * ──────────────
 * The CLI's printTable() emits CTAs at three points where a non-TTY user
 * cannot benefit from inlineSignup()'s interactive prompt: (1) the GitHub
 * Actions CRITICAL annotation, (2) the non-TTY CRITICAL contextual upsell,
 * (3) the non-TTY HEALTHY contextual upsell. All three must offer a
 * clickable /get-started URL with the watchlist pre-seeded from the scan
 * (?watch=… contract pinned by get-started-watch-param.test.ts).
 *
 * Why this exists. Pre-v1.32.0 the CRITICAL annotation routed to
 * /audit?packages=… (viewer page, no conversion form as primary action) and
 * the non-TTY upsells offered only a `poc watch X --email Y` CLI command —
 * a 3-decision ask (recall package name, run new npx, remember email). The
 * highest-intent CI/non-TTY users were funneled at the wrong destination.
 * Post-v1.32.0 buildWatchUrl() produces the canonical /get-started URL with
 * the scan's top-3-by-risk packages pre-seeded; the three CTA sites consume
 * it. This test pins the contract so a future printTable edit that drops a
 * Web: line or reverts the annotation to /audit?packages= is caught at
 * publish-time (test workflow runs before the npm-publish workflow).
 *
 * Source-level (no harness): bun:test cannot run a CommonJS / ESM-with-TLA
 * module's printTable side-effectfully without an HTTP mock. Text-level
 * pinning matches the get-started-watch-param.test.ts approach and catches
 * the bug shape (the URL contract drift) without harness complexity.
 *
 * Run: bun test test/cli-watch-cta-contract.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const CLI_SOURCE = readFileSync(
  join(import.meta.dir, "..", "npm-package", "index.js"),
  "utf-8",
);

describe("buildWatchUrl helper", () => {
  test("buildWatchUrl function exists", () => {
    expect(CLI_SOURCE).toMatch(/function\s+buildWatchUrl\s*\(/);
  });

  test("delegates seed selection to buildCliWatchSeeds (priority order shared)", () => {
    const fnBlock =
      CLI_SOURCE.match(/function\s+buildWatchUrl\s*\([\s\S]{0,800}?\n\}/)?.[0] ??
      "";
    expect(fnBlock).toMatch(/buildCliWatchSeeds\(results\)/);
  });

  test("emits /get-started URL with ?watch=, &eco=, &ref= params", () => {
    const fnBlock =
      CLI_SOURCE.match(/function\s+buildWatchUrl\s*\([\s\S]{0,800}?\n\}/)?.[0] ??
      "";
    expect(fnBlock).toMatch(/getcommit\.dev\/get-started\?watch=/);
    expect(fnBlock).toMatch(/eco=/);
    expect(fnBlock).toMatch(/ref=/);
  });

  test("URL-encodes the package names (CSV → %2C-separated)", () => {
    const fnBlock =
      CLI_SOURCE.match(/function\s+buildWatchUrl\s*\([\s\S]{0,800}?\n\}/)?.[0] ??
      "";
    expect(fnBlock).toMatch(/encodeURIComponent\(names\)/);
  });

  test("returns null when no valid seeds (callers must degrade gracefully)", () => {
    const fnBlock =
      CLI_SOURCE.match(/function\s+buildWatchUrl\s*\([\s\S]{0,800}?\n\}/)?.[0] ??
      "";
    expect(fnBlock).toMatch(/seeds\.length\s*===\s*0[\s\S]{0,40}return\s+null/);
  });
});

describe("GitHub Actions CRITICAL annotation", () => {
  test("annotation emits when effectiveCritical > 0 in GITHUB_ACTIONS", () => {
    expect(CLI_SOURCE).toMatch(/process\.env\.GITHUB_ACTIONS\s*===\s*['"]true['"]/);
    expect(CLI_SOURCE).toMatch(
      /::warning\s+title=Commit:\s*\$\{effectiveCritical\}\s*CRITICAL/,
    );
  });

  test("annotation URL is buildWatchUrl(results, 'cli-watch'), not hardcoded /audit", () => {
    // Find the block emitting the CRITICAL annotation.
    const annotBlock =
      CLI_SOURCE.match(
        /process\.env\.GITHUB_ACTIONS[\s\S]{0,3000}?::warning\s+title=Commit:[\s\S]{0,800}?\$\{ctaUrl\}/,
      )?.[0] ?? "";
    expect(annotBlock).toMatch(/buildWatchUrl\(results,\s*['"]cli-watch['"]\)/);
    expect(annotBlock).toMatch(/Watch\s*\+\s*alert/i);
  });

  test("/audit fallback only fires when buildWatchUrl returns null", () => {
    // ctaUrl = watchUrl || <fallback>. The fallback should be /audit-shaped.
    // The watchUrl declaration and the ctaUrl assignment with the fallback
    // appear on consecutive lines in the annotation block — match both.
    const annotBlock =
      CLI_SOURCE.match(
        /const\s+watchUrl\s*=\s*buildWatchUrl\(results,\s*['"]cli-watch['"]\)[\s\S]{0,600}/,
      )?.[0] ?? "";
    expect(annotBlock).toMatch(
      /ctaUrl\s*=\s*watchUrl\s*\|\|\s*`https:\/\/getcommit\.dev\/audit/,
    );
  });
});

describe("Non-TTY contextual upsells (CRITICAL + HEALTHY)", () => {
  test("CRITICAL non-TTY branch emits Web + CLI dual-path", () => {
    // Anchor on the "Monitor … CRITICAL" copy. Match through the static
    // "Free: 3 packages, weekly digest. Developer …" line that terminates
    // the upsell block (sole occurrence in the file).
    const block =
      CLI_SOURCE.match(
        /Monitor\s+\$\{[\s\S]{0,1500}?Free:\s*3\s*packages,\s*weekly\s+digest\.\s*Developer/,
      )?.[0] ?? "";
    expect(block).toMatch(/Web:[\s\S]{0,300}watchUrl/);
    expect(block).toMatch(/CLI:[\s\S]{0,300}poc watch/);
  });

  test("CRITICAL non-TTY branch calls buildWatchUrl with cli-watch ref", () => {
    const block =
      CLI_SOURCE.match(
        /Non-TTY[\s\S]{0,2000}?buildWatchUrl\(results,\s*['"]cli-watch['"]\)/,
      )?.[0] ?? "";
    expect(block).toContain("buildWatchUrl");
  });

  test("HEALTHY non-TTY branch calls buildWatchUrl with audit-baseline ref", () => {
    // audit-baseline distinguishes healthy-result CTAs from CRITICAL-driven
    // cli-watch in api_keys.source breakdowns.
    const block =
      CLI_SOURCE.match(
        /HEALTHY[\s\S]{0,2000}?buildWatchUrl\(results,\s*['"]audit-baseline['"]\)/,
      )?.[0] ?? "";
    expect(block).toContain("buildWatchUrl");
  });

  test("HEALTHY non-TTY branch emits Web + CLI dual-path", () => {
    // The healthy branch's terminating string is "(free: 3 packages, weekly
    // digest)" — note lower-case and parenthetical (distinct from the
    // CRITICAL branch's "Free: 3 packages, weekly digest. Developer …" copy).
    const block =
      CLI_SOURCE.match(
        /Get alerted if any package degrades[\s\S]{0,1000}?\(free:\s*3\s*packages,\s*weekly\s+digest\)/,
      )?.[0] ?? "";
    expect(block).toMatch(/Web:[\s\S]{0,300}watchUrl/);
    expect(block).toMatch(/CLI:[\s\S]{0,300}poc watch/);
  });
});

describe("Backend VALID_SOURCES compatibility", () => {
  // Refs used by the CLI must be in the backend VALID_SOURCES set (or match
  // BLOG_REF_RE) — otherwise the worker coerces them to "web" and we lose
  // attribution. cli-watch and audit-baseline are both pinned in
  // proof-of-commitment/src/backend/worker.ts. This test pins the dependency.
  test("worker.ts accepts cli-watch", () => {
    const workerSource = readFileSync(
      join(import.meta.dir, "..", "src", "backend", "worker.ts"),
      "utf-8",
    );
    expect(workerSource).toMatch(
      /VALID_SOURCES\s*=\s*\[[^\]]*['"]cli-watch['"]/,
    );
  });

  test("worker.ts accepts audit-baseline", () => {
    const workerSource = readFileSync(
      join(import.meta.dir, "..", "src", "backend", "worker.ts"),
      "utf-8",
    );
    expect(workerSource).toMatch(
      /VALID_SOURCES\s*=\s*\[[^\]]*['"]audit-baseline['"]/,
    );
  });
});
