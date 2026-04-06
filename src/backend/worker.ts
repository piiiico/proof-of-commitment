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
 * POST /api/audit               — batch npm/PyPI supply chain risk scoring
 * ALL  /mcp                     — Remote MCP server (Streamable HTTP)
 * GET  /                        — health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { buildCommitmentProfile, searchAndProfile } from "./brreg.ts";
import { buildGitHubCommitmentProfile, parseGitHubInput } from "./github.ts";
import { buildNpmCommitmentProfile } from "./npm.ts";
import { buildPyPICommitmentProfile } from "./pypi.ts";

// ── World ID JWT Verification ────────────────────────────────────────

const WORLD_ID_APP_ID = "app_a2868bad17534bb7e8bc82de8df73773";
const WORLD_ID_JWKS_URL = "https://id.worldcoin.org/jwks.json";
const WORLD_ID_ISSUER = "https://id.worldcoin.org";

interface JWK {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

interface JWTPayload {
  iss: string;
  sub: string;
  aud: string;
  nonce: string;
  iat: number;
  exp: number;
  verification_level?: string;
}

// Cache JWKS for 1 hour (CF Workers have no persistent memory, but within a request it helps)
let jwksCache: { keys: JWK[]; fetchedAt: number } | null = null;

async function fetchJWKS(): Promise<JWK[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 3600_000) {
    return jwksCache.keys;
  }
  const res = await fetch(WORLD_ID_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);
  const data = (await res.json()) as { keys: JWK[] };
  jwksCache = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  return atob(base64);
}

/**
 * Verify a World ID JWT and return the payload.
 * Checks: signature (RSA via JWKS), issuer, audience, expiration.
 */
async function verifyWorldIdToken(token: string): Promise<JWTPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const header = JSON.parse(base64urlDecode(parts[0]!)) as { alg: string; kid: string };
  const payload = JSON.parse(base64urlDecode(parts[1]!)) as JWTPayload;

  // 1. Verify issuer
  if (payload.iss !== WORLD_ID_ISSUER) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  // 2. Verify audience
  if (payload.aud !== WORLD_ID_APP_ID) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  // 3. Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("Token expired");
  }

  // 4. Verify signature via JWKS
  const keys = await fetchJWKS();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`No matching key for kid: ${header.kid}`);

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, use: jwk.use },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedContent = new TextEncoder().encode(`${parts[0]!}.${parts[1]!}`);
  const sigStr = parts[2]!.replace(/-/g, "+").replace(/_/g, "/");
  const paddedSig = sigStr + "=".repeat((4 - (sigStr.length % 4)) % 4);
  const sigBytes = Uint8Array.from(atob(paddedSig), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    sigBytes,
    signedContent
  );

  if (!valid) throw new Error("Invalid token signature");

  return payload;
}

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
  // Require World ID authentication — verified human only
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Authentication required. Provide a World ID token via Authorization: Bearer <id_token>" }, 401);
  }

  const token = authHeader.slice(7);
  let worldIdSub: string;
  try {
    const payload = await verifyWorldIdToken(token);
    worldIdSub = payload.sub;
  } catch (err) {
    return c.json({ error: `Invalid World ID token: ${err instanceof Error ? err.message : "verification failed"}` }, 401);
  }

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

/**
 * POST /api/audit
 * Batch-score npm or PyPI packages for supply chain risk.
 * Body: { packages: string[], ecosystem?: "npm" | "pypi" | "auto" }
 * Returns JSON array sorted by commitment score (lowest = highest risk first).
 */
app.post("/api/audit", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const packages: string[] = Array.isArray(body?.packages) ? body.packages.slice(0, 20) : [];
  const ecosystem: string = body?.ecosystem ?? "auto";

  if (packages.length === 0) {
    return c.json({ error: "'packages' array is required (max 20)" }, 400);
  }

  const MAX_CONCURRENT = 5;
  const results: Array<{
    name: string;
    ecosystem: string;
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
        const usePypi = ecosystem === "pypi";
        try {
          if (usePypi) {
            const profile = await buildPyPICommitmentProfile(pkg);
            if (!profile) return { name: pkg, ecosystem: "pypi", score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], error: "not found" };
            const weeklyDl = profile.recentDailyDownloads * 7;
            const riskFlags: string[] = [];
            if (profile.maintainerCount === 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL");
            else if (profile.ageYears < 1 && weeklyDl > 1_000_000) riskFlags.push("HIGH");
            else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
            return { name: profile.name, ecosystem: "pypi", score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: weeklyDl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, riskFlags };
          } else {
            const profile = await buildNpmCommitmentProfile(pkg);
            if (!profile) return { name: pkg, ecosystem: "npm", score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], error: "not found" };
            const riskFlags: string[] = [];
            const wdl = profile.recentWeeklyDownloads ?? 0;
            if (profile.maintainerCount === 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
            else if (profile.ageYears < 1 && wdl > 1_000_000) riskFlags.push("HIGH");
            else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
            return { name: profile.name, ecosystem: "npm", score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: profile.recentWeeklyDownloads ?? null, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, riskFlags };
          }
        } catch (err) {
          return { name: pkg, ecosystem: usePypi ? "pypi" : "npm", score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], error: err instanceof Error ? err.message : "error" };
        }
      })
    );
    results.push(...batchResults);
  }

  results.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  return c.json({ count: results.length, results });
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
    version: "0.6.0",
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

  // Tool: lookup_github_repo
  mcp.tool(
    "lookup_github_repo",
    `Get a behavioral commitment profile for any public GitHub repository. Returns real signals that prove genuine investment: how long the project has existed, recent commit frequency, contributor community size, release cadence, and social proof. These are behavioral commitments — harder to fake than README claims or marketing copy.

Useful for: vetting open-source dependencies, evaluating AI tools/frameworks, assessing vendor reliability, due diligence on any GitHub project.

Examples: "vercel/next.js", "facebook/react", "https://github.com/piiiico/proof-of-commitment"`,
    {
      repo: z
        .string()
        .describe(
          'GitHub repository in "owner/repo" format or full URL. Examples: "vercel/next.js", "https://github.com/facebook/react"'
        ),
    },
    async ({ repo }) => {
      const parsed = parseGitHubInput(repo);
      if (!parsed) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid GitHub repo format. Use "owner/repo" or a full GitHub URL. Example: "vercel/next.js"`,
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
                  forks: profile.forks,
                  recentCommits30d: profile.recentCommits30d,
                  contributorCount: profile.contributorCount,
                  releaseCount: profile.releaseCount,
                  latestRelease: profile.latestRelease,
                  daysSinceLastPush: profile.daysSinceLastPush,
                  isArchived: profile.isArchived,
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

  // Tool: lookup_npm_package
  mcp.tool(
    "lookup_npm_package",
    `Get a behavioral commitment profile for any npm package. Returns real signals that prove genuine investment: package age, download volume and trend (growing/stable/declining), release consistency, maintainer count, and linked GitHub activity.

Why behavioral signals matter: download counts, stars, and READMEs can be gamed. Download *trend* consistency and maintainer depth over years are harder to fake. Supply chain attacks often target packages that look popular but have low maintainer depth or inconsistent release patterns.

Useful for: vetting dependencies before installation, due diligence on open-source packages, identifying abandonware, checking if a package is actively maintained.

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

  // Tool: lookup_pypi_package
  mcp.tool(
    "lookup_pypi_package",
    `Get a behavioral commitment profile for any PyPI (Python) package. Returns real signals: package age, download volume and trend, release consistency, maintainer/owner count, and linked GitHub activity.

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

  // Tool: audit_dependencies
  mcp.tool(
    "audit_dependencies",
    `Batch-score multiple npm or PyPI packages for supply chain risk. Takes a list of package names and returns a risk table sorted by commitment score (lowest = highest risk first).

Risk flags:
- CRITICAL: single maintainer + >10M weekly downloads (high-value target, minimal oversight)
- HIGH: new package (<1yr) + high downloads (unproven, rapid adoption = supply chain risk)
- WARN: low maintainer count + high downloads

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
          'Package ecosystem. "auto" detects by naming convention (Python-style = pypi, otherwise npm). Force "npm" or "pypi" to override.'
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

      // Process in batches of MAX_CONCURRENT
      for (let i = 0; i < packages.length; i += MAX_CONCURRENT) {
        const batch = packages.slice(i, i + MAX_CONCURRENT);
        const batchResults = await Promise.all(
          batch.map(async (pkg) => {
            // Detect ecosystem
            const useEcosystem =
              ecosystem === "auto"
                ? /^[a-z][a-z0-9_-]*$/.test(pkg) && !pkg.startsWith("@")
                  ? "npm"
                  : "npm"
                : ecosystem;

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
                  riskFlags.push("CRITICAL: sole maintainer + >10M/wk");
                else if (profile.maintainerCount <= 1 && weeklyDl > 1_000_000)
                  riskFlags.push("HIGH: sole maintainer + >1M/wk");
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
                if (
                  profile.maintainerCount <= 1 &&
                  profile.recentWeeklyDownloads > 10_000_000
                )
                  riskFlags.push("CRITICAL: sole maintainer + >10M/wk");
                else if (
                  profile.maintainerCount <= 1 &&
                  profile.recentWeeklyDownloads > 1_000_000
                )
                  riskFlags.push("HIGH: sole maintainer + >1M/wk");
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
                error: err instanceof Error ? err.message : "unknown error",
              };
            }
          })
        );
        results.push(...batchResults);
      }

      // Sort by score ascending (lowest = most at-risk first), nulls last
      results.sort((a, b) => {
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return a.score - b.score;
      });

      // Format table
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
        const maintStr =
          r.maintainers !== null ? `${r.maintainers} maintainer${r.maintainers !== 1 ? "s" : ""}` : "N/A";
        const ageStr =
          r.ageYears !== null
            ? r.ageYears >= 1
              ? `${Math.floor(r.ageYears)}yr`
              : `${Math.round(r.ageYears * 12)}mo`
            : "N/A";
        const flags =
          r.riskFlags.length > 0 ? ` ⚠️ ${r.riskFlags.join("; ")}` : "";
        const errStr = r.error ? ` (error: ${r.error})` : "";
        return `  ${scoreStr.padEnd(7)} ${r.name.padEnd(35)} ${dlStr.padEnd(12)} ${maintStr.padEnd(15)} ${ageStr}${flags}${errStr}`;
      });

      const criticalCount = results.filter((r) =>
        r.riskFlags.some((f) => f.startsWith("CRITICAL"))
      ).length;
      const highCount = results.filter((r) =>
        r.riskFlags.some((f) => f.startsWith("HIGH"))
      ).length;
      const warnCount = results.filter((r) =>
        r.riskFlags.some((f) => f.startsWith("WARN"))
      ).length;

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
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
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
