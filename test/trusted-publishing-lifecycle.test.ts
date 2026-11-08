import { describe, expect, test } from "bun:test";
import { analyzePublisherLifecycle } from "../src/backend/npm";

// esbuild shape (registry, read 2026-11-08): human evanw published until
// 2025-11-01, then every release via "GitHub Actions" trusted publishing;
// maintainers = [esbuild]. The audit API flagged "CRITICAL: sole active npm
// publisher" while publisherLifecycle.activePublishers read 0.
const NOW = Date.parse("2026-11-08T00:00:00Z");
const OIDC = { name: "GitHub Actions", email: "npm-oidc-no-reply@github.com" };
const EVANW = { name: "evanw", email: "evan.exe@gmail.com" };

function esbuildShape(ciDate: string) {
  return {
    versions: { "0.27.0": { _npmUser: EVANW }, "0.28.2": { _npmUser: OIDC } },
    time: { "0.27.0": "2025-11-01T00:00:00Z", "0.28.2": ciDate },
    maintainers: [{ name: "esbuild" }],
  };
}

describe("publisher lifecycle on trusted-publishing packages", () => {
  test("recent OIDC release → one active publisher, agreeing with 'sole active publisher'", () => {
    const lc = analyzePublisherLifecycle(esbuildShape("2026-08-08T20:00:55Z"), NOW)!;
    expect(lc.trustedPublisherActive).toBe(true);
    expect(lc.activePublishers).toBe(1);
    expect(lc.dormantRevoked).toBe(1);
    expect(lc.activeRatio).toBeLessThanOrEqual(1);
  });

  test("OIDC release older than 12 months does not count as active", () => {
    const lc = analyzePublisherLifecycle(esbuildShape("2025-06-01T00:00:00Z"), NOW)!;
    expect(lc.trustedPublisherActive).toBe(false);
    expect(lc.activePublishers).toBe(0);
  });

  test("multi-maintainer OIDC package counts maintainers minus dormant-with-access", () => {
    const lc = analyzePublisherLifecycle({
      versions: { "1.0.0": { _npmUser: { name: "alice" } }, "2.0.0": { _npmUser: OIDC } },
      time: { "1.0.0": "2020-01-01T00:00:00Z", "2.0.0": "2026-10-01T00:00:00Z" },
      maintainers: [{ name: "alice" }, { name: "bob" }, { name: "carol" }],
    }, NOW)!;
    expect(lc.dormantWithAccess).toBe(1);
    expect(lc.activePublishers).toBe(2);
  });

  test("human active publisher is not inflated by OIDC releases", () => {
    const lc = analyzePublisherLifecycle({
      versions: { "1.0.0": { _npmUser: { name: "alice" } }, "2.0.0": { _npmUser: OIDC } },
      time: { "1.0.0": "2026-09-01T00:00:00Z", "2.0.0": "2026-10-01T00:00:00Z" },
      maintainers: [{ name: "alice" }, { name: "bob" }, { name: "carol" }],
    }, NOW)!;
    expect(lc.activePublishers).toBe(1);
  });
});
