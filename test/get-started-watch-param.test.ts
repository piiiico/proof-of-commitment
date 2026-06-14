/**
 * Multi-package URL watchlist seeding contract — /get-started + /audit.
 *
 * What this pins
 * ──────────────
 * 1. /get-started.astro parses `?watch=pkg1,pkg2,pkg3&eco=npm` from URL,
 *    validates names against npm-name regex, validates ecosystem against
 *    the backend ECOSYSTEMS set (npm|pypi|cargo|golang), caps at 3 (free-
 *    tier), and writes body.watch on the /api/keys/create POST. Mirrors
 *    the pkg-profile single-pkg branch (commit-landing-v2/src/pages/
 *    get-started.astro:518) for any multi-pkg caller.
 * 2. /audit.astro bottom "Get your free API key" CTA, when the page loads
 *    with a packages URL param, rewrites its href to include `?watch=…&eco=…`
 *    matching the scanned packages. Closes the context-loss leak where the
 *    bottom-CTA → /get-started path lost the scanned packages even though
 *    /audit's inline renderInlineForm forms carry them.
 * 3. Surface parity: every place that links to /get-started from /audit
 *    can pass watch context. /get-started parses it.
 *
 * Regression pattern. Third occurrence of the same hardcoded-welcome-email
 * defect class (#1 web, #2 CLI, #3 audit bottom CTA). Per CLAUDE.md
 * "2nd occurrence → code gate; if a 3rd happens, the gate intercepted the
 * wrong level — move it to the default execution path so bypass requires
 * explicit opt-out." The cli-watch-seed-gate.test.ts pinned the CLI body
 * shape (#2 fix) but didn't cover the broader URL-level surface. This
 * test pins the URL contract — any future caller passing `?watch=...&eco=`
 * automatically seeds without code change.
 *
 * Plain-text source pinning. Astro pages do not run in bun:test directly
 * (require an Astro/Vite harness). Text-level invariant catches the
 * bug shape (drift between caller URL and consumer parser) with no harness.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

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

const AUDIT_SOURCE = readFileSync(
  join(
    import.meta.dir,
    "..",
    "..",
    "commit-landing-v2",
    "src",
    "pages",
    "audit.astro",
  ),
  "utf-8",
);

const WORKER_SOURCE = readFileSync(
  join(import.meta.dir, "..", "src", "backend", "worker.ts"),
  "utf-8",
);

describe("/get-started.astro: ?watch= multi-package URL param", () => {
  test("reads `watch` URL param on submit", () => {
    expect(GET_STARTED_SOURCE).toMatch(/params\.get\(['"]watch['"]\)/);
  });

  test("splits on comma, trims, filters by npm-name regex", () => {
    expect(GET_STARTED_SOURCE).toMatch(
      /watch[\s\S]{0,200}\.split\(['"],['"]\)[\s\S]{0,200}\.map\([\s\S]{0,80}trim\(\)[\s\S]{0,300}\/\^@\?\[a-z0-9\._\/-\]\{1,100\}\$\/i/,
    );
  });

  test("caps at 3 (free-tier defense in depth)", () => {
    // Look in the watch-param branch only — the pkg-profile branch sets a
    // single-element array which doesn't need slicing.
    const watchBranch = GET_STARTED_SOURCE.match(
      /params\.get\(['"]watch['"]\)[\s\S]{0,1500}/,
    )?.[0] ?? "";
    expect(watchBranch).toMatch(/\.slice\(0,\s*3\)/);
  });

  test("ecosystem validated against npm/pypi/cargo/golang in the watch branch", () => {
    // Two VALID_ECOS sets coexist (pkg-profile branch + watch branch). At
    // least one must appear AFTER the watch branch entry — easiest pin:
    // the source contains a second occurrence (the watch-branch one).
    const occurrences = GET_STARTED_SOURCE.match(/VALID_ECOS/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  test("unknown ecosystem falls back to npm rather than failing", () => {
    // Same fallback pattern as pkg-profile branch + cli-watch-seed:
    // VALID_ECOS.has(rawEco) ? rawEco : 'npm'
    const occurrences = GET_STARTED_SOURCE.match(
      /VALID_ECOS[A-Z_]*\.has\([a-zA-Z_]+\)\s*\?\s*[a-zA-Z_]+\s*:\s*['"]npm['"]/g,
    ) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  test("watch branch only fills body.watch when pkg-profile branch didn't", () => {
    // Backward-compatibility: pkg-profile single-pkg path takes precedence.
    // Pattern: `if (!body.watch)` guards the multi-pkg branch.
    expect(GET_STARTED_SOURCE).toMatch(/if\s*\(\s*!body\.watch\s*\)/);
  });

  test("body.watch elements are {name, ecosystem} objects (matches backend WatchSeed)", () => {
    // Mirrors the backend WatchSeed contract pinned in
    // cli-watch-seed-gate.test.ts (`type WatchSeed = { name, ecosystem }`).
    expect(GET_STARTED_SOURCE).toMatch(
      /names\.map\([^)]+=>\s*\(\{\s*name[\s\S]{0,40}ecosystem/,
    );
  });
});

describe("/audit.astro: bottom CTA href rewrite", () => {
  test("rewriteBottomCtaWithWatch IIFE exists", () => {
    expect(AUDIT_SOURCE).toContain("rewriteBottomCtaWithWatch");
  });

  test("selects the audit-get-key CTA anchor", () => {
    expect(AUDIT_SOURCE).toMatch(
      /a\.audit-waitlist-btn\[data-cta="audit-get-key"\]/,
    );
  });

  test("rewrites href with ?watch= when packages param present", () => {
    const ctaBlock = AUDIT_SOURCE.match(
      /rewriteBottomCtaWithWatch[\s\S]{0,3500}/,
    )?.[0] ?? "";
    expect(ctaBlock).toMatch(/searchParams\.set\(['"]watch['"]/);
    expect(ctaBlock).toMatch(/searchParams\.set\(['"]eco['"]/);
  });

  test("handles all four ecosystems (npm, pypi, cargo, golang) and repo opt-out", () => {
    const ctaBlock = AUDIT_SOURCE.match(
      /rewriteBottomCtaWithWatch[\s\S]{0,3500}/,
    )?.[0] ?? "";
    // ECO_PARAMS maps URL param names → ecosystem strings.
    expect(ctaBlock).toMatch(/['"]cargo['"]/);
    expect(ctaBlock).toMatch(/['"]golang['"]/);
    expect(ctaBlock).toMatch(/['"]pypi['"]/);
    expect(ctaBlock).toMatch(/['"]packages['"]/);
    // repo audits intentionally excluded — large transitive trees would
    // exceed free-tier cap and dilute the watchlist signal.
    // The block should not include `['repo', …]` in its lookup.
    expect(ctaBlock).not.toMatch(/\[\s*['"]repo['"]\s*,/);
  });

  test("respects ?ecosystem= qualifier override on ?packages=", () => {
    const ctaBlock = AUDIT_SOURCE.match(
      /rewriteBottomCtaWithWatch[\s\S]{0,3500}/,
    )?.[0] ?? "";
    // initFromUrlParams (~line 2739) treats ?packages=…&ecosystem=pypi as
    // pypi. The bottom CTA must do the same so the seeded watchlist matches
    // the ecosystem the user actually audited.
    expect(ctaBlock).toMatch(/ecosystem[\s\S]{0,80}eco/);
  });

  test("caps at 3 (mirrors free-tier limit, defense in depth)", () => {
    const ctaBlock = AUDIT_SOURCE.match(
      /rewriteBottomCtaWithWatch[\s\S]{0,3500}/,
    )?.[0] ?? "";
    expect(ctaBlock).toMatch(/\.slice\(0,\s*3\)/);
  });

  test("validates each pkg name against npm-name regex", () => {
    const ctaBlock = AUDIT_SOURCE.match(
      /rewriteBottomCtaWithWatch[\s\S]{0,3500}/,
    )?.[0] ?? "";
    expect(ctaBlock).toMatch(/\/\^@\?\[a-z0-9\._\/-\]\{1,100\}\$\/i/);
  });

  test("best-effort: try/catch wraps the entire rewrite block", () => {
    const ctaBlock = AUDIT_SOURCE.match(
      /rewriteBottomCtaWithWatch[\s\S]{0,3500}/,
    )?.[0] ?? "";
    expect(ctaBlock).toMatch(/try\s*\{/);
    expect(ctaBlock).toMatch(/catch\s*\(/);
  });

  test("static bottom CTA href still has audit-web ref (fallback when no packages)", () => {
    // When the page loads bare (/audit with no URL params), the rewrite
    // IIFE returns early and the static href is used unchanged.
    expect(AUDIT_SOURCE).toMatch(
      /<a\s+href="\/get-started\?ref=audit-web"\s+class="audit-waitlist-btn"/,
    );
  });
});

describe("Backend contract (worker.ts)", () => {
  test("worker accepts body.watch (already pinned by cli-watch-seed-gate)", () => {
    expect(WORKER_SOURCE).toMatch(/body\?\.watch/);
  });

  test("worker echoes seededPackages as watched_packages", () => {
    expect(WORKER_SOURCE).toMatch(/watched_packages:\s*seededPackages/);
  });

  test("worker caps at PACKAGE_LIMITS.free regardless of input", () => {
    expect(WORKER_SOURCE).toMatch(/PACKAGE_LIMITS\.free/);
  });

  test("WatchSeed type unchanged", () => {
    expect(WORKER_SOURCE).toMatch(
      /type WatchSeed = \{[^}]*name:\s*string[^}]*ecosystem:\s*string[^}]*\}/,
    );
  });
});
