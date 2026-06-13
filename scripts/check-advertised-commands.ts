#!/usr/bin/env bun
/**
 * check-advertised-commands.ts — Docs ↔ CLI verb-parity gate.
 *
 * Regression class: a blog post or README advertises a verb that the CLI
 * doesn't recognize, causing the CLI to treat it as a package name and
 * silently score the wrong package.
 *
 * Caught in production: npm-trust-q2-2026.astro:559 advertised
 *   `npx proof-of-commitment audit`
 * but the CLI lacked the `audit` subcommand until v1.29.1. The CLI parsed
 * `audit` as a positional package name and scored the unrelated
 * npmjs.com/audit utility — wasting quota, breaking trust.
 *
 * Single source of truth: canonical verbs are derived from
 * npm-package/index.js at runtime (NOT hardcoded here). Any verb added to
 * the CLI is automatically recognized; any removal is automatically caught.
 *
 * Exit codes:
 *   0 — all advertised verbs are either canonical or in AUDIT_EXAMPLES
 *   1 — at least one unknown verb found (prints file:line:verb for each)
 *
 * Usage:
 *   bun scripts/check-advertised-commands.ts [--verbose]
 */

import { readFileSync } from "fs";
import { join, resolve, relative } from "path";
import { readdirSync, statSync } from "fs";

const VERBOSE = process.argv.includes("--verbose");

const SCRIPT_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

// ---------------------------------------------------------------------------
// AUDIT_EXAMPLES: explicit allowlist of package/ecosystem names that appear
// as positional arguments in example commands — NOT subcommands.
//
// Keep this list minimal. Add entries only when a blog post or README
// introduces a new example that uses a legitimate package name as the first
// positional arg (e.g. `npx proof-of-commitment hono`).
//
// Scoped packages (@scope/name) and flag-prefixed args (--file, --json) are
// excluded automatically by the regex and don't need entries here.
// ---------------------------------------------------------------------------
const AUDIT_EXAMPLES = new Set<string>([
  // npm packages used as auditing examples across blog posts and README
  "axios",
  "chalk",
  "lodash",
  "react",
  "typescript",
  "esbuild",
  "express",
  "hono",
  "zod",
  "minimatch",
  "openai",
  "clsx",
  "glob",         // invisible-critical-packages.astro
  "cross-spawn",  // invisible-critical-packages.astro
  "mcp-remote",   // mcp-security-landscape.astro
  "event-stream", // historical supply-chain malware example
  // Ecosystem prefix used as positional in some older examples
  // (e.g. `npx proof-of-commitment npm express`) — npm is treated as a
  // package name here, not a subcommand.
  "npm",
  // Python packages that might appear before a --pypi flag is added
  "litellm",
  "langchain",
  "requests",
  "certifi",
  "boto3",
  // Rust crates
  "serde",
  "tokio",
  "rand",
  "reqwest",
]);

// ---------------------------------------------------------------------------
// Extract canonical verb set from npm-package/index.js.
// Finds all: subcmd === 'verb'  (or "verb")
// Includes transparent aliases (audit/scan/check) and named subcommands.
// ---------------------------------------------------------------------------
function extractCanonicalVerbs(indexJsPath: string): Set<string> {
  const src = readFileSync(indexJsPath, "utf-8");
  const verbs = new Set<string>();

  // Matches: subcmd === 'init'  or  subcmd === "report"
  const pattern = /subcmd\s*===\s*['"]([a-z][a-z0-9-]*)['"]/g;
  for (const m of src.matchAll(pattern)) {
    verbs.add(m[1]);
  }

  if (verbs.size === 0) {
    throw new Error(
      `No canonical verbs found in ${indexJsPath}.\n` +
      `Expected patterns like: subcmd === 'init'\n` +
      `Check that the dispatch style hasn't changed.`
    );
  }

  return verbs;
}

// ---------------------------------------------------------------------------
// Recursively collect files matching the given extensions under a directory.
// ---------------------------------------------------------------------------
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (exts.some((e) => entry.endsWith(e))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Scan a file for CLI command mentions and return any violations.
// ---------------------------------------------------------------------------
interface Violation {
  file: string;
  line: number;
  col: number;
  rawMatch: string;
  verb: string;
  nearestCanonical: string[];
}

// Two distinct patterns to avoid prose false-positives:
//
// 1. npx-prefixed form: `npx proof-of-commitment <verb>`
//    Requires `npx` (with optional -y) before `proof-of-commitment`.
//    Without this requirement the regex matches prose like
//    "proof-of-commitment sees today" or "proof-of-commitment scores…"
//    which are brand-name uses in prose, not CLI invocations.
//
// 2. poc short form: `poc <verb>` — used when the binary is globally installed.
//    `poc` is lowercase-only and unlikely to appear in prose adjacent to a
//    command verb; scoped packages (@scope/name) are excluded by [a-z] first char.
//
// Flags and scoped packages (@scope/pkg) don't match [a-z] first-char so
// they're excluded naturally from both patterns.
const NPX_PATTERN =
  /npx\s+(?:-y\s+)?proof-of-commitment\s+([a-z][a-z0-9-]*)/g;
const POC_PATTERN =
  /\bpoc\s+([a-z][a-z0-9-]*)/g;

function scanFile(
  filePath: string,
  canonicalVerbs: Set<string>
): Violation[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: Violation[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    for (const pattern of [NPX_PATTERN, POC_PATTERN]) {
      pattern.lastIndex = 0; // reset stateful regex before each line scan

      for (const m of line.matchAll(pattern)) {
        const verb = m[1];

        // Skip flags (regex excludes -- prefix, but guard defensively)
        if (verb.startsWith("-")) continue;

        // OK: canonical CLI verb
        if (canonicalVerbs.has(verb)) continue;

        // OK: known package-name example in allowlist
        if (AUDIT_EXAMPLES.has(verb)) continue;

        // Violation: unknown verb advertised in docs
        const nearestCanonical = [...canonicalVerbs]
          .filter((v) => v.startsWith(verb[0]))
          .slice(0, 3);

        violations.push({
          file: filePath,
          line: lineIdx + 1,
          col: (m.index ?? 0) + 1,
          rawMatch: m[0],
          verb,
          nearestCanonical,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const indexJsPath = join(REPO_ROOT, "npm-package", "index.js");

  // 1. Derive canonical verb set from the live index.js (single source of truth)
  let canonicalVerbs: Set<string>;
  try {
    canonicalVerbs = extractCanonicalVerbs(indexJsPath);
  } catch (err) {
    console.error(`[check-advertised-commands] ERROR: ${(err as Error).message}`);
    process.exit(1);
  }

  if (VERBOSE) {
    console.log(
      `[check-advertised-commands] Canonical verbs: ${[...canonicalVerbs].join(", ")}`
    );
  }

  // 2. Collect doc files to scan
  const docFiles: string[] = [];

  // commit-landing-v2: .astro, .md, .mdx
  const landingDir = join(REPO_ROOT, "..", "commit-landing-v2", "src");
  try {
    docFiles.push(...collectFiles(landingDir, [".astro", ".md", ".mdx"]));
  } catch {
    // commit-landing-v2 may not exist in all CI environments — warn but continue
    console.warn(
      `[check-advertised-commands] WARNING: commit-landing-v2/src not found — skipping landing-page scan`
    );
  }

  // proof-of-commitment READMEs
  for (const readme of [
    join(REPO_ROOT, "README.md"),
    join(REPO_ROOT, "npm-package", "README.md"),
  ]) {
    try {
      statSync(readme); // throws if missing
      docFiles.push(readme);
    } catch {
      // optional
    }
  }

  if (VERBOSE) {
    console.log(
      `[check-advertised-commands] Scanning ${docFiles.length} files`
    );
  }

  // 3. Scan all files
  const allViolations: Violation[] = [];
  for (const f of docFiles) {
    const v = scanFile(f, canonicalVerbs);
    allViolations.push(...v);
  }

  // 4. Report
  if (allViolations.length === 0) {
    console.log(
      `[check-advertised-commands] ✓ All advertised CLI verbs match canonical set (${canonicalVerbs.size} verbs checked across ${docFiles.length} files)`
    );
    process.exit(0);
  }

  console.error(
    `[check-advertised-commands] ✗ Found ${allViolations.length} unknown CLI verb(s) advertised in docs:\n`
  );

  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file);
    const hint =
      v.nearestCanonical.length > 0
        ? `  nearest canonical: ${v.nearestCanonical.join(", ")}`
        : `  no similar canonical verb found`;
    console.error(
      `  ${rel}:${v.line}:${v.col}  unknown verb "${v.verb}"  (from: ${v.rawMatch})\n${hint}\n`
    );
  }

  console.error(
    `If "${allViolations[0]?.verb}" is a package name used in an example, add it to AUDIT_EXAMPLES in:\n` +
    `  proof-of-commitment/scripts/check-advertised-commands.ts\n\n` +
    `If it is a new subcommand, add the dispatch handler to:\n` +
    `  proof-of-commitment/npm-package/index.js`
  );

  process.exit(1);
}

main();
