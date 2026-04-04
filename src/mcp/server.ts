/**
 * Proof of Commitment — MCP Server
 *
 * Exposes commitment data to AI models via the Model Context Protocol.
 *
 * Tools:
 *   query_commitment({ domain })       — behavioral commitment data for a domain
 *   lookup_business({ query })         — Norwegian business commitment profile (Brreg public data)
 *   lookup_business_by_org({ orgNumber }) — direct org number lookup
 *   lookup_github_repo({ repo })       — GitHub repo behavioral commitment profile
 *
 * Usage:
 *   BACKEND_URL=https://poc-backend.amdal-dev.workers.dev bun run src/mcp/server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildCommitmentProfile,
  searchAndProfile,
} from "../backend/brreg.ts";
import { buildGitHubCommitmentProfile, parseGitHubInput } from "../backend/github.ts";

const BACKEND_URL =
  process.env.BACKEND_URL ?? "https://poc-backend.amdal-dev.workers.dev";

// ── Server ──

const server = new McpServer({
  name: "proof-of-commitment",
  version: "0.4.0",
});

// ── Tool: query_commitment ──

server.tool(
  "query_commitment",
  "Query verified behavioral commitment data for a domain. Returns aggregated signals: unique verified visitors, repeat visit rate, and average time spent. These prove real human engagement — harder to fake than reviews or content.",
  {
    domain: z
      .string()
      .describe(
        "The domain to query (e.g. 'example.com'). Will be normalized to lowercase without protocol or path."
      ),
  },
  async ({ domain }) => {
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

      const data = (await res.json()) as any;

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
              data.lastUpdated ? `Last updated: ${data.lastUpdated}` : null,
            ]
              .filter(Boolean)
              .join("\n");

      return {
        content: [
          { type: "text" as const, text: summary },
          {
            type: "text" as const,
            text: JSON.stringify(
              { ...data, repeatRate, avgMinutes },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
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

// ── Tool: lookup_business ──

server.tool(
  "lookup_business",
  `Search for a Norwegian business and get its commitment profile from public data (Brønnøysund Register Centre). Returns real commitment signals that can't be faked:

- Temporal commitment: how long the business has operated
- Financial commitment: revenue, profitability, equity health
- Operational commitment: employee count, active status
- Overall commitment score (0-100)

Data source: Norwegian government registers (Brreg). No user-contributed data needed — immediate trust verification for any Norwegian business.`,
  {
    query: z
      .string()
      .describe(
        "Business name to search for (e.g. 'Peppes Pizza', 'Equinor')"
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Maximum number of results to return (default: 3)"),
  },
  async ({ query, maxResults }) => {
    try {
      const profiles = await searchAndProfile(query, maxResults ?? 3);

      if (profiles.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No Norwegian businesses found matching "${query}".`,
            },
          ],
        };
      }

      const summaries = profiles.map((p) => p.summary).join("\n\n---\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${profiles.length} business(es) matching "${query}":\n\n${summaries}`,
          },
          {
            type: "text" as const,
            text: JSON.stringify(
              profiles.map((p) => ({
                orgNumber: p.orgNumber,
                name: p.name,
                yearsOperating: p.yearsOperating,
                employees: p.employees,
                industry: p.industry,
                isActive: p.isActive,
                financials: p.financials,
                signals: p.signals,
              })),
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching businesses: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool: lookup_business_by_org ──

server.tool(
  "lookup_business_by_org",
  `Look up a specific Norwegian business by organization number and get its commitment profile from public data (Brønnøysund Register Centre). Returns real commitment signals: longevity, financial health, operational activity, and overall commitment score.`,
  {
    orgNumber: z
      .string()
      .describe(
        "Norwegian organization number (9 digits, e.g. '984388659')"
      ),
  },
  async ({ orgNumber }) => {
    try {
      const profile = await buildCommitmentProfile(orgNumber);

      if (!profile) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No business found with organization number ${orgNumber}.`,
            },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: profile.summary },
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                orgNumber: profile.orgNumber,
                name: profile.name,
                yearsOperating: profile.yearsOperating,
                employees: profile.employees,
                industry: profile.industry,
                isActive: profile.isActive,
                financials: profile.financials,
                signals: profile.signals,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error looking up business: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool: lookup_github_repo ──

server.tool(
  "lookup_github_repo",
  `Get a behavioral commitment profile for any public GitHub repository. Returns real signals: how long the project has existed, recent commit frequency, contributor community size, release cadence, and social proof. These are behavioral commitments — harder to fake than README claims.

Useful for: vetting open-source dependencies, evaluating AI tools/frameworks, assessing vendor reliability.
Examples: "vercel/next.js", "facebook/react", "https://github.com/piiiico/proof-of-commitment"`,
  {
    repo: z
      .string()
      .describe(
        'GitHub repository in "owner/repo" format or full URL. Example: "vercel/next.js"'
      ),
  },
  async ({ repo }) => {
    const parsed = parseGitHubInput(repo);
    if (!parsed) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid GitHub repo format. Use "owner/repo". Example: "vercel/next.js"`,
          },
        ],
        isError: true,
      };
    }

    try {
      const profile = await buildGitHubCommitmentProfile(
        parsed.owner,
        parsed.repo
      );

      if (!profile) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Repository ${parsed.owner}/${parsed.repo} not found or not accessible.`,
            },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: profile.summary },
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                fullName: profile.fullName,
                ageYears: Math.round(profile.ageYears * 10) / 10,
                stars: profile.stars,
                recentCommits30d: profile.recentCommits30d,
                contributorCount: profile.contributorCount,
                commitmentScore: profile.commitmentScore,
                scoreBreakdown: profile.scoreBreakdown,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          { type: "text" as const, text: `Error: ${message}` },
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
  console.error("Proof of Commitment MCP server v0.4.0 running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
