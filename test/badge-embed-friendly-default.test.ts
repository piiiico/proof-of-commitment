/**
 * Badge embed-friendly default — `/badge/*`, `/badge/npm/*`, `/badge/pypi/*`.
 *
 * What this pins
 * ──────────────
 *  1. The DEFAULT badge response (no query params) must NOT contain the
 *     verbose risk-class suffix words "CRITICAL", "WARNING", or "OK" in
 *     the value text. Reason: those words burnt into a maintainer's
 *     README badge are hostile to adoption — a perfectly healthy package
 *     like lodash (score 80, single publisher + 10M+ weekly DLs) would
 *     otherwise carry "80 | CRITICAL" red on its README. No maintainer
 *     embeds that. The COLOR still carries the risk signal; clicking the
 *     badge opens /audit for full context.
 *  2. The `?label=full` query opt-in preserves the legacy verbose
 *     suffix for diagnostic / dashboard use cases that explicitly want
 *     it. Backwards compat: anyone who reads "{score} | CRITICAL" out of
 *     the badge SVG must explicitly opt in.
 *  3. The risk-class color mapping is unchanged: red for isCritical
 *     OR low score (both /badge/npm/* and /badge/pypi/* black→red shift
 *     ONLY applies when fullLabel is false; verbose mode keeps the
 *     historical black isCritical color so audit tooling still sees the
 *     stronger visual signal).
 *
 * Why a gate. The /badge/* endpoint is the discovery surface — every
 * README badge is one click away from /audit and one signup away from
 * a paid conversion. If a future refactor re-adds the verbose suffix to
 * the default, maintainer adoption collapses silently (no error, no
 * test failure, just zero embeds). This test makes that regression
 * loud.
 *
 * Net-subtractive: the change SUBTRACTS the contradictory label from
 * the default path. Verbose mode is preserved as opt-in. Per CLAUDE.md
 * Worldview "Behavioral compliance > declarative compliance" — the
 * BEHAVIOR (whether the SVG ships with a scary word) is gated, not the
 * intent.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const WORKER_SOURCE = readFileSync(
  join(import.meta.dir, "..", "src", "backend", "worker.ts"),
  "utf-8",
);

// Helper: extract the body of a specific app.get handler by literal route match.
function extractHandlerBody(routeLiteral: string): string {
  const startIdx = WORKER_SOURCE.indexOf(`app.get(${routeLiteral}`);
  if (startIdx === -1) {
    throw new Error(`Handler not found: ${routeLiteral}`);
  }
  // Walk forward to find the matching end of the handler. We bound to next
  // app.get( call, which works because handlers are sequential top-level.
  const nextHandlerIdx = WORKER_SOURCE.indexOf("app.get(", startIdx + 1);
  return WORKER_SOURCE.slice(startIdx, nextHandlerIdx === -1 ? undefined : nextHandlerIdx);
}

describe("/badge/* (short URL) — embed-friendly default", () => {
  const body = extractHandlerBody(`"/badge/*"`);

  test("handler reads ?label=full query param", () => {
    expect(body).toMatch(/c\.req\.query\(["']label["']\)\s*===\s*["']full["']/);
  });

  test("CRITICAL ternary: verbose only, default drops suffix", () => {
    // Must contain a ternary that picks plain `${score}` when fullLabel is false
    expect(body).toMatch(
      /fullLabel\s*\?\s*`\$\{score\}\s*\|\s*CRITICAL`\s*:\s*`\$\{score\}`/,
    );
  });

  test("WARNING ternary: verbose only, default drops suffix", () => {
    expect(body).toMatch(
      /fullLabel\s*\?\s*`\$\{score\}\s*\|\s*WARNING`\s*:\s*`\$\{score\}`/,
    );
  });

  test("OK ternary: verbose only, default drops suffix", () => {
    expect(body).toMatch(
      /fullLabel\s*\?\s*`\$\{score\}\s*\|\s*OK`\s*:\s*`\$\{score\}`/,
    );
  });

  test("no unconditional ' | CRITICAL' / ' | WARNING' / ' | OK' string assignment", () => {
    // Belt-and-suspenders: must not have a bare assignment of the
    // verbose label without the ternary guard.
    expect(body).not.toMatch(/value\s*=\s*`\$\{score\}\s*\|\s*CRITICAL`/);
    expect(body).not.toMatch(/value\s*=\s*`\$\{score\}\s*\|\s*WARNING`/);
    expect(body).not.toMatch(/value\s*=\s*`\$\{score\}\s*\|\s*OK`/);
  });
});

describe("/badge/npm/* — embed-friendly default", () => {
  const body = extractHandlerBody(`"/badge/npm/*"`);

  test("handler reads ?label=full query param", () => {
    expect(body).toMatch(/c\.req\.query\(["']label["']\)\s*===\s*["']full["']/);
  });

  test("isCritical default value drops 'CRITICAL' suffix; falls back to plain ${score}/100", () => {
    // Pin the ternary inside the isCritical branch
    expect(body).toMatch(
      /fullLabel\s*\?\s*`\$\{score\}\/100\s+CRITICAL`\s*:\s*`\$\{score\}\/100`/,
    );
  });

  test("isCritical default color is red (#e05d44), not black (#222222)", () => {
    // The color must switch from black-in-full to red-in-default
    expect(body).toMatch(/fullLabel\s*\?\s*["']#222222["']\s*:\s*["']#e05d44["']/);
  });
});

describe("/badge/pypi/* — embed-friendly default", () => {
  const body = extractHandlerBody(`"/badge/pypi/*"`);

  test("handler reads ?label=full query param", () => {
    expect(body).toMatch(/c\.req\.query\(["']label["']\)\s*===\s*["']full["']/);
  });

  test("isCritical default value drops 'CRITICAL' suffix; falls back to plain ${score}/100", () => {
    expect(body).toMatch(
      /fullLabel\s*\?\s*`\$\{score\}\/100\s+CRITICAL`\s*:\s*`\$\{score\}\/100`/,
    );
  });

  test("isCritical default color is red (#e05d44), not black (#222222)", () => {
    expect(body).toMatch(/fullLabel\s*\?\s*["']#222222["']\s*:\s*["']#e05d44["']/);
  });
});

describe("Cross-endpoint invariants", () => {
  test("all three badge endpoints expose ?label=full opt-in", () => {
    const shortBody = extractHandlerBody(`"/badge/*"`);
    const npmBody = extractHandlerBody(`"/badge/npm/*"`);
    const pypiBody = extractHandlerBody(`"/badge/pypi/*"`);
    for (const body of [shortBody, npmBody, pypiBody]) {
      expect(body).toContain('"label"');
      expect(body).toContain('"full"');
    }
  });
});
