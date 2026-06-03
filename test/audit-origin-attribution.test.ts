/**
 * Regression test for the /api/audit 429 funnel-source attribution bug.
 *
 * Why this test exists:
 *   Before 2026-06-03, the 429 branch in /api/audit decided between
 *   `?ref=audit-cli-429` and `?ref=audit-web-429` purely by Accept header.
 *   That worked when only the web /audit page sent `Accept: application/json`
 *   and the CLI sent the default `Accept` (any). The CLI was upgraded in v1.17.0 to
 *   `Accept: application/json` so handle429() could parse the structured
 *   body — and from then on every CLI 429 was tagged `audit-web-429`,
 *   silently routing CLI users to the wrong /get-started variant and
 *   destroying source_breakdown attribution stats.
 *
 *   The fix swaps the heuristic to the Origin header (browsers set it on
 *   CORS fetch, Node fetch does not). This file pins that contract.
 *
 *   If `isGetcommitWebOrigin` starts returning true for the CLI's empty
 *   Origin, the test fires — and so does the bug. The point is to never
 *   drift back into "every JSON 429 is web" without somebody noticing.
 *
 * Run: `bun test test/audit-origin-attribution.test.ts`
 */

import { describe, expect, test } from "bun:test";
import { isGetcommitWebOrigin } from "../src/backend/worker.ts";

describe("isGetcommitWebOrigin", () => {
  test("matches the production web Origin", () => {
    expect(isGetcommitWebOrigin("https://getcommit.dev")).toBe(true);
  });

  test("matches getcommit.dev subdomains (staging, www)", () => {
    expect(isGetcommitWebOrigin("https://www.getcommit.dev")).toBe(true);
    expect(isGetcommitWebOrigin("https://staging.getcommit.dev")).toBe(true);
  });

  test("matches localhost (with and without port) for astro dev", () => {
    expect(isGetcommitWebOrigin("http://localhost")).toBe(true);
    expect(isGetcommitWebOrigin("http://localhost:4321")).toBe(true);
    expect(isGetcommitWebOrigin("http://localhost:3000")).toBe(true);
  });

  test("rejects empty / null / missing Origin (CLI Node fetch case)", () => {
    // This is the case the bug was about. Node's built-in fetch does not
    // set an Origin header. Hono returns undefined for absent headers; the
    // worker also normalises via `c.req.header("Origin") || ""`. Both
    // shapes must be rejected so the CLI keeps `ref=audit-cli-429`.
    expect(isGetcommitWebOrigin(undefined)).toBe(false);
    expect(isGetcommitWebOrigin(null)).toBe(false);
    expect(isGetcommitWebOrigin("")).toBe(false);
    expect(isGetcommitWebOrigin("null")).toBe(false); // some browsers send literal "null" for sandboxed iframes
  });

  test("rejects look-alike hosts (prevents homograph routing)", () => {
    expect(isGetcommitWebOrigin("https://getcommit.dev.evil.com")).toBe(false);
    expect(isGetcommitWebOrigin("https://evil.com/getcommit.dev")).toBe(false);
    expect(isGetcommitWebOrigin("https://notgetcommit.dev")).toBe(false);
    expect(isGetcommitWebOrigin("https://getcommitxdev")).toBe(false);
  });

  test("rejects unrelated origins (browser extensions, other sites)", () => {
    expect(isGetcommitWebOrigin("chrome-extension://abcd")).toBe(false);
    expect(isGetcommitWebOrigin("https://news.ycombinator.com")).toBe(false);
    expect(isGetcommitWebOrigin("http://192.168.1.1")).toBe(false);
  });

  test("is case-insensitive on scheme/host (browsers may lowercase, but be defensive)", () => {
    expect(isGetcommitWebOrigin("HTTPS://GETCOMMIT.DEV")).toBe(true);
    expect(isGetcommitWebOrigin("https://GetCommit.dev")).toBe(true);
  });
});
