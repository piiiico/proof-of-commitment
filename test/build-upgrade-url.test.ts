/**
 * Tests for buildUpgradeUrl — the single source of truth for /pricing URLs
 * surfaced from authenticated-key contexts (429 quota, 402 pro-feature,
 * 422 pkg-cap, dashboard signed-in usage).
 *
 * Why this is worth testing: the URL must carry both the email pre-fill
 * AND the utm_campaign=key-upgrade tag so that
 *   1. /pricing checkout modal pre-fills email (one less re-type), and
 *   2. CONTEXT_BY_CAMPAIGN['key-upgrade'] in pricing.astro fires the
 *      "From your Commit account" banner, and
 *   3. checkout-webhook attribution (worker.ts:6954) reads
 *      metadata.utm_campaign first → api_keys.source = 'key-upgrade'
 *      instead of silently bucketing to 'web'.
 *
 * If any of these three break, paid conversions from signed-in upgrade
 * surfaces become invisible in source_breakdown (same asymmetry as the
 * 2026-06-10 audit-overshoot CONTEXT_BY_CAMPAIGN gap). The shape is
 * cheap to assert; the regression would cost a quiet measurement leak.
 */

import { describe, expect, test } from "bun:test";
import { buildUpgradeUrl } from "../src/backend/worker.ts";

describe("buildUpgradeUrl", () => {
  test("returns pricing URL with utm_campaign + utm_source even without email", () => {
    const url = new URL(buildUpgradeUrl(undefined));
    expect(url.origin + url.pathname).toBe("https://getcommit.dev/pricing");
    expect(url.searchParams.get("utm_campaign")).toBe("key-upgrade");
    expect(url.searchParams.get("utm_source")).toBe("key");
    expect(url.searchParams.get("email")).toBeNull();
    expect(url.searchParams.get("utm_medium")).toBeNull();
  });

  test("includes email pre-fill when provided", () => {
    const url = new URL(buildUpgradeUrl("user@example.com"));
    expect(url.searchParams.get("email")).toBe("user@example.com");
    expect(url.searchParams.get("utm_campaign")).toBe("key-upgrade");
  });

  test("URL-encodes email with special characters", () => {
    const url = new URL(buildUpgradeUrl("user+tag@example.com"));
    expect(url.searchParams.get("email")).toBe("user+tag@example.com");
  });

  test("medium tags each upgrade surface for analytics replay", () => {
    for (const medium of ["quota", "pro-feature", "pkg-cap", "dashboard"]) {
      const url = new URL(buildUpgradeUrl("u@e.com", { medium }));
      expect(url.searchParams.get("utm_medium")).toBe(medium);
      // Campaign stays canonical regardless of medium so attribution buckets
      // collapse to one 'key-upgrade' source — medium is detail, not split.
      expect(url.searchParams.get("utm_campaign")).toBe("key-upgrade");
    }
  });

  test("empty medium does not emit empty utm_medium param", () => {
    const url = new URL(buildUpgradeUrl("u@e.com", {}));
    expect(url.searchParams.get("utm_medium")).toBeNull();
  });
});
