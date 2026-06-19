/**
 * Tests for the GET /api/score/npm/* content-negotiation gate.
 *
 * Why this matters: the URL pattern
 *   https://poc-backend.amdal-dev.workers.dev/api/score/npm/<pkg>
 * is shipped publicly in:
 *   • commit-landing-v2/src/pages/blog/staged-publishing-detection.astro
 *   • dev.to article 3941372 (Staged Publishing detection write-up)
 *   • postcss/postcss#2096 comment 4752706038 (Sitnik thread, 869M weekly DL)
 * Each click in a browser would otherwise render raw JSON. The fix:
 * forward visitors with Accept: text/html to /scan/?pkg= so the score
 * card renders. ?format=json overrides (back-compat for API consumers
 * exploring the API in a browser); ?format=html forces the redirect.
 *
 * The Vary: Accept header on the JSON path tells intermediary caches
 * to store both representations separately — without it, a CDN could
 * pin one variant for all subsequent requests on the same URL.
 *
 * Regression risk if this breaks:
 *   • CLI / browser-extension fetch() (Accept star-slash-star) should still get JSON.
 *   • Sitnik-thread click (Accept: text/html,...) should land on score card.
 * Both directions matter; both are asserted below.
 */

import { describe, expect, test } from "bun:test";
import { prefersHtmlOverJson } from "../src/backend/worker.ts";

describe("prefersHtmlOverJson — Accept-header content negotiation", () => {
  test("returns true for typical Chrome/Firefox Accept header", () => {
    // Chrome sends this on top-level navigation
    const chrome =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
    expect(prefersHtmlOverJson(chrome)).toBe(true);
  });

  test("returns true for Firefox Accept header", () => {
    const firefox = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    expect(prefersHtmlOverJson(firefox)).toBe(true);
  });

  test("returns false for curl default (*/*)", () => {
    expect(prefersHtmlOverJson("*/*")).toBe(false);
  });

  test("returns false for node-fetch / undici default (*/*)", () => {
    // Node 18+ fetch defaults to */* — must not redirect, the CLI relies on JSON
    expect(prefersHtmlOverJson("*/*")).toBe(false);
  });

  test("returns false when Accept is missing", () => {
    expect(prefersHtmlOverJson(undefined)).toBe(false);
    expect(prefersHtmlOverJson(null)).toBe(false);
    expect(prefersHtmlOverJson("")).toBe(false);
  });

  test("returns false when Accept explicitly prefers JSON over HTML", () => {
    // Programmatic API client that names both but prefers JSON
    expect(prefersHtmlOverJson("application/json,text/html;q=0.5")).toBe(false);
  });

  test("returns true when text/html ties with application/json (q=1.0 both)", () => {
    // Browser-side fetch() with custom Accept naming both — default to HTML
    // so shared-link UX wins by default; client can override with ?format=json
    expect(prefersHtmlOverJson("text/html,application/json")).toBe(true);
  });

  test("returns false for plain application/json", () => {
    expect(prefersHtmlOverJson("application/json")).toBe(false);
  });

  test("handles case-insensitive Accept", () => {
    expect(prefersHtmlOverJson("TEXT/HTML,APPLICATION/JSON;Q=0.5")).toBe(true);
  });

  test("ignores tokens with malformed q-values without crashing", () => {
    // q=abc → NaN → token skipped entirely; result must not throw.
    // Safer default: when html's q is invalid, fall through to JSON.
    expect(() => prefersHtmlOverJson("text/html;q=abc,application/json;q=0.5")).not.toThrow();
    expect(prefersHtmlOverJson("text/html;q=abc,application/json;q=0.5")).toBe(false);
  });
});
