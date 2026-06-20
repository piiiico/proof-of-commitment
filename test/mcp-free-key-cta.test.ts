/**
 * Tests for mcpFreeKeyCtaText — the soft-CTA appended to MCP tool results
 * for FREE-tier API key holders past usage milestones.
 *
 * Why this exists: pre-2026-06-20, withMcpRateLimit bypassed all friction
 * for any holder of a valid API key (free + paid alike). The 149-keys-0-paying
 * gap traced to this: free-key MCP users saw ZERO upgrade pressure. This
 * test pins the soft-CTA copy so a refactor can't silently delete it.
 *
 * Run: `bun test test/mcp-free-key-cta.test.ts`
 */

import { describe, expect, test } from "bun:test";
import {
  mcpFreeKeyCtaText,
  MCP_FREE_KEY_SOFT_CTA_AT,
  MCP_FREE_KEY_STRONG_CTA_AT,
} from "../src/backend/worker.ts";

describe("mcpFreeKeyCtaText", () => {
  test("soft variant: count below STRONG threshold", () => {
    const out = mcpFreeKeyCtaText(MCP_FREE_KEY_SOFT_CTA_AT, "user@example.com");
    expect(out).toContain(`Commit MCP — ${MCP_FREE_KEY_SOFT_CTA_AT} audits today`);
    expect(out).toContain("free key (unlimited)");
    expect(out).toContain("Developer ($15/mo)");
    expect(out).toContain("getcommit.dev/pricing");
    expect(out).toContain("email=user%40example.com");
    expect(out).toContain("utm_medium=mcp-free-key");
    expect(out).toContain("utm_campaign=key-upgrade");
    // Soft variant is single-line value pitch, NOT the multi-bullet strong one.
    expect(out).not.toContain("Auto-trigger GitHub Action");
  });

  test("strong variant: count at STRONG threshold", () => {
    const out = mcpFreeKeyCtaText(MCP_FREE_KEY_STRONG_CTA_AT, "heavy@example.com");
    expect(out).toContain(`Commit MCP — ${MCP_FREE_KEY_STRONG_CTA_AT} audits today`);
    expect(out).toContain("free key, unlimited");
    expect(out).toContain("Auto-trigger GitHub Action");
    expect(out).toContain("Instant email alerts");
    expect(out).toContain("50 GitHub repo audits");
    expect(out).toContain("Batch API");
    expect(out).toContain("email=heavy%40example.com");
  });

  test("strong variant: count well above STRONG threshold", () => {
    const out = mcpFreeKeyCtaText(100, "user@example.com");
    expect(out).toContain("Commit MCP — 100 audits today");
    expect(out).toContain("Auto-trigger GitHub Action");
  });

  test("no email: URL still valid without email param", () => {
    const out = mcpFreeKeyCtaText(15, undefined);
    expect(out).toContain("getcommit.dev/pricing");
    expect(out).toContain("utm_medium=mcp-free-key");
    expect(out).not.toContain("email=");
  });

  test("URL never contains hard-limit framing — pricing promise is unlimited", () => {
    const soft = mcpFreeKeyCtaText(MCP_FREE_KEY_SOFT_CTA_AT, "x@y.com");
    const strong = mcpFreeKeyCtaText(MCP_FREE_KEY_STRONG_CTA_AT, "x@y.com");
    for (const text of [soft, strong]) {
      expect(text).not.toContain("/15"); // no "/HARD_LIMIT" anywhere
      expect(text).not.toContain("limit reached");
      expect(text).not.toContain("wall");
      expect(text).not.toContain("left)");
    }
  });

  test("thresholds: soft < strong", () => {
    expect(MCP_FREE_KEY_SOFT_CTA_AT).toBeLessThan(MCP_FREE_KEY_STRONG_CTA_AT);
    // And both above anon MCP_SOFT_CTA_AT (5) — free keys get LESS friction
    // than anonymous, since they already opted in.
    expect(MCP_FREE_KEY_SOFT_CTA_AT).toBeGreaterThanOrEqual(10);
  });
});
