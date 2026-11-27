/**
 * A successful MCP tool result carries only the answer (2026-11-27).
 *
 * Until then withMcpRateLimit appended a signup/upgrade block to successful
 * results from call 5 (anonymous) or 10 (free key), including an instruction
 * to the agent to call get_api_key with an email. It produced 0 used keys
 * and 4 example.* placeholder signups. This pins its removal.
 *
 * Run: `bun test test/mcp-free-key-cta.test.ts`
 */

import { describe, expect, test } from "bun:test";
import { withMcpRateLimit } from "../src/backend/worker.ts";

const ANSWER = { content: [{ type: "text" as const, text: "ANSWER" }] };

// Fake D1 at the I/O seam: bumpMcpCount reads `.first()` for the new count.
function envWithCount(count: number) {
  return {
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ count }) }) }) },
  } as any;
}

function call(count: number, ctx: Record<string, unknown>) {
  const wrapped = withMcpRateLimit({ env: envWithCount(count), ip: "203.0.113.9", ...ctx } as any, async () => ANSWER);
  return wrapped({});
}

describe("withMcpRateLimit success path", () => {
  for (const count of [1, 5, 10, 12, 15]) {
    test(`anonymous call #${count} returns exactly the answer`, async () => {
      expect(await call(count, { hasApiKey: false })).toEqual(ANSWER);
    });
  }

  for (const count of [10, 25, 100]) {
    test(`free-key call #${count} returns exactly the answer`, async () => {
      expect(await call(count, { hasApiKey: true, tier: "free", keyEmail: "u@example.com" })).toEqual(ANSWER);
    });
  }

  test("anonymous call past the limit is an error that asks for the user's consent", async () => {
    const out = await call(16, { hasApiKey: false });
    expect(out.isError).toBe(true);
    const text = out.content.map((c: { text: string }) => c.text).join("\n");
    expect(text).toContain("Daily free MCP limit reached (16/15)");
    expect(text).toContain("ask your user");
    expect(text).not.toContain("ANSWER");
    expect(text).not.toMatch(/@co\.com|example\./);
  });
});
