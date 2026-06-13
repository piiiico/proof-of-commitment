/**
 * check-advertised-commands — docs ↔ CLI verb-parity gate tests.
 *
 * Regression class pinned here:
 * ─────────────────────────────
 * npm-trust-q2-2026.astro:559 advertised `npx proof-of-commitment audit`
 * but the CLI had no `audit` subcommand until v1.29.1. The CLI parsed
 * `audit` as a positional package name and scored the unrelated
 * npmjs.com/audit utility — wasting quota, breaking trust at first contact.
 *
 * Also caught by the gate (2026-06-12):
 * audit.astro lines 2011/2020/2059 used `npx proof-of-commitment poc init`
 * — `poc` was never a CLI subcommand; it would silently audit npmjs.com/poc
 * instead of running `poc init`. Fixed to `poc init` (using the short binary).
 *
 * What these tests pin:
 *   (a) Tool exits 0 on the current tree — canonical verbs cover all
 *       advertised invocations; no regressions present.
 *   (b) Injecting `npx proof-of-commitment garbageverb` into a fixture file
 *       causes the tool to exit 1.
 *   (c) Injecting `poc foobar` (via short binary) into a fixture file also
 *       causes exit 1.
 *   (d) Allowlisted package names (e.g. `npx proof-of-commitment axios`) do
 *       NOT trigger a violation.
 *   (e) Canonical verbs do NOT trigger a violation.
 *   (f) Prose-use of "proof-of-commitment" without `npx` does NOT trigger
 *       false positives (e.g. "proof-of-commitment scores packages").
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-advertised-commands.ts");

// Fixtures must live inside the scan tree (commit-landing-v2/src) so the
// gate script actually reads them. We use a dedicated subdirectory that
// normally doesn't exist — tests create it, afterAll removes it.
const FIXTURE_DIR = join(
  REPO_ROOT, "..", "commit-landing-v2", "src", "__test-fixtures__", "check-advertised-commands"
);

// Helper: run the gate script and return exit code + stdout + stderr
function runGate(extraArgs: string[] = []): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execSync(
      `bun ${SCRIPT} ${extraArgs.join(" ")} 2>&1`,
      { cwd: REPO_ROOT }
    ).toString();
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------
const FIXTURE_ASTRO = join(FIXTURE_DIR, "fixture.astro");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Clean up fixture dir after tests — don't leave test artifacts in the tree.
  // Remove the whole __test-fixtures__ parent (not just the inner dir) to
  // avoid leaving an empty directory in the scanned tree.
  const testFixturesParent = join(
    REPO_ROOT, "..", "commit-landing-v2", "src", "__test-fixtures__"
  );
  if (existsSync(testFixturesParent)) {
    rmSync(testFixturesParent, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("check-advertised-commands gate", () => {
  test("(a) exits 0 on current tree — no verb regressions present", () => {
    const { exitCode, stdout } = runGate();
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/✓ All advertised CLI verbs match canonical set/);
  });

  test("(b) exits 1 when npx-prefixed unknown verb is injected in a fixture file", () => {
    // Write a fixture .astro with a bad verb
    writeFileSync(
      FIXTURE_ASTRO,
      `<pre><code>npx proof-of-commitment garbageverb --file package.json</code></pre>\n`
    );

    const { exitCode, stdout } = runGate();
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/unknown verb "garbageverb"/);
    expect(stdout).toMatch(/fixture\.astro/);
  });

  test("(c) exits 1 when poc-shortform unknown verb is injected in a fixture file", () => {
    writeFileSync(
      FIXTURE_ASTRO,
      `<code>poc foobar</code>\n`
    );

    const { exitCode, stdout } = runGate();
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/unknown verb "foobar"/);
  });

  test("(d) allowlisted package name does NOT trigger violation", () => {
    // axios is in AUDIT_EXAMPLES; this should be clean
    writeFileSync(
      FIXTURE_ASTRO,
      `<code>npx proof-of-commitment axios</code>\n`
    );

    const { exitCode } = runGate();
    expect(exitCode).toBe(0);
  });

  test("(e) canonical CLI verbs do NOT trigger violation", () => {
    // All canonical verbs should pass
    const canonicalVerbs = ["init", "login", "status", "logout", "hook", "report",
      "watch", "watchlist", "unwatch", "audit", "scan", "check"];
    const content = canonicalVerbs
      .map((v) => `<code>npx proof-of-commitment ${v}</code>`)
      .join("\n") + "\n";
    writeFileSync(FIXTURE_ASTRO, content);

    const { exitCode } = runGate();
    expect(exitCode).toBe(0);
  });

  test("(f) prose use of 'proof-of-commitment' without npx does NOT produce false positives", () => {
    // Prose sentences where proof-of-commitment is the product name, not a CLI invocation
    writeFileSync(
      FIXTURE_ASTRO,
      [
        "<h3>What proof-of-commitment sees today</h3>",
        "<p>proof-of-commitment scores each package on behavioral signals.</p>",
        "<p>proof-of-commitment surfaces supply chain risk at install time.</p>",
        "<p>proof-of-commitment implements a behavioral model.</p>",
      ].join("\n") + "\n"
    );

    const { exitCode } = runGate();
    expect(exitCode).toBe(0);
  });
});
