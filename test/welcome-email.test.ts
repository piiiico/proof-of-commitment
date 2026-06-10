/**
 * Welcome-email content contract.
 *
 * The /api/keys/create welcome email is the single post-signup engagement
 * touchpoint. Every new free-tier user reads it (or doesn't), so the body
 * doubles as the funnel's lowest-friction recurring-touchpoint surface.
 *
 * What this pins:
 *  1. The body advertises the FREE-tier watch benefit (3 packages, weekly
 *     digest). Pre-2026-06-10 the email omitted this and users couldn't
 *     discover monitoring at all without reading /pricing.
 *  2. The body uses `poc watch <pkg>` as the leading "thing to try" — it
 *     is the lowest-friction action that creates a recurring touchpoint
 *     (Monday digest). CI gate stays as step 2 because it requires `cd`
 *     into a repo.
 *  3. Upgrade-tier counts match the canonical PACKAGE_LIMITS in worker.ts
 *     (developer=15 packages, pro=50 packages). Pre-fix the email said
 *     "watch 3 projects" for Developer (mismatched to the free-tier limit)
 *     and "watch 10 projects" for Pro (matched /pricing but unitless).
 *  4. The 4-step ordering: title says "+ 4 things to try" (was "+ 3").
 *
 * This file READS worker.ts as text and pins the email body string —
 * the email body is constructed inside the /api/keys/create handler so a
 * runtime test would need to re-shim the whole CF Worker env. Plain-text
 * pinning is cheaper and the contract is small.
 *
 * Regression pattern: this exact failure shape (backend tier limits drift,
 * distribution surfaces don't follow) has already produced 11 separate
 * funnel-surface fixes on 2026-06-10 alone — every one was a string in
 * one file drifting from a constant in another. This test fences the
 * welcome-email instance of that pattern.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const WORKER_SOURCE = readFileSync(
  join(import.meta.dir, "..", "src", "backend", "worker.ts"),
  "utf-8"
);

// Extract the welcome-email template literal so each assertion runs against
// the same scoped block (not other strings elsewhere in the file).
function extractWelcomeEmailBody(): string {
  const start = WORKER_SOURCE.indexOf("const emailBody = `Your Commit API key");
  if (start === -1) throw new Error("welcome email template not found in worker.ts");
  // Backticks aren't escaped inside the literal, so find the matching close.
  const open = WORKER_SOURCE.indexOf("`", start);
  const close = WORKER_SOURCE.indexOf("`;", open + 1);
  if (close === -1) throw new Error("welcome email template close not found");
  return WORKER_SOURCE.slice(open + 1, close);
}

describe("welcome email body", () => {
  const body = extractWelcomeEmailBody();

  test("title advertises 4 things to try (was 3 — added poc watch)", () => {
    expect(body).toContain("Your Commit API key + 4 things to try");
    // Guard against regression to the 3-thing variant
    expect(body).not.toContain("Your Commit API key + 3 things");
  });

  test("step 1 is poc watch — lowest-friction recurring touchpoint", () => {
    // The leading step is `poc watch` (not `poc init`) so the user's first
    // action creates a recurring weekly digest touchpoint.
    expect(body).toMatch(/1\) Watch 3 packages.*weekly score-change digest/);
    expect(body).toContain("npx proof-of-commitment poc watch express");
    expect(body).toContain("npx proof-of-commitment poc watch lodash");
  });

  test("CI gate is step 2 (was step 1 — demoted because higher friction)", () => {
    expect(body).toMatch(/2\) Add a CI gate to one of your repos/);
    expect(body).toContain("npx proof-of-commitment poc init");
  });

  test("CLI scan is step 3 (file-based audit)", () => {
    expect(body).toMatch(/3\) Score any project from the command line/);
    expect(body).toContain("npx proof-of-commitment --file package-lock.json");
  });

  test("API curl is step 4 (developer-demo, lowest engagement)", () => {
    expect(body).toMatch(/4\) Use the API directly/);
    expect(body).toContain("curl https://poc-backend.amdal-dev.workers.dev/api/audit");
  });

  test("free tier surfaces watch-3-packages benefit (NEW)", () => {
    // Pre-fix the free-tier block omitted the monitoring benefit, so users
    // didn't know they could `poc watch` at all without reading /pricing.
    expect(body).toContain("Watch 3 packages · weekly digest");
  });

  test("free tier still advertises 200 audits/day + 1 CI repo", () => {
    expect(body).toContain("200 audits/day");
    expect(body).toContain("1 CI-gated repo");
  });

  test("Developer tier monitor count = 15 packages (matches PACKAGE_LIMITS.developer)", () => {
    expect(body).toContain("monitor 15 packages");
    expect(body).toContain("Developer $15/mo");
    // Regression guard: the pre-fix wording was "watch 3 projects" which
    // collided with the free-tier package count and undersold Developer.
    expect(body).not.toContain("watch 3 projects");
  });

  test("Pro tier monitor count = 50 packages (matches PACKAGE_LIMITS.pro)", () => {
    expect(body).toContain("monitor 50 packages");
    expect(body).toContain("Pro $29/mo");
    // Bridge to /pricing wording (which uses projects) is kept inline
    expect(body).toContain("~10 projects");
    // Regression guard: pre-fix said "watch 10 projects" with no package count
    expect(body).not.toContain("watch 10 projects");
  });

  test("Pro tier mentions Slack/webhook alerts (matches /pricing)", () => {
    // /pricing promises Slack/webhook alerts for Pro; the welcome email
    // previously said only "webhooks" which understated the offer.
    expect(body).toContain("Slack/webhook alerts");
  });

  test("pricing URL still present for upgrade flow", () => {
    expect(body).toContain("https://getcommit.dev/pricing");
    expect(body).toContain("30-day money-back guarantee");
  });

  test("apiKey + email signature placeholders preserved", () => {
    // Template-literal interpolation `${apiKey}` must remain so each user
    // gets their key inline. Regression check: literal `${apiKey}` token.
    expect(body).toContain("${apiKey}");
  });
});
