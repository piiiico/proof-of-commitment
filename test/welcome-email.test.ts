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

  test("email subject matches body title in default branch (2026-06-11 fix)", () => {
    // Pre-2026-06-11: body said "+ 4 things to try" but the actual Resend
    // subject was still "+ 3 things to try" — the user saw the wrong
    // subject in their inbox, body said something else, broken trust on
    // the very first touchpoint.
    //
    // 2026-06-11 (welcome-scores): subject is now derived from emailSubject
    // — conditional on seedCriticalCount. The default branch (no CRITICAL
    // packages, OR no seeds at all) MUST match the body title.
    expect(WORKER_SOURCE).toContain(
      '"Your Commit API key + 4 things to try"',
    );
    expect(WORKER_SOURCE).toMatch(
      /const emailSubject = seedCriticalCount > 0\s*\?\s*`⚑ \$\{seedCriticalCount\} CRITICAL package\$\{seedCriticalCount > 1 \? "s" : ""\} in your watchlist — your Commit API key inside`\s*:\s*"Your Commit API key \+ 4 things to try"/,
    );
    expect(WORKER_SOURCE).toContain("subject: emailSubject");
    expect(WORKER_SOURCE).not.toContain(
      'subject: "Your Commit API key + 3 things',
    );
  });

  test("CRITICAL subject overrides default when seeded packages have CRITICAL flag", () => {
    // The inbox-preview surface is the highest-CTR copy in the entire funnel.
    // When the user audited a package.json with sole-maintainer 10M+/wk
    // packages (the structural axios profile), the welcome email subject must
    // surface that urgency BEFORE the user opens it. Generic "+ 4 things to
    // try" wastes the strongest engagement moment.
    expect(WORKER_SOURCE).toContain("seedCriticalCount > 0");
    expect(WORKER_SOURCE).toContain("⚑ ${seedCriticalCount} CRITICAL package");
    expect(WORKER_SOURCE).toContain("in your watchlist — your Commit API key inside");
  });

  test("step1 placeholder interpolated into shell", () => {
    expect(SHELL).toContain("${step1}");
  });

  test("CI gate is step 2 (was step 1 — demoted because higher friction)", () => {
    // step 2 content lives in the `step2` variable that the shell interpolates,
    // so assert against WORKER_SOURCE rather than SHELL (SHELL only carries the
    // `${step2}` placeholder). The 'default' branch of the step2 ternary is
    // the "Add a CI gate" copy that ships to web/api/audit-web/pkg-profile
    // signups — the most common path.
    expect(WORKER_SOURCE).toMatch(/2\) Add a CI gate to one of your repos/);
    // 2026-06-13: CLI canonical form is `npx proof-of-commitment <subcmd>`.
    // The earlier `npx proof-of-commitment poc init` shape was a regression:
    // the CLI parses `args[0]` as the subcommand, so `poc` was treated as a
    // package name and `init` as a second package name. Both were scored
    // (npmjs.com/poc + npmjs.com/init), wasting the user's daily quota and
    // never running `init`. Verified live 2026-06-13 by running
    // `npx proof-of-commitment poc login` → two random packages scored
    // instead of saving the key. Same class as the 2026-06-12 audit.astro
    // fix (lines 2011/2020/2059) that missed this welcome-email path.
    expect(WORKER_SOURCE).toContain("npx proof-of-commitment init     # adds GitHub Action");
    // Explicit anti-regression: do NOT advertise the broken `npx … poc <verb>`
    // shape anywhere in the worker source (covers both shell + ternary branches).
    expect(WORKER_SOURCE).not.toContain("npx proof-of-commitment poc init");
    expect(WORKER_SOURCE).not.toContain("npx proof-of-commitment poc login");
    expect(WORKER_SOURCE).not.toContain("npx proof-of-commitment poc watch");
    expect(WORKER_SOURCE).not.toContain("npx proof-of-commitment poc watchlist");
    expect(WORKER_SOURCE).not.toContain("npx proof-of-commitment poc unwatch");
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

  test("upgrade URL carries email + utm_campaign=welcome-upgrade (9th orphan-banner class)", () => {
    // 2026-06-15: pre-fix, the pricing URL was bare — visitors landed on
    // generic /pricing with no email pre-fill, no campaign tag. Banner stayed
    // silent on the highest-volume re-engagement surface in the free-tier
    // lifecycle. Same class as 2026-06-15 checkout-recovery (worker.ts:8110),
    // 2026-06-15 04:35Z 6-banner batch, 2026-06-12 ci-annotation,
    // 2026-06-10 audit-healthy-key. Pins email pre-fill + utm_campaign so
    // CONTEXT_BY_CAMPAIGN['welcome-upgrade'] fires + paid signups attribute
    // via VALID_PAID_SOURCE_RE (worker.ts:7923 Stripe webhook).
    expect(SHELL).toContain("utm_campaign=welcome-upgrade");
    expect(SHELL).toContain("utm_source=email");
    expect(SHELL).toContain("utm_medium=welcome");
    expect(SHELL).toContain("email=${encodeURIComponent(email)}");
  });

  test("apiKey placeholder preserved (each user gets their key inline)", () => {
    expect(SHELL).toContain("${apiKey}");
  });
});

describe("step 1 — unseeded branch (e.g. /get-started direct, no audit-page seeds)", () => {
  test("opens with watch-3-and-digest framing tying both deltas (score-drop AND attack)", () => {
    // 2026-06-12: rewrote from "weekly score-change digest" generic framing
    // to "Mondays we email you when scores drop or attacks happen" — same
    // shape as the seeded branch's Monday line. The unseeded user (direct
    // /get-started signup) has no audit context, so the email IS their only
    // proposition surface. Lead with the value, not the cadence.
    expect(STEP1).toMatch(/1\) Watch 3 packages.*Mondays we email you when scores drop or attacks happen/);
  });

  test("does NOT hardcode specific package names (Visionmedia regression class)", () => {
    // 2026-06-12 (Visionmedia-class fix): the unseeded branch used to suggest
    // `poc watch express` + `poc watch lodash` as concrete copy-paste examples.
    // Disposition: a direct /get-started signup has no idea why express/lodash
    // — those packages are probably not even in their tree. The hardcoded
    // names made the email look like a generic tutorial template, diluting
    // the bespoke value-prop of the watchlist proposition. Dogfooded by
    // walking pico+direct-getstarted-<ts>@amdal.dev signup at 05:49Z — the
    // welcome email recommended packages orthogonal to anything the user
    // (had they been real) might be running. Replaced with parametric
    // `<package-name>` placeholder + audit-first call-to-action that sells
    // the actual value-prop. Reflection: dogfood-verifiability-gap also
    // mentions the broader Visionmedia pattern (hardcoded 'watch express'
    // for 30d).
    expect(STEP1).not.toContain("npx proof-of-commitment poc watch express");
    expect(STEP1).not.toContain("npx proof-of-commitment poc watch lodash");
    expect(STEP1).not.toContain("npx proof-of-commitment watch express");
    expect(STEP1).not.toContain("npx proof-of-commitment watch lodash");
  });

  test("uses parametric <package-name> placeholder instead of hardcoded packages", () => {
    // 2026-06-13: canonical CLI form (no spurious `poc` prefix — CLI parses
    // args[0] as subcommand, so `npx proof-of-commitment poc watch foo`
    // scored "poc" as a package instead of running watch).
    expect(STEP1).toContain("npx proof-of-commitment watch <package-name>");
    expect(STEP1).not.toContain("npx proof-of-commitment poc watch <package-name>");
  });

  test("sells the value-prop: audit first (the proposition path)", () => {
    // The audit tool IS the proposition that auto-seeds the watchlist. For
    // unseeded signups, this is how they get the seeded value. Naming both
    // surfaces (CLI + web) gives the user agency over how they connect.
    expect(STEP1).toContain("npx proof-of-commitment --file package-lock.json");
    expect(STEP1).toContain("https://getcommit.dev/audit");
    expect(STEP1).toMatch(/auto-seed your watchlist/);
  });

  test("login step still present (one-time setup before watch)", () => {
    // 2026-06-13: canonical form is `npx proof-of-commitment login <key>`
    // with key inlined so users copy-paste a single line. The prior
    // `npx proof-of-commitment poc login` shape silently scored npm packages
    // "poc" + "login" instead of binding the key — verified live and rolled
    // out as a worker.ts fix the same day. Pinning the canonical form here.
    expect(STEP1).toContain("npx proof-of-commitment login ");
    expect(STEP1).not.toContain("npx proof-of-commitment poc login");
  });

  test("Monday-digest promise is visible (cadence stays consistent across branches)", () => {
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

  test("replaces poc watch with watchlist (already configured)", () => {
    // 2026-06-13: pinned canonical form `npx proof-of-commitment watchlist`
    // (subcommand is `watchlist`, not `list` — `list` was an outdated alias
    // baked into the email that the CLI never resolved). Same dogfood pass
    // that found `npx proof-of-commitment poc login` scoring `poc + login`.
    expect(STEP1).toContain("npx proof-of-commitment watchlist");
    // The seeded branch must NOT instruct re-adding packages by hand —
    // that's the proposition gap this whole change closes.
    const seededHalf = STEP1.split("seededPackages.length > 0")[1] || "";
    expect(seededHalf).toContain("npx proof-of-commitment watchlist");
  });

  test("Monday-digest promise survives (drop-tier OR attack)", () => {
    expect(STEP1).toMatch(/Mondays we email you if any score drops a tier or a watched package gets attacked/);
  });

  test("includes current scores block (2026-06-11 welcome-scores fix)", () => {
    // The proposition gap closed here: pre-fix, the seeded branch named the
    // packages but showed ZERO state — just promised "Mondays we email you."
    // High-intent CLI/audit-page user saw scores in the CLI 30 seconds ago,
    // then got an email recapitulating nothing. The persistent-anchor
    // surface (their inbox) had no proof-of-value.
    expect(STEP1).toContain("${seededScoreHeader}");
    expect(STEP1).toContain("${seedScoreLines}");
  });

  test("includes overflow-upgrade signal when user wanted more than free cap", () => {
    // ${overflowLine} interpolation surfaces actual data-driven upgrade
    // pressure: "you audited 30 packages, free can watch 3, Developer
    // watches 15." Different from the generic Developer pitch in the
    // tier-block below — this one is tied to THIS USER's input.
    expect(STEP1).toContain("${overflowLine}");
  });
});

describe("seeded-branch scoring (2026-06-11 welcome-scores)", () => {
  test("scoring loop emits SeedScore objects per seeded package", () => {
    expect(WORKER_SOURCE).toContain("const seedScores: SeedScore[]");
    expect(WORKER_SOURCE).toContain("buildNpmCommitmentProfile(s.name)");
  });

  test("non-npm seeds are listed without scoring (matches digest scope)", () => {
    expect(WORKER_SOURCE).toMatch(/if \(s\.ecosystem !== ["']npm["']\)/);
    expect(WORKER_SOURCE).toMatch(/score: null, maintainers: null, weeklyDownloads: null, riskFlags: \[\]/);
  });

  test("CRITICAL = sole maintainer + 10M+/wk (matches digest + /api/subscribe logic)", () => {
    expect(WORKER_SOURCE).toMatch(/profile\.maintainerCount === 1 && wdl > 10_000_000/);
  });

  test("scoring failures are swallowed (seed flow stays best-effort)", () => {
    // Same defensive shape as the existing seed-handler block. A failed
    // npm registry fetch must never break the welcome email — the user
    // still gets their key and unscored packages still appear by name.
    const start = WORKER_SOURCE.indexOf("const seedScores: SeedScore[]");
    const end = WORKER_SOURCE.indexOf("function fmtSeedDL", start);
    const block = WORKER_SOURCE.slice(start, end);
    expect(block).toContain("} catch {");
  });

  test("score line format: name (22) score (7) maintainers (Xp) downloads flag", () => {
    expect(WORKER_SOURCE).toContain("r.name.padEnd(22)");
    expect(WORKER_SOURCE).toMatch(/\$\{maint\}p/);
    expect(WORKER_SOURCE).toContain("fmtSeedDL(r.weeklyDownloads)");
    expect(WORKER_SOURCE).toContain("⚑ CRITICAL");
  });

  test("overflow uses watchSeeds.length vs seededPackages.length", () => {
    // overflowCount must be computed BEFORE slicing-cap, not after — so it
    // accurately captures "user wanted N, free gives 3." Using seededPackages
    // (capped) vs watchSeeds (raw) is the correct asymmetry.
    expect(WORKER_SOURCE).toContain("watchSeeds.length - seededPackages.length");
    expect(WORKER_SOURCE).toMatch(/Developer \$15\/mo monitors 15/);
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
    expect(WATCH_SEED).toContain("trimmedName.length > 214");
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

/**
 * Reply-To routing contract.
 *
 * Every outbound Commit email shipped from "Commit <noreply@getcommit.dev>"
 * (or any "noreply@") MUST set reply_to to a real human inbox. The send
 * domain has no inbound MX — replies to noreply@ silently vanish. The
 * highest-reply-intent moments (welcome email post-signup, paid-tier key
 * delivery, weekly Pro digest) were the silent-loss surface before
 * 2026-06-13 17:30Z.
 *
 * Policy:
 *  - "Commit <noreply@...>" sends → reply_to: "pico@amdal.dev" (Pico
 *    operates the Commit product, reads the inbox).
 *  - "Håkon at Commit <noreply@...>" sends → reply_to:
 *    "hawkaamdal@gmail.com" (personal Håkon touch — abandoned-checkout
 *    follow-up). Exempt because the address is signed Håkon.
 *
 * Regression model: future email-sending code paths copy an existing
 * send block as a template; if the template lacks reply_to, the silent-
 * loss surface re-grows. This test pins every from-noreply send to the
 * routing policy at text-of-worker.ts level.
 */
describe("reply-to routing on noreply@ sends", () => {
  function findAllSendBlocks(): Array<{ from: string; replyTo: string | null; lineNo: number }> {
    const blocks: Array<{ from: string; replyTo: string | null; lineNo: number }> = [];
    const re = /from:\s*"([^"]*noreply@[^"]+)"/g;
    let match;
    while ((match = re.exec(WORKER_SOURCE)) !== null) {
      // Look in the next ~400 chars for either a reply_to or a closing }),
      const after = WORKER_SOURCE.slice(match.index, match.index + 600);
      const closeIdx = after.indexOf("}),");
      const window = closeIdx > -1 ? after.slice(0, closeIdx) : after;
      const rt = window.match(/reply_to:\s*"([^"]+)"/);
      const lineNo = WORKER_SOURCE.slice(0, match.index).split("\n").length;
      blocks.push({ from: match[1], replyTo: rt ? rt[1] : null, lineNo });
    }
    return blocks;
  }

  const SEND_BLOCKS = findAllSendBlocks();

  test("at least 6 noreply@ send blocks exist (regression guard — count should not silently shrink)", () => {
    // 6 product sends (Commit) + 1 personal-Håkon (abandoned-checkout) = 7.
    // If count drops below 6, a send was removed (intentional?) or pattern shifted.
    expect(SEND_BLOCKS.length).toBeGreaterThanOrEqual(6);
  });

  test("every noreply@ send sets a reply_to", () => {
    const missing = SEND_BLOCKS.filter((b) => b.replyTo === null);
    if (missing.length > 0) {
      const lines = missing.map((b) => `  line ${b.lineNo}: from=${b.from}`).join("\n");
      throw new Error(
        `noreply@ send(s) without reply_to (replies would vanish):\n${lines}\n` +
          `Add reply_to: "pico@amdal.dev" (or "hawkaamdal@gmail.com" for "Håkon at Commit" sends).`
      );
    }
    expect(missing).toHaveLength(0);
  });

  test("'Commit <noreply@...>' sends route to pico@amdal.dev", () => {
    const commitSends = SEND_BLOCKS.filter((b) => b.from === "Commit <noreply@getcommit.dev>");
    expect(commitSends.length).toBeGreaterThanOrEqual(6);
    for (const block of commitSends) {
      expect(block.replyTo).toBe("pico@amdal.dev");
    }
  });

  test("'Håkon at Commit <noreply@...>' sends route to hawkaamdal@gmail.com (personal touch)", () => {
    const hakonSends = SEND_BLOCKS.filter((b) => b.from === "Håkon at Commit <noreply@getcommit.dev>");
    expect(hakonSends.length).toBeGreaterThanOrEqual(1);
    for (const block of hakonSends) {
      expect(block.replyTo).toBe("hawkaamdal@gmail.com");
    }
  });
});

describe("step 2 — blog-* sources route through discovery (not CI gate default)", () => {
  // 2026-06-15: blog-<slug> sources (blog-aur-1579, blog-redhat-miasma,
  // blog-ironworm, blog-snyk-comparison, …) come through the same /get-started
  // ?watch=… funnel as README sources: discovery channel, "I read about an
  // attack, I want to expand my coverage" intent, and step 1 already shows the
  // pre-seeded watchlist. The default step 2 ("Add a CI gate") contradicts
  // that framing — telling someone who just bought monitoring to instead set
  // up gating misroutes them away from the path they signed up for. Blog
  // sources must hit the README branch ("Score your tree, then watch the
  // riskiest package") via the isDiscoverySource helper that unifies both.
  test("isDiscoverySource helper unifies README + blog-* sources", () => {
    expect(WORKER_SOURCE).toContain(
      "const BLOG_SOURCE_RE = /^blog-[a-z0-9-]{1,40}$/",
    );
    expect(WORKER_SOURCE).toContain("const isDiscoverySource = (s: string) =>");
    expect(WORKER_SOURCE).toMatch(
      /isDiscoverySource\s*=\s*\(s:\s*string\)\s*=>\s*README_SOURCES_WELCOME\.has\(s\)\s*\|\|\s*BLOG_SOURCE_RE\.test\(s\)/,
    );
  });

  test("step 2 ternary calls isDiscoverySource(source), not README_SOURCES_WELCOME.has(source)", () => {
    // Anti-regression: previously the step 2 ternary checked
    // README_SOURCES_WELCOME.has(source) directly. That left blog-* sources
    // falling through to the default CI-gate branch. The helper must be the
    // gate that routes both README and blog families to the same copy.
    expect(WORKER_SOURCE).toContain(": isDiscoverySource(source)");
    // The old direct check must NOT come back as the step 2 branch — checking
    // README_SOURCES_WELCOME.has is only legal *inside* isDiscoverySource.
    const step2Block = WORKER_SOURCE.slice(
      WORKER_SOURCE.indexOf("const step2 = CI_SOURCES_WELCOME.has(source)"),
      WORKER_SOURCE.indexOf("const emailBody = `Your Commit API key"),
    );
    expect(step2Block).not.toContain(": README_SOURCES_WELCOME.has(source)");
  });

  test("blog source regex pattern matches the rawSource validator (line 2966)", () => {
    // Parity check: the regex used to gate isDiscoverySource must be the same
    // shape the /api/keys/create validator uses to admit `body.source`.
    // Drift here would let blog refs be accepted but never matched.
    // Both should be /^blog-[a-z0-9-]{1,40}$/.
    const matches = WORKER_SOURCE.match(/\/\^blog-\[a-z0-9-\]\{1,40\}\$\//g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
