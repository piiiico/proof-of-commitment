/**
 * Welcome-email content contract.
 *
 * The /api/keys/create welcome email is the single post-signup engagement
 * touchpoint. Every new free-tier user reads it (or doesn't), so the body
 * doubles as the funnel's lowest-friction recurring-touchpoint surface.
 *
 * 2026-06-11: extended to cover the watchlist-seed branch. /api/keys/create
 * now accepts body.watch — when the post-results audit form (or rate-limit
 * rescue) passes prioritized package names, the backend seeds the default
 * project's monitored_packages and the welcome email's step 1 references
 * those packages by name instead of hardcoded `poc watch express / lodash`
 * examples. Both branches (seeded and unseeded) must keep the recurring
 * Monday-digest touchpoint visible — that's the proposition the signup is
 * buying, regardless of which form submitted.
 *
 * What this pins:
 *  1. Email shell + tier copy invariants (200 audits/day, Developer 15,
 *     Pro 50, Slack/webhook, 30-day guarantee).
 *  2. Unseeded step 1 keeps `poc watch express` / `poc watch lodash` as
 *     fallback examples for non-audit-page signups (e.g., /get-started
 *     direct entry).
 *  3. Seeded step 1 names the actual packages, shows `poc list` (not
 *     `poc watch`), and keeps the Monday-digest promise.
 *  4. The `${seededList}` template-literal interpolation is preserved so
 *     each user gets their actual packages rendered.
 *  5. The api_keys response payload echoes watched_packages so the audit
 *     page success state can confirm seeding visibly.
 *
 * Pin pattern: this file READS worker.ts as text and scopes assertions
 * to the relevant template-literal blocks. The watchlist-seed handler
 * (the c.env.DB INSERT loop) is covered structurally — we verify the
 * route accepts body.watch, validates ecosystems against ECOSYSTEMS,
 * caps at PACKAGE_LIMITS.free, and pushes to seededPackages.
 *
 * Regression model: every funnel-surface gap shipped in the past two
 * weeks was a string drifting from a constant in another file. The
 * watchlist-seed proposition collapses the gap between "audited
 * packages" (renderInlineForm in audit.astro) and "watched packages"
 * (welcome email + dashboard). This test fences the seed handler at
 * the worker.ts side; audit.astro side has its own buildWatchSeeds
 * contract pinned by the cli-soft-cta-gate test pattern.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const WORKER_SOURCE = readFileSync(
  join(import.meta.dir, "..", "src", "backend", "worker.ts"),
  "utf-8"
);

/** Pull the emailBody template literal (shell — has ${step1} interpolation). */
function extractEmailShell(): string {
  const start = WORKER_SOURCE.indexOf("const emailBody = `Your Commit API key");
  if (start === -1) throw new Error("welcome email shell not found in worker.ts");
  const open = WORKER_SOURCE.indexOf("`", start);
  const close = WORKER_SOURCE.indexOf("`;", open + 1);
  if (close === -1) throw new Error("welcome email shell close not found");
  return WORKER_SOURCE.slice(open + 1, close);
}

/** Pull the step1 ternary expression text — both branches concatenated. */
function extractStep1Block(): string {
  const start = WORKER_SOURCE.indexOf("const step1 = seededPackages.length > 0");
  if (start === -1) throw new Error("step1 block not found in worker.ts");
  // Block ends at the closing `;` after the else-branch template literal close.
  // Walk forward and find the second backtick-close-paren-semicolon pattern.
  const remainder = WORKER_SOURCE.slice(start, start + 3000);
  // step1 = ternary: A ? `...` : `...`;
  // Find the closing ; that terminates the const declaration.
  // We look for two consecutive template-literal closes then a semicolon.
  const ticks: number[] = [];
  for (let i = 0; i < remainder.length; i++) {
    if (remainder[i] === "`" && remainder[i - 1] !== "\\") ticks.push(i);
    if (ticks.length === 4) {
      const end = remainder.indexOf(";", ticks[3]);
      if (end > 0) return remainder.slice(0, end + 1);
      break;
    }
  }
  throw new Error("step1 block close not found");
}

/** Pull the watchSeed validation block. */
function extractWatchSeedBlock(): string {
  const start = WORKER_SOURCE.indexOf("type WatchSeed = { name: string; ecosystem: string };");
  if (start === -1) throw new Error("WatchSeed block not found");
  const end = WORKER_SOURCE.indexOf("// Validate email", start);
  if (end === -1) throw new Error("WatchSeed block close not found");
  return WORKER_SOURCE.slice(start, end);
}

/** Pull the auto-seed handler block. */
function extractSeedHandlerBlock(): string {
  const start = WORKER_SOURCE.indexOf("const seededPackages: Array<{");
  if (start === -1) throw new Error("seedHandler block not found");
  const end = WORKER_SOURCE.indexOf("// Send via Resend email API", start);
  if (end === -1) throw new Error("seedHandler block close not found");
  return WORKER_SOURCE.slice(start, end);
}

const SHELL = extractEmailShell();
const STEP1 = extractStep1Block();
const WATCH_SEED = extractWatchSeedBlock();
const SEED_HANDLER = extractSeedHandlerBlock();

describe("welcome email shell (constant across both branches)", () => {
  test("title advertises 4 things to try (was 3 — added poc watch)", () => {
    expect(SHELL).toContain("Your Commit API key + 4 things to try");
    expect(SHELL).not.toContain("Your Commit API key + 3 things");
  });

  test("step1 placeholder interpolated into shell", () => {
    expect(SHELL).toContain("${step1}");
  });

  test("CI gate is step 2 (was step 1 — demoted because higher friction)", () => {
    expect(SHELL).toMatch(/2\) Add a CI gate to one of your repos/);
    expect(SHELL).toContain("npx proof-of-commitment poc init");
  });

  test("CLI scan is step 3 (file-based audit)", () => {
    expect(SHELL).toMatch(/3\) Score any project from the command line/);
    expect(SHELL).toContain("npx proof-of-commitment --file package-lock.json");
  });

  test("API curl is step 4 (developer-demo, lowest engagement)", () => {
    expect(SHELL).toMatch(/4\) Use the API directly/);
    expect(SHELL).toContain("curl https://poc-backend.amdal-dev.workers.dev/api/audit");
  });

  test("free tier surfaces watch-3-packages benefit", () => {
    expect(SHELL).toContain("Watch 3 packages · weekly digest");
  });

  test("free tier still advertises 200 audits/day + 1 CI repo", () => {
    expect(SHELL).toContain("200 audits/day");
    expect(SHELL).toContain("1 CI-gated repo");
  });

  test("Developer tier monitor count = 15 packages (matches PACKAGE_LIMITS.developer)", () => {
    expect(SHELL).toContain("monitor 15 packages");
    expect(SHELL).toContain("Developer $15/mo");
    expect(SHELL).not.toContain("watch 3 projects");
  });

  test("Pro tier monitor count = 50 packages (matches PACKAGE_LIMITS.pro)", () => {
    expect(SHELL).toContain("monitor 50 packages");
    expect(SHELL).toContain("Pro $29/mo");
    expect(SHELL).toContain("~10 projects");
    expect(SHELL).not.toContain("watch 10 projects");
  });

  test("Pro tier mentions Slack/webhook alerts (matches /pricing)", () => {
    expect(SHELL).toContain("Slack/webhook alerts");
  });

  test("pricing URL still present for upgrade flow", () => {
    expect(SHELL).toContain("https://getcommit.dev/pricing");
    expect(SHELL).toContain("30-day money-back guarantee");
  });

  test("apiKey placeholder preserved (each user gets their key inline)", () => {
    expect(SHELL).toContain("${apiKey}");
  });
});

describe("step 1 — unseeded branch (e.g. /get-started direct, no audit-page seeds)", () => {
  test("opens with weekly-digest framing", () => {
    expect(STEP1).toMatch(/1\) Watch 3 packages.*weekly score-change digest/);
  });

  test("keeps hardcoded poc watch examples as fallback", () => {
    expect(STEP1).toContain("npx proof-of-commitment poc watch express");
    expect(STEP1).toContain("npx proof-of-commitment poc watch lodash");
  });

  test("Monday-digest promise is visible", () => {
    expect(STEP1).toMatch(/Mondays we email you when any watched score drops a tier/);
  });
});

describe("step 1 — seeded branch (audit-page signup with body.watch)", () => {
  test("opens by naming the audit-originated watchlist", () => {
    expect(STEP1).toContain("Your watchlist already contains");
  });

  test("interpolates seededList (per-user package list)", () => {
    expect(STEP1).toContain("${seededList}");
  });

  test("replaces poc watch with poc list (already configured)", () => {
    expect(STEP1).toContain("poc list");
    // The seeded branch must NOT instruct re-adding packages by hand —
    // that's the proposition gap this whole change closes.
    const seededHalf = STEP1.split("seededPackages.length > 0")[1] || "";
    expect(seededHalf).toContain("poc list");
  });

  test("Monday-digest promise survives (drop-tier OR attack)", () => {
    expect(STEP1).toMatch(/Mondays we email you if any score drops a tier or a watched package gets attacked/);
  });
});

describe("watchSeed validation (request shape)", () => {
  test("type WatchSeed pins shape: { name, ecosystem }", () => {
    expect(WATCH_SEED).toContain("type WatchSeed = { name: string; ecosystem: string };");
  });

  test("validates against ECOSYSTEMS set (npm/pypi/cargo/golang)", () => {
    expect(WATCH_SEED).toContain("!ECOSYSTEMS.has(eco)");
  });

  test("rejects non-string names", () => {
    expect(WATCH_SEED).toMatch(/typeof rawName !== ["']string["']/);
  });

  test("caps name length at 214 (npm package name max)", () => {
    expect(WATCH_SEED).toContain("name.length > 214");
  });

  test("dedupes by (name, ecosystem)", () => {
    expect(WATCH_SEED).toMatch(/watchSeeds\.some\(.*w\.name === name && w\.ecosystem === eco/);
  });

  test("default ecosystem is npm when missing", () => {
    expect(WATCH_SEED).toMatch(/typeof rawEco === ["']string["'].*\?.*rawEco.*:.*["']npm["']/);
  });
});

describe("auto-seed handler (database insert)", () => {
  test("caps at PACKAGE_LIMITS.free regardless of input length", () => {
    expect(SEED_HANDLER).toContain("PACKAGE_LIMITS.free");
    expect(SEED_HANDLER).toMatch(/watchSeeds\.slice\(0, cap\)/);
  });

  test("calls getOrCreateDefaultProject with the new key id + email", () => {
    expect(SEED_HANDLER).toMatch(/getOrCreateDefaultProject\(c\.env\.DB, id, email\)/);
  });

  test("uses INSERT OR IGNORE so re-runs are idempotent", () => {
    expect(SEED_HANDLER).toContain("INSERT OR IGNORE INTO monitored_packages");
  });

  test("inserts into monitored_packages (matches /api/watchlist endpoint schema)", () => {
    expect(SEED_HANDLER).toMatch(/INSERT OR IGNORE INTO monitored_packages.*id, project_id, package_name, ecosystem/s);
  });

  test("failures are swallowed (key creation already succeeded)", () => {
    expect(SEED_HANDLER).toContain("} catch {");
    expect(SEED_HANDLER).toMatch(/Swallow.*best-effort/);
  });

  test("only runs when watchSeeds is non-empty", () => {
    expect(SEED_HANDLER).toContain("if (watchSeeds.length > 0)");
  });

  test("tracks seededPackages for echo back to client", () => {
    expect(SEED_HANDLER).toContain("seededPackages.push(seed)");
  });
});

describe("response payload echoes watched_packages", () => {
  test("success response includes watched_packages array", () => {
    const idx = WORKER_SOURCE.indexOf('message: `API key ready. Backup sent');
    expect(idx).toBeGreaterThan(-1);
    const segment = WORKER_SOURCE.slice(idx, idx + 500);
    expect(segment).toContain("watched_packages: seededPackages");
  });

  test("email-fallback response also includes watched_packages", () => {
    const idx = WORKER_SOURCE.indexOf('message: "Your API key is shown below');
    expect(idx).toBeGreaterThan(-1);
    const segment = WORKER_SOURCE.slice(idx, idx + 500);
    expect(segment).toContain("watched_packages: seededPackages");
  });
});
