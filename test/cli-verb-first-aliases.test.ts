/**
 * Verb-first subcommand aliases — npm-package@1.29.1+.
 *
 * Failure recovered: 2026-06-11 buyer-journey dogfood.
 * ────────────────────────────────────────────────────
 * Our blog post at /workspace/commit-landing-v2/src/pages/blog/npm-trust-q2-2026.astro:559
 * advertises:
 *     npx proof-of-commitment audit
 *
 * But up to v1.29.0 the CLI had no `audit` subcommand. The arg parser saw
 * `audit` as a POSITIONAL PACKAGE NAME (line 2619), so:
 *
 *   1. Auto-detect was skipped because packages.length > 0.
 *   2. The CLI scored npmjs.com/package/audit — a 13.9y-old unrelated
 *      utility unrelated to the user's project.
 *   3. The user's daily quota was consumed on the wrong package.
 *   4. The advertised flow was BROKEN in the most embarrassing way for a
 *      security tool: the trust message ("we know what's in your deps")
 *      collapses when the very first command we ship doesn't read deps.
 *
 * Why aliases (not a new code path).
 * ────────────────────────────────────
 * Every other ecosystem put the verb first: `npm audit`, `yarn audit`,
 * `pnpm audit`, `cargo audit`, `pip-audit`. Users will type `audit`
 * regardless of whether we want them to. So we shift the verb off and
 * fall through to the existing main flow — preserving --file, --pypi,
 * --json, --fail-on, package-positional, and auto-detect behavior with
 * one code site. `scan` and `check` cover the other common verbs.
 *
 * What this file pins.
 * ────────────────────
 *   1. The three aliases (audit, scan, check) appear in the subcommand
 *      dispatch block and shift off args[0]. If they ever leave the
 *      dispatch they'll be re-parsed as package names — same regression.
 *   2. The blog-advertised invariant: `npx proof-of-commitment audit`
 *      with a package.json in cwd must auto-detect (not score a package
 *      called "audit"). We assert this via the source-level invariant
 *      that the dispatch precedes the positional parser.
 *   3. All advertised subcommands are present (init, login, status,
 *      logout, hook, report, watch, watchlist, unwatch, audit, scan,
 *      check) — protects against accidental deletion when refactoring
 *      the dispatch.
 *
 * Regression class. Same plain-text invariant approach as
 * cli-soft-cta-gate.test.ts / cli-watch-seed-gate.test.ts: the CLI is a
 * standalone Node script with no shared runtime, so cheap text-level
 * pins beat heavyweight spawn-and-inspect tests.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const CLI_SOURCE = readFileSync(
  join(import.meta.dir, "..", "npm-package", "index.js"),
  "utf-8",
);

describe("verb-first subcommand aliases (audit/scan/check)", () => {
  test("source contains explicit alias dispatch for all three verbs", () => {
    // The single-line check that prevents the regression. If someone
    // refactors the dispatch into separate `if` blocks it still passes
    // because we look for each verb individually below — this just
    // catches the case where the whole block is deleted.
    expect(CLI_SOURCE).toMatch(/subcmd\s*===\s*['"]audit['"]/);
    expect(CLI_SOURCE).toMatch(/subcmd\s*===\s*['"]scan['"]/);
    expect(CLI_SOURCE).toMatch(/subcmd\s*===\s*['"]check['"]/);
  });

  test("alias block shifts args[0] (otherwise it falls through to positional parse)", () => {
    // The shift() is what makes the rest of main() see "no positional
    // package" and trigger auto-detect. Without it, even with the alias
    // branch matching, `audit` would still be treated as a package name
    // in the positional loop.
    const aliasBlock = CLI_SOURCE.match(
      /subcmd === ['"]audit['"][\s\S]{0,800}?(?=\n\s{2}if \(subcmd === ['"]init['"])/,
    );
    expect(aliasBlock).not.toBeNull();
    expect(aliasBlock![0]).toMatch(/args\.shift\(\)/);
  });

  test("alias dispatch precedes the positional parser (otherwise packages.push happens first)", () => {
    // If the alias block sat after `else { packages.push(a); i++; }` it
    // would never fire — the `while (i < args.length)` loop would have
    // already classified `audit` as a positional package. We assert the
    // dispatch is in `main()` before the positional loop by checking
    // file offsets.
    const aliasIdx = CLI_SOURCE.indexOf("subcmd === 'audit'");
    const positionalIdx = CLI_SOURCE.indexOf(
      "else { packages.push(a); i++; }",
    );
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(positionalIdx).toBeGreaterThan(-1);
    expect(aliasIdx).toBeLessThan(positionalIdx);
  });

  test("subcmd is declared with let, not const (alias block needs to reassign)", () => {
    // After args.shift() the alias block reassigns subcmd = args[0] so
    // chained calls like `proof-of-commitment audit init` route to the
    // init handler. If subcmd is `const` the reassignment throws at
    // runtime — and the alias is useless. This guards the declaration.
    expect(CLI_SOURCE).toMatch(/let subcmd = args\[0\]/);
  });

  test("all advertised subcommands remain present after alias addition", () => {
    // Snapshot of the dispatched subcommands. If a future refactor drops
    // one (e.g., removing `unwatch` by accident while editing the alias
    // block), this catches it. Order matches README + printHelp output.
    for (const verb of [
      "init",
      "login",
      "status",
      "logout",
      "hook",
      "report",
      "watch",
      "watchlist",
      "unwatch",
      "audit",
      "scan",
      "check",
    ]) {
      expect(CLI_SOURCE).toContain(`subcmd === '${verb}'`);
    }
  });

  test("help text documents the audit alias (so `--help` matches blog post)", () => {
    // Blog post npm-trust-q2-2026.astro:559 shows `npx proof-of-commitment audit`.
    // Help text must include `audit` so `--help` answers "is this real?" with yes.
    expect(CLI_SOURCE).toMatch(/audit\s+Same — verb-first alias \(also: scan, check\)/);
  });
});
