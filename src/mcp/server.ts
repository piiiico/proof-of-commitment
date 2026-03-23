/**
 * Proof of Commitment — MCP Server
 *
 * Exposes commitment aggregates to AI models via the Model Context Protocol.
 * Wraps the backend aggregator API (GET /api/domain/:domain).
 *
 * Usage:
 *   BACKEND_URL=https://poc-backend.amdal-dev.workers.dev bun run src/mcp/server.ts
 *
 * MCP tool:
 *   query_commitment({ domain }) → { domain, uniqueCommitments, totalVisits, ... }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BACKEND_URL = process.env.BACKEND_URL ?? "https://poc-backend.amdal-dev.workers.dev";

// ── Server ──

const server = new McpServer({
  name: "proof-of-commitment",
  version: "0.1.0",
});

// ── Tool: query_commitment ──

server.tool(
  "query_commitment",
  "Query verified commitment data for a domain. Returns aggregated behavioral signals: how many unique verified visitors, repeat visit rate, and average time spent. These signals prove real human engagement — harder to fake than reviews or content.",
  {
    domain: z.string().describe(
      "The domain to query (e.g. 'example.com'). Will be normalized to lowercase without protocol or path."
    ),
  },
  async ({ domain }) => {
    // Normalize domain: strip protocol, path, lowercase
    const normalized = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]!;

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/domain/${encodeURIComponent(normalized)}`
      );

      if (!res.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Backend error: ${res.status} ${res.statusText}`,
            },
          ],
          isError: true,
        };
      }

      const data = await res.json();

      // Compute derived metrics for AI consumption
      const repeatRate =
        data.uniqueCommitments > 0 && data.totalVisits > 0
          ? Math.round(
              ((data.totalVisits - data.uniqueCommitments) /
                data.totalVisits) *
                100
            )
          : 0;

      const avgMinutes =
        data.avgSeconds > 0 ? Math.round(data.avgSeconds / 60) : 0;

      // Build human-readable summary alongside raw data
      const summary =
        data.uniqueCommitments === 0
          ? `No verified commitment data for ${normalized}.`
          : [
              `Domain: ${normalized}`,
              `Verified unique visitors: ${data.uniqueCommitments}`,
              `Total visits: ${data.totalVisits}`,
              `Repeat visit rate: ${repeatRate}%`,
              `Average time per visitor: ${avgMinutes} minutes (${Math.round(data.avgSeconds)}s)`,
              `Total time invested: ${Math.round(data.totalSeconds / 3600)} hours`,
              data.lastUpdated
                ? `Last updated: ${data.lastUpdated}`
                : null,
            ]
              .filter(Boolean)
              .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: summary,
          },
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ...data,
                repeatRate,
                avgMinutes,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to reach backend at ${BACKEND_URL}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Proof of Commitment MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
