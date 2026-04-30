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
 *   lookup_npm_package({ package })    — npm package behavioral commitment profile
 *   lookup_pypi_package({ package })   — PyPI package behavioral commitment profile
 *   audit_dependencies({ packages })  — batch risk audit for multiple npm/PyPI packages
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
import { buildNpmCommitmentProfile } from "../backend/npm.ts";
import { buildPyPICommitmentProfile } from "../backend/pypi.ts";

const BACKEND_URL =
  process.env.BACKEND_URL ?? "https://poc-backend.amdal-dev.workers.dev";

// ── Server ──

const server = new McpServer({
  name: "proof-of-commitment",
  version: "0.7.0",
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

// ── Tool: lookup_npm_package ──

server.tool(
  "lookup_npm_package",
  `Get a behavioral commitment profile for any npm package. Returns real signals: package age, download volume and trend (growing/stable/declining), release consistency, npm publisher count, GitHub contributor count, and linked GitHub activity.

Supply chain attacks target packages with low publisher depth (few people with npm publish access). Behavioral signals reveal what download counts hide.

Useful for: vetting dependencies, identifying abandonware, due diligence on open-source packages.
Examples: "langchain", "@anthropic-ai/sdk", "express", "litellm"`,
  {
    package: z
      .string()
      .describe(
        'npm package name. Examples: "langchain", "@anthropic-ai/sdk", "express". Scoped packages need the @ prefix.'
      ),
  },
  async ({ package: packageName }) => {
    try {
      const profile = await buildNpmCommitmentProfile(packageName);

      if (!profile) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Package "${packageName}" not found on npm registry.`,
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
                name: profile.name,
                latestVersion: profile.latestVersion,
                ageYears: Math.round(profile.ageYears * 10) / 10,
                versionCount: profile.versionCount,
                maintainerCount: profile.maintainerCount,
                recentWeeklyDownloads: profile.recentWeeklyDownloads,
                downloadTrend: profile.downloadTrend,
                daysSinceLastPublish: profile.daysSinceLastPublish,
                githubScore: profile.githubScore,
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

// ── Tool: lookup_pypi_package ──

server.tool(
  "lookup_pypi_package",
  `Get a behavioral commitment profile for any PyPI (Python) package. Returns real signals: package age, download volume and trend, release consistency, publisher/owner count, and linked GitHub activity.

Supply chain attacks target Python packages — LiteLLM (97M downloads/mo) was compromised via stolen PyPI token in March 2026. Behavioral signals reveal what star counts hide.

Useful for: vetting Python dependencies, identifying abandonware, supply chain risk due diligence.
Examples: "langchain", "litellm", "openai", "anthropic", "requests", "fastapi", "pydantic"`,
  {
    package: z
      .string()
      .describe(
        'PyPI package name. Examples: "langchain", "openai", "requests", "fastapi". Case-insensitive.'
      ),
  },
  async ({ package: packageName }) => {
    try {
      const profile = await buildPyPICommitmentProfile(packageName);

      if (!profile) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Package "${packageName}" not found on PyPI.`,
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
                name: profile.name,
                latestVersion: profile.latestVersion,
                ageYears: Math.round(profile.ageYears * 10) / 10,
                versionCount: profile.versionCount,
                maintainerCount: profile.maintainerCount,
                recentDailyDownloads: profile.recentDailyDownloads,
                downloadTrend: profile.downloadTrend,
                daysSinceLastPublish: profile.daysSinceLastPublish,
                githubScore: profile.githubScore,
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

// ── Tool: audit_dependencies ──

server.tool(
  "audit_dependencies",
  `Batch-score multiple npm or PyPI packages for supply chain risk. Takes a list of package names and returns a risk table sorted by commitment score (lowest = highest risk first).

Risk flags:
- CRITICAL: single npm publisher + >10M weekly downloads (publish-access concentration risk)
- HIGH: new package (<1yr) + high downloads (unproven, rapid adoption = supply chain risk)
- WARN: no release in 12+ months (potential abandonware)

Perfect for auditing a full package.json or requirements.txt — paste your dependency list and get a prioritized risk report.

Examples: score all deps in a project, compare two similar packages, identify abandonware before it becomes a CVE.`,
  {
    packages: z
      .array(z.string())
      .min(1)
      .max(20)
      .describe(
        'List of package names to score. Up to 20 at once. Examples: ["langchain", "litellm", "openai", "axios"] or ["@anthropic-ai/sdk", "zod", "express"]'
      ),
    ecosystem: z
      .enum(["npm", "pypi", "auto"])
      .default("auto")
      .describe(
        'Package ecosystem. "auto" defaults to npm. Force "pypi" for Python packages.'
      ),
  },
  async ({ packages, ecosystem }) => {
    const MAX_CONCURRENT = 5;
    const results: Array<{
      name: string;
      score: number | null;
      maintainers: number | null;
      weeklyDownloads: number | null;
      ageYears: number | null;
      trend: string | null;
      riskFlags: string[];
      error?: string;
    }> = [];

    for (let i = 0; i < packages.length; i += MAX_CONCURRENT) {
      const batch = packages.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(async (pkg) => {
          const useEcosystem = ecosystem === "pypi" ? "pypi" : "npm";
          try {
            if (useEcosystem === "pypi") {
              const profile = await buildPyPICommitmentProfile(pkg);
              if (!profile)
                return {
                  name: pkg,
                  score: null,
                  maintainers: null,
                  weeklyDownloads: null,
                  ageYears: null,
                  trend: null,
                  riskFlags: [],
                  error: "not found",
                };
              const weeklyDl = profile.recentDailyDownloads * 7;
              const riskFlags: string[] = [];
              if (profile.maintainerCount <= 1 && weeklyDl > 10_000_000)
                riskFlags.push("CRITICAL: sole publisher + >10M/wk");
              else if (profile.maintainerCount <= 1 && weeklyDl > 1_000_000)
                riskFlags.push("HIGH: sole publisher + >1M/wk");
              if (profile.ageYears < 1 && weeklyDl > 100_000)
                riskFlags.push("HIGH: new package (<1yr) + high downloads");
              if (profile.daysSinceLastPublish > 365)
                riskFlags.push("WARN: no release in 12+ months");
              return {
                name: pkg,
                score: profile.commitmentScore,
                maintainers: profile.maintainerCount,
                weeklyDownloads: weeklyDl,
                ageYears: Math.round(profile.ageYears * 10) / 10,
                trend: profile.downloadTrend,
                riskFlags,
              };
            } else {
              const profile = await buildNpmCommitmentProfile(pkg);
              if (!profile)
                return {
                  name: pkg,
                  score: null,
                  maintainers: null,
                  weeklyDownloads: null,
                  ageYears: null,
                  trend: null,
                  riskFlags: [],
                  error: "not found",
                };
              const riskFlags: string[] = [];
              if (profile.maintainerCount <= 1 && profile.recentWeeklyDownloads > 10_000_000)
                riskFlags.push("CRITICAL: sole publisher + >10M/wk");
              else if (profile.maintainerCount <= 1 && profile.recentWeeklyDownloads > 1_000_000)
                riskFlags.push("HIGH: sole publisher + >1M/wk");
              if (profile.ageYears < 1 && profile.recentWeeklyDownloads > 100_000)
                riskFlags.push("HIGH: new package (<1yr) + high downloads");
              if (profile.daysSinceLastPublish > 365)
                riskFlags.push("WARN: no release in 12+ months");
              return {
                name: pkg,
                score: profile.commitmentScore,
                maintainers: profile.maintainerCount,
                weeklyDownloads: profile.recentWeeklyDownloads,
                ageYears: Math.round(profile.ageYears * 10) / 10,
                trend: profile.downloadTrend,
                riskFlags,
              };
            }
          } catch (err) {
            return {
              name: pkg,
              score: null,
              maintainers: null,
              weeklyDownloads: null,
              ageYears: null,
              trend: null,
              riskFlags: [],
              error: err instanceof Error ? err.message : "unknown",
            };
          }
        })
      );
      results.push(...batchResults);
    }

    results.sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return a.score - b.score;
    });

    const rows = results.map((r) => {
      const scoreStr = r.score !== null ? `${r.score}/100` : "N/A";
      const dlStr =
        r.weeklyDownloads !== null
          ? r.weeklyDownloads >= 1_000_000
            ? `${(r.weeklyDownloads / 1_000_000).toFixed(1)}M/wk`
            : r.weeklyDownloads >= 1_000
            ? `${Math.round(r.weeklyDownloads / 1_000)}k/wk`
            : `${r.weeklyDownloads}/wk`
          : "N/A";
      const maintStr = r.maintainers !== null
        ? `${r.maintainers} publisher${r.maintainers !== 1 ? "s" : ""}`
        : "N/A";
      const ageStr = r.ageYears !== null
        ? r.ageYears >= 1 ? `${Math.floor(r.ageYears)}yr` : `${Math.round(r.ageYears * 12)}mo`
        : "N/A";
      const flags = r.riskFlags.length > 0 ? ` ⚠️ ${r.riskFlags.join("; ")}` : "";
      const errStr = r.error ? ` (error: ${r.error})` : "";
      return `  ${scoreStr.padEnd(7)} ${r.name.padEnd(35)} ${dlStr.padEnd(12)} ${maintStr.padEnd(15)} ${ageStr}${flags}${errStr}`;
    });

    const criticalCount = results.filter((r) => r.riskFlags.some((f) => f.startsWith("CRITICAL"))).length;
    const highCount = results.filter((r) => r.riskFlags.some((f) => f.startsWith("HIGH"))).length;
    const warnCount = results.filter((r) => r.riskFlags.some((f) => f.startsWith("WARN"))).length;

    const summary = [
      `Dependency Risk Audit — ${packages.length} package${packages.length !== 1 ? "s" : ""} scored`,
      `Risk summary: ${criticalCount} CRITICAL, ${highCount} HIGH, ${warnCount} WARN`,
      `(sorted by commitment score — lowest = highest supply chain risk)`,
      ``,
      `  Score   Package                             Downloads    Maintainers     Age`,
      `  ------  ----------------------------------  -----------  --------------  ---`,
      ...rows,
      ``,
      `Score: 0-100 behavioral commitment. <40 = elevated risk. CRITICAL = immediate audit recommended.`,
    ].join("\n");

    return {
      content: [
        { type: "text" as const, text: summary },
        { type: "text" as const, text: JSON.stringify(results, null, 2) },
      ],
    };
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Proof of Commitment MCP server v0.7.0 running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
