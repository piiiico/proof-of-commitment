/**
 * Proof of Commitment — Aggregator Backend (Cloudflare Workers + D1)
 *
 * Production deployment. Mirrors the API surface of server.ts (local
 * Bun + SQLite) but runs on CF Workers + D1.
 *
 * POST /api/commit              — submit commitment(s)
 * GET  /api/domain/:d           — stats for a specific domain
 * GET  /api/business/search?q=  — search Norwegian businesses
 * GET  /api/business/:orgNumber — business commitment profile
 * ALL  /mcp                     — Remote MCP server (Streamable HTTP)
 * GET  /                        — health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { buildCommitmentProfile, searchAndProfile } from "./brreg.ts";

// ── Types ────────────────────────────────────────────────────────────

type Bindings = {
  DB: D1Database;
};

interface Commitment {
  domain: string;
  visitCount: number;
  totalSeconds: number;
  firstSeen: number;
  lastSeen: number;
}

interface DomainStatsRow {
  domain: string;
  unique_commitments: number;
  total_visits: number;
  total_seconds: number;
  avg_visits: number;
  avg_seconds: number;
  last_updated: string;
}

// ── Validation (mirrors server.ts) ───────────────────────────────────

type ValidationResult =
  | { ok: true; value: Commitment }
  | { ok: false; error: string };

function validateCommitment(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Commitment must be an object" };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.domain !== "string" || obj.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }

  if (typeof obj.visitCount !== "number" || !Number.isInteger(obj.visitCount) || obj.visitCount < 1) {
    return { ok: false, error: "visitCount must be a positive integer" };
  }

  if (typeof obj.totalSeconds !== "number" || !Number.isInteger(obj.totalSeconds) || obj.totalSeconds < 0) {
    return { ok: false, error: "totalSeconds must be a non-negative integer" };
  }

  if (typeof obj.firstSeen !== "number" || obj.firstSeen < 0) {
    return { ok: false, error: "firstSeen must be a non-negative number (unix ms)" };
  }

  if (typeof obj.lastSeen !== "number" || obj.lastSeen < obj.firstSeen) {
    return { ok: false, error: "lastSeen must be >= firstSeen" };
  }

  const domain = obj.domain.trim().toLowerCase().replace(/^(https?:\/\/)/, "").split("/")[0]!;

  return {
    ok: true,
    value: {
      domain,
      visitCount: obj.visitCount,
      totalSeconds: obj.totalSeconds,
      firstSeen: obj.firstSeen,
      lastSeen: obj.lastSeen,
    },
  };
}

// ── Hono app ─────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

// Health check (same path as server.ts)
app.get("/", (c) => c.json({ status: "ok", service: "proof-of-commitment" }));

/**
 * POST /api/commit
 * Body: single commitment or array of commitments.
 * Each: { domain, visitCount, totalSeconds, firstSeen, lastSeen }
 */
app.post("/api/commit", async (c) => {
  const body = await c.req.json();
  const items: unknown[] = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    return c.json({ error: "Empty payload" }, 400);
  }

  const errors: string[] = [];
  let accepted = 0;
  const stmts: D1PreparedStatement[] = [];

  for (const item of items) {
    const parsed = validateCommitment(item);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }

    const v = parsed.value;

    // Insert into commitments table
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO commitments (domain, visit_count, total_seconds, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(v.domain, v.visitCount, v.totalSeconds, v.firstSeen, v.lastSeen)
    );

    // Update domain_stats (explicit upsert — D1 triggers not reliable)
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO domain_stats (domain, unique_commitments, total_visits, total_seconds, avg_visits, avg_seconds, last_updated)
         VALUES (?, 1, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(domain) DO UPDATE SET
           unique_commitments = unique_commitments + 1,
           total_visits = total_visits + excluded.total_visits,
           total_seconds = total_seconds + excluded.total_seconds,
           avg_visits = CAST((total_visits + excluded.total_visits) AS REAL) / (unique_commitments + 1),
           avg_seconds = CAST((total_seconds + excluded.total_seconds) AS REAL) / (unique_commitments + 1),
           last_updated = datetime('now')`
      ).bind(v.domain, v.visitCount, v.totalSeconds, v.visitCount, v.totalSeconds)
    );

    accepted++;
  }

  if (accepted === 0) {
    return c.json({ error: "No valid commitments", details: errors }, 400);
  }

  await c.env.DB.batch(stmts);

  return c.json({ accepted, errors: errors.length > 0 ? errors : undefined });
});

/**
 * GET /api/domain/:domain
 * Returns aggregate stats for a domain. Matches server.ts response shape.
 */
app.get("/api/domain/:domain", async (c) => {
  const domain = c.req.param("domain").trim().toLowerCase();
  const row = await c.env.DB.prepare(
    `SELECT domain, unique_commitments, total_visits, total_seconds,
            avg_visits, avg_seconds, last_updated
     FROM domain_stats WHERE domain = ?`
  )
    .bind(domain)
    .first<DomainStatsRow>();

  if (!row) {
    return c.json({
      domain,
      uniqueCommitments: 0,
      totalVisits: 0,
      totalSeconds: 0,
      avgVisits: 0,
      avgSeconds: 0,
      message: "No commitments recorded for this domain",
    });
  }

  return c.json({
    domain: row.domain,
    uniqueCommitments: row.unique_commitments,
    totalVisits: row.total_visits,
    totalSeconds: row.total_seconds,
    avgVisits: row.avg_visits,
    avgSeconds: row.avg_seconds,
    lastUpdated: row.last_updated,
  });
});

/**
 * GET /api/business/search?q=name
 * Search Norwegian businesses by name and return commitment profiles.
 */
app.get("/api/business/search", async (c) => {
  const query = c.req.query("q");
  if (!query || query.trim().length === 0) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const limit = Math.min(Number(c.req.query("limit")) || 3, 10);
  const profiles = await searchAndProfile(query, limit);

  return c.json({
    query,
    count: profiles.length,
    results: profiles,
  });
});

/**
 * GET /api/business/:orgNumber
 * Look up a specific Norwegian business by org number.
 */
app.get("/api/business/:orgNumber", async (c) => {
  const orgNumber = c.req.param("orgNumber").replace(/\s/g, "");

  if (!/^\d{9}$/.test(orgNumber)) {
    return c.json({ error: "Organization number must be 9 digits" }, 400);
  }

  const profile = await buildCommitmentProfile(orgNumber);

  if (!profile) {
    return c.json(
      { error: `No business found with org number ${orgNumber}` },
      404
    );
  }

  return c.json(profile);
});

// ── Remote MCP Server ────────────────────────────────────────────────
//
// Stateless MCP endpoint. Each request creates a fresh server + transport.
// Enables any MCP client (Claude Desktop, Cursor, etc.) to query
// commitment data without running anything locally.
//
// Connect: https://poc-backend.amdal-dev.workers.dev/mcp

function createMcpServer(): McpServer {
  const mcp = new McpServer({
    name: "proof-of-commitment",
    version: "0.3.0",
  });

  // Tool: query_commitment
  mcp.tool(
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
        // Call our own REST API internally
        const res = await fetch(
          `https://poc-backend.amdal-dev.workers.dev/api/domain/${encodeURIComponent(normalized)}`
        );
        if (!res.ok) {
          return {
            content: [
              { type: "text" as const, text: `Backend error: ${res.status}` },
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
                `Average time per visitor: ${avgMinutes} minutes`,
              ]
                .filter(Boolean)
                .join("\n");

        return { content: [{ type: "text" as const, text: summary }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: lookup_business
  mcp.tool(
    "lookup_business",
    `Search for a Norwegian business and get its commitment profile from public data (Brønnøysund Register Centre). Returns real commitment signals: longevity, financial health, employee count, and overall commitment score (0-100). Data source: Norwegian government registers — free, verified, unfakeable.`,
    {
      query: z
        .string()
        .describe(
          "Business name to search for (e.g. 'Peppes Pizza', 'Equinor')"
        ),
    },
    async ({ query }) => {
      try {
        const profiles = await searchAndProfile(query, 3);
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
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: lookup_business_by_org
  mcp.tool(
    "lookup_business_by_org",
    `Look up a specific Norwegian business by organization number (9 digits) and get its commitment profile. Returns temporal, financial, and operational commitment signals from Brønnøysund Register Centre.`,
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
          content: [{ type: "text" as const, text: profile.summary }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return mcp;
}

// CORS for MCP endpoint
app.use("/mcp", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
  exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
}));

// MCP Streamable HTTP endpoint — stateless (fresh server per request)
app.all("/mcp", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const mcp = createMcpServer();
  await mcp.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default app;
