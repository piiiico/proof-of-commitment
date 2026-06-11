/**
 * CLI watchlist auto-seed contract — npm-package@1.29.0+.
 *
 * What this pins
 * ──────────────
 *  1. inlineSignup POSTs `watch: buildCliWatchSeeds(results)` alongside
 *     `email` + `source`. This is the second layer of the 2026-06-11
 *     proposition fix (web side shipped at abe53f1/df8a8be earlier the
 *     same day). Pre-fix, every CLI signup got hardcoded
 *     "poc watch express / lodash" in their welcome email regardless of
 *     what they actually audited — the welcome email proposition was
 *     orthogonal to user intent.
 *  2. buildCliWatchSeeds priority order matches the web-side helper at
 *     commit-landing-v2/src/pages/audit.astro:1299 — compromised >
 *     CRITICAL > HIGH > other-flags > clean — so the user's most
 *     dangerous package is the first one we lock in.
 *  3. Free-tier cap (3 packages) is enforced client-side as well as
 *     server-side. Defense in depth across client-server version drift.
 *  4. Ecosystem validation against the backend ECOSYSTEMS set
 *     (npm/pypi/cargo/golang) — unknown ecosystems fall back to npm
 *     rather than failing silently when the server rejects the payload.
 *  5. Success state renders the backend echo (data.watched_packages) so
 *     the user sees "Now watching: foo, bar, baz" inline before the
 *     first weekly digest fires. Mirrors audit.astro:1971 web success
 *     state — context-switching from CLI to `poc list` shows consistent
 *     state instead of "nothing watched."
 *  6. Backwards compatibility: when the response lacks
 *     `watched_packages` (older worker version), CLI falls through to
 *     the legacy single-target "poc watch <pkg>" hint with no
 *     regression.
 *
 * Regression pattern. This is the SECOND time a hardcoded welcome-email
 * example drifted from user intent. First occurrence (web): caught
 * during 2026-06-11 dogfood, fixed at abe53f1/df8a8be. Second
 * occurrence (CLI): same root cause, second surface — POST body wasn't
 * sending `watch`. Per CLAUDE.md "1st occurrence → principle/skill
 * text; 2nd occurrence → code gate" — this test IS the code gate.
 *
 * Plain-text source pinning. Same approach as
 * cli-soft-cta-gate.test.ts: the CLI is a stand-alone Node script with
 * no shared runtime harness, so the cheapest contract is a text-level
 * invariant.
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

describe("inlineSignup POST body includes watch", () => {
  test("body.watch is built from results before POST", () => {
    expect(CLI_SOURCE).toContain("const watch = buildCliWatchSeeds(results);");
  });

  test("JSON.stringify body contains watch alongside email + source", () => {
    // Pattern match: body must JSON-stringify { email, source, watch }
    expect(CLI_SOURCE).toMatch(/JSON\.stringify\(\{\s*email,\s*source,\s*watch\s*\}\)/);
  });

  test("backend VALID_SOURCES still includes 'cli' and 'cli-soft-cta'", () => {
    expect(WORKER_SOURCE).toContain('"cli"');
    expect(WORKER_SOURCE).toContain('"cli-soft-cta"');
  });
});

describe("buildCliWatchSeeds helper", () => {
  test("helper is defined above inlineSignup", () => {
    const helperIdx = CLI_SOURCE.indexOf("function buildCliWatchSeeds(");
    const inlineIdx = CLI_SOURCE.indexOf("async function inlineSignup(");
    expect(helperIdx).toBeGreaterThan(0);
    expect(inlineIdx).toBeGreaterThan(helperIdx);
  });

  test("priority order: compromised > CRITICAL > HIGH > flags > clean", () => {
    // Must encode all four priority tiers in order
    expect(CLI_SOURCE).toContain("if (r.compromised) return 0;");
    expect(CLI_SOURCE).toMatch(/CRITICAL[\s\S]{0,200}return 1;/);
    expect(CLI_SOURCE).toMatch(/HIGH[\s\S]{0,200}return 2;/);
    expect(CLI_SOURCE).toMatch(/riskFlags[\s\S]{0,200}return 3;/);
  });

  test("free-tier cap of 3 packages enforced client-side", () => {
    expect(CLI_SOURCE).toMatch(/seeds\.length >= 3/);
  });

  test("name length validated against npm 214-char max", () => {
    expect(CLI_SOURCE).toMatch(/r\.name\.length < 215/);
  });

  test("dedupe by (name, ecosystem) composite key", () => {
    expect(CLI_SOURCE).toMatch(/\$\{r\.name\}\|\$\{eco\}/);
  });

  test("ecosystem validated against npm/pypi/cargo/golang", () => {
    expect(CLI_SOURCE).toMatch(/VALID_ECOS[\s\S]{0,80}'npm'[\s\S]{0,80}'pypi'[\s\S]{0,80}'cargo'[\s\S]{0,80}'golang'/);
  });

  test("unknown ecosystems fall back to npm rather than failing silently", () => {
    expect(CLI_SOURCE).toMatch(/VALID_ECOS\.has\(rawEco\) \? rawEco : 'npm'/);
  });

  test("returns empty array on empty input (no crash on legacy callers)", () => {
    expect(CLI_SOURCE).toMatch(/if \(!Array\.isArray\(results\) \|\| results\.length === 0\) return \[\];/);
  });
});

describe("success state renders watched_packages echo", () => {
  test("reads data.watched_packages from response", () => {
    expect(CLI_SOURCE).toMatch(/data\.watched_packages/);
  });

  test("renders 'Now watching N packages: name, name' line", () => {
    expect(CLI_SOURCE).toContain("Now watching");
  });

  test("seeded branch promotes poc list over poc watch", () => {
    // When backend echoed back ≥1 seed, the Next steps should say
    // 'poc list' (confirm the watchlist) — not 'poc watch <pkg>',
    // because the watch already happened server-side.
    const seededRegion = CLI_SOURCE.split("watched.length > 0")[1] || "";
    expect(seededRegion).toContain("'poc list'");
    // The legacy 'poc watch <pkg>' hint must NOT appear in the seeded
    // branch (would contradict the just-rendered 'Now watching' line).
    const seededBlockEnd = seededRegion.indexOf("} else {");
    const seededBlock = seededBlockEnd > 0 ? seededRegion.slice(0, seededBlockEnd) : seededRegion;
    expect(seededBlock).not.toMatch(/poc watch \$\{/);
  });

  test("Monday-digest promise visible in seeded success state", () => {
    expect(CLI_SOURCE).toContain("Mondays we email you");
  });
});

describe("legacy fallback (older backend with no watched_packages echo)", () => {
  test("falls through to single-target poc watch hint when echo is empty", () => {
    // Pattern: when watched.length === 0, the Next steps should still
    // surface the legacy `poc watch <watchTarget>` hint so older
    // backends (pre-2026-06-11 abe53f1) don't break the UX. Anchor on
    // the Legacy fallback comment to scope the search to the right
    // branch (there are multiple `} else {` in the file).
    const legacyAnchor = "// Legacy fallback:";
    const idx = CLI_SOURCE.indexOf(legacyAnchor);
    expect(idx).toBeGreaterThan(0);
    const legacyRegion = CLI_SOURCE.slice(idx, idx + 1200);
    expect(legacyRegion).toContain("watchTarget");
    expect(legacyRegion).toMatch(/poc watch \$\{watchTarget\}/);
  });

  test("watchTarget priority unchanged: CRITICAL first, then lowest score", () => {
    expect(CLI_SOURCE).toContain("critPkgs[0]?.name");
  });
});

describe("backend contract surface (worker.ts side)", () => {
  test("backend declares WatchSeed type with name + ecosystem", () => {
    expect(WORKER_SOURCE).toMatch(/type WatchSeed = \{[^}]*name:\s*string[^}]*ecosystem:\s*string[^}]*\}/);
  });

  test("backend reads body.watch from /api/keys/create", () => {
    expect(WORKER_SOURCE).toMatch(/body\?\.watch/);
  });

  test("backend echoes seededPackages as watched_packages in response", () => {
    expect(WORKER_SOURCE).toMatch(/watched_packages:\s*seededPackages/);
  });

  test("backend caps at PACKAGE_LIMITS.free regardless of input", () => {
    expect(WORKER_SOURCE).toMatch(/PACKAGE_LIMITS\.free/);
  });
});

describe("Version pin", () => {
  test("package.json is at v1.30.0", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "npm-package", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.version).toBe("1.30.0");
  });

  test("CLI --help banner advertises v1.30.0", () => {
    expect(CLI_SOURCE).toContain("proof-of-commitment')} v1.30.0");
  });
});
