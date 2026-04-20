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
 * GET  /api/badge/:eco/:pkg     — SVG badge for README embedding
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
  RESEND_API_KEY?: string;
};

// API key context attached to requests that use Bearer authentication
interface ApiKeyContext {
  id: string;
  key_prefix: string;
  email: string;
  tier: "free" | "pro" | "enterprise";
  requests_this_period: number;
  period_reset_at: string;
}

// Rate limits per tier
const TIER_LIMITS = {
  free: { limit: 200, period: "daily" as const },
  pro: { limit: 10000, period: "monthly" as const },
  enterprise: { limit: Infinity, period: "monthly" as const },
};

/** SHA-256 hash a string, returns hex */
async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate next period reset timestamp */
function nextResetAt(period: "daily" | "monthly"): string {
  const now = new Date();
  if (period === "daily") {
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return tomorrow.toISOString();
  } else {
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return nextMonth.toISOString();
  }
}

/** Format seconds until a timestamp as human-readable string */
function timeUntil(isoTimestamp: string): string {
  const resetMs = new Date(isoTimestamp).getTime();
  const nowMs = Date.now();
  const diffSec = Math.max(0, Math.floor((resetMs - nowMs) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Resolve API key from Authorization: Bearer header.
 * Returns null if no header present (anonymous request).
 * Returns ApiKeyContext if valid, throws on invalid/revoked/over-limit.
 */
async function resolveApiKey(
  db: D1Database,
  authHeader: string | undefined
): Promise<{ key: ApiKeyContext | null; error?: { status: number; body: unknown } }> {
  if (!authHeader?.startsWith("Bearer sk_commit_")) {
    return { key: null }; // anonymous — fall through to IP rate limiting
  }

  const token = authHeader.slice(7); // "Bearer "
  const keyHash = await sha256Hex(token);

  const row = await db
    .prepare(
      `SELECT id, key_prefix, email, tier, requests_this_period, period_reset_at, revoked_at
       FROM api_keys WHERE key_hash = ? LIMIT 1`
    )
    .bind(keyHash)
    .first<{
      id: string;
      key_prefix: string;
      email: string;
      tier: string;
      requests_this_period: number;
      period_reset_at: string;
      revoked_at: string | null;
    }>();

  if (!row) {
    return {
      key: null,
      error: {
        status: 401,
        body: { error: "invalid_api_key", message: "API key not found. Create one at https://getcommit.dev/get-started" },
      },
    };
  }

  if (row.revoked_at) {
    return {
      key: null,
      error: {
        status: 401,
        body: { error: "api_key_revoked", message: "This API key has been revoked." },
      },
    };
  }

  // Check if period has reset
  const tier = (row.tier as "free" | "pro" | "enterprise") || "free";
  const tierConfig = TIER_LIMITS[tier] || TIER_LIMITS.free;
  let requestsThisPeriod = row.requests_this_period;
  let periodResetAt = row.period_reset_at;

  if (new Date(periodResetAt) <= new Date()) {
    // Reset counter for new period
    periodResetAt = nextResetAt(tierConfig.period);
    requestsThisPeriod = 0;
    await db
      .prepare(`UPDATE api_keys SET requests_this_period = 0, period_reset_at = ? WHERE id = ?`)
      .bind(periodResetAt, row.id)
      .run();
  }

  const keyCtx: ApiKeyContext = {
    id: row.id,
    key_prefix: row.key_prefix,
    email: row.email,
    tier,
    requests_this_period: requestsThisPeriod,
    period_reset_at: periodResetAt,
  };

  // Check usage limits
  if (tier !== "enterprise" && requestsThisPeriod >= tierConfig.limit) {
    const retryAfterSec = Math.floor((new Date(periodResetAt).getTime() - Date.now()) / 1000);
    return {
      key: keyCtx,
      error: {
        status: 429,
        body: {
          error: "rate_limit_exceeded",
          message: `You've used ${requestsThisPeriod}/${tierConfig.limit} requests this period. Resets in ${timeUntil(periodResetAt)}.`,
          tier,
          upgrade: {
            url: "https://getcommit.dev/pricing",
            plan: "pro",
            price: "$29/month",
            limit: "10,000 requests/month",
            message: "Upgrade to Pro for 50x more requests, batch API, and dependency monitoring.",
          },
          retry_after: retryAfterSec,
        },
      },
    };
  }

  // Increment usage counter + update last_used_at
  await db
    .prepare(
      `UPDATE api_keys SET requests_this_period = requests_this_period + 1, last_used_at = datetime('now') WHERE id = ?`
    )
    .bind(row.id)
    .run();

  return { key: { ...keyCtx, requests_this_period: requestsThisPeriod + 1 } };
}

/** Build X-RateLimit-* headers for a response */
function rateLimitHeaders(key: ApiKeyContext | null): Record<string, string> {
  if (!key) {
    return {
      "X-RateLimit-Limit": "200",
      "X-RateLimit-Tier": "anonymous",
    };
  }
  const tierConfig = TIER_LIMITS[key.tier] || TIER_LIMITS.free;
  const limit = tierConfig.limit === Infinity ? "unlimited" : String(tierConfig.limit);
  const remaining = tierConfig.limit === Infinity
    ? "unlimited"
    : String(Math.max(0, tierConfig.limit - key.requests_this_period));

  return {
    "X-RateLimit-Limit": limit,
    "X-RateLimit-Remaining": remaining,
    "X-RateLimit-Reset": key.period_reset_at,
    "X-RateLimit-Tier": key.tier,
    "X-RateLimit-Period": tierConfig.period,
  };
}

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

const app = new Hono<{ Bindings: Bindings; Variables: { apiKey: ApiKeyContext | null } }>();

app.use("/api/*", cors());

// ── Auth Middleware ───────────────────────────────────────────────────
// Runs before all /api/* routes.
// - If Bearer sk_commit_... header present: validate key, enforce limits, attach to context
// - Otherwise: anonymous (IP rate limiting handled per-route where needed)
app.use("/api/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  // Only intercept if it looks like a Commit API key
  if (authHeader?.startsWith("Bearer sk_commit_")) {
    const { key, error } = await resolveApiKey(c.env.DB, authHeader);
    if (error) {
      const resp = c.json(error.body, error.status as 401 | 429);
      // Always add rate limit headers even on error
      if (key) {
        const headers = rateLimitHeaders(key);
        for (const [k, v] of Object.entries(headers)) {
          resp.headers.set(k, v);
        }
      }
      return resp;
    }
    c.set("apiKey", key);
  } else {
    c.set("apiKey", null);
  }

  await next();

  // Add X-RateLimit-* headers to all API responses
  const key = c.get("apiKey");
  const headers = rateLimitHeaders(key);
  for (const [k, v] of Object.entries(headers)) {
    c.res.headers.set(k, v);
  }
});

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

  // Rate limit: max 500 new domain submissions per verified user per 24h
  const RATE_LIMIT_PER_DAY = 500;
  const rateLimitRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM commitments WHERE world_id_sub = ? AND submitted_at >= datetime('now', '-1 day')`
  ).bind(worldIdSub).first<{ count: number }>();
  if ((rateLimitRow?.count ?? 0) >= RATE_LIMIT_PER_DAY) {
    return c.json(
      { error: "Rate limit exceeded. Maximum 500 domain submissions per 24 hours per verified user." },
      429
    );
  }

  const body = await c.req.json();
  const items: unknown[] = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    return c.json({ error: "Empty payload" }, 400);
  }

  const errors: string[] = [];
  type ValidCommitment = { domain: string; visitCount: number; totalSeconds: number; firstSeen: number; lastSeen: number };
  const valid: ValidCommitment[] = [];

  for (const item of items) {
    const parsed = validateCommitment(item);
    if (!parsed.ok) {
      errors.push(parsed.error);
    } else {
      valid.push(parsed.value);
    }
  }

  if (valid.length === 0) {
    return c.json({ error: "No valid commitments", details: errors }, 400);
  }

  // Check which (domain, worldIdSub) pairs already exist so we can upsert
  // correctly without double-counting domain_stats.unique_commitments.
  const existenceChecks = valid.map((v) =>
    c.env.DB.prepare(
      `SELECT 1 FROM commitments WHERE domain = ? AND world_id_sub = ? LIMIT 1`
    ).bind(v.domain, worldIdSub)
  );
  const existenceResults = await c.env.DB.batch(existenceChecks);

  const stmts: D1PreparedStatement[] = [];

  for (let i = 0; i < valid.length; i++) {
    const v = valid[i]!;
    const isExisting = (existenceResults[i]?.results?.length ?? 0) > 0;

    if (isExisting) {
      // Same user re-submitting for same domain — update, don't recount
      stmts.push(
        c.env.DB.prepare(
          `UPDATE commitments
           SET visit_count    = ?,
               total_seconds  = ?,
               first_seen     = MIN(first_seen, ?),
               last_seen      = MAX(last_seen, ?)
           WHERE domain = ? AND world_id_sub = ?`
        ).bind(v.visitCount, v.totalSeconds, v.firstSeen, v.lastSeen, v.domain, worldIdSub)
      );
      // domain_stats.unique_commitments stays unchanged — this user was already counted
    } else {
      // New (domain, user) pair — insert and update aggregate
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO commitments (domain, world_id_sub, visit_count, total_seconds, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(v.domain, worldIdSub, v.visitCount, v.totalSeconds, v.firstSeen, v.lastSeen)
      );

      // Update domain_stats (explicit upsert — D1 triggers not reliable)
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO domain_stats (domain, unique_commitments, total_visits, total_seconds, avg_visits, avg_seconds, last_updated)
           VALUES (?, 1, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(domain) DO UPDATE SET
             unique_commitments = unique_commitments + 1,
             total_visits       = total_visits + excluded.total_visits,
             total_seconds      = total_seconds + excluded.total_seconds,
             avg_visits         = CAST((total_visits + excluded.total_visits) AS REAL) / (unique_commitments + 1),
             avg_seconds        = CAST((total_seconds + excluded.total_seconds) AS REAL) / (unique_commitments + 1),
             last_updated       = datetime('now')`
        ).bind(v.domain, v.visitCount, v.totalSeconds, v.visitCount, v.totalSeconds)
      );
    }
  }

  await c.env.DB.batch(stmts);

  return c.json({ accepted: valid.length, errors: errors.length > 0 ? errors : undefined });
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
    daysSinceLastPublish: number | null;
    riskFlags: string[];
    scoreBreakdown: { longevity: number; downloadMomentum: number; releaseConsistency: number; maintainerDepth: number; githubBacking: number } | null;
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
            if (!profile) return { name: pkg, ecosystem: "pypi", score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
            const weeklyDl = profile.recentDailyDownloads * 7;
            const riskFlags: string[] = [];
            if (profile.maintainerCount === 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL");
            else if (profile.ageYears < 1 && weeklyDl > 1_000_000) riskFlags.push("HIGH");
            else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
            return { name: profile.name, ecosystem: "pypi", score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: weeklyDl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, riskFlags, scoreBreakdown: profile.scoreBreakdown };
          } else {
            const profile = await buildNpmCommitmentProfile(pkg);
            if (!profile) return { name: pkg, ecosystem: "npm", score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
            const riskFlags: string[] = [];
            const wdl = profile.recentWeeklyDownloads ?? 0;
            if (profile.maintainerCount === 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
            else if (profile.ageYears < 1 && wdl > 1_000_000) riskFlags.push("HIGH");
            else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
            return { name: profile.name, ecosystem: "npm", score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: profile.recentWeeklyDownloads ?? null, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, riskFlags, scoreBreakdown: profile.scoreBreakdown };
          }
        } catch (err) {
          return { name: pkg, ecosystem: usePypi ? "pypi" : "npm", score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: err instanceof Error ? err.message : "error" };
        }
      })
    );
    results.push(...batchResults);
  }

  results.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  return c.json({ count: results.length, results });
});

// ── GitHub Repo Dependency Audit ──────────────────────────────────────

/**
 * Parse a GitHub repo identifier into owner/repo.
 * Accepts: "https://github.com/owner/repo", "github.com/owner/repo", "owner/repo"
 */
function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input.trim().replace(/\.git$/, "");
  // Full URL
  const urlMatch = cleaned.match(/github\.com\/([^/]+)\/([^/\s]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  // owner/repo shorthand
  const shortMatch = cleaned.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

/**
 * Fetch raw file content from GitHub (tries main then master branch).
 */
async function fetchGitHubRaw(owner: string, repo: string, path: string): Promise<string | null> {
  for (const branch of ["HEAD", "main", "master"]) {
    try {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) return resp.text();
    } catch {}
  }
  return null;
}

/**
 * Extract package names from a package.json string.
 * Returns { npm: string[], pypi: string[] }
 */
function extractFromPackageJson(content: string): string[] {
  try {
    const pkg = JSON.parse(content);
    const deps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    });
    return deps.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Extract package names from a requirements.txt string.
 */
function extractFromRequirementsTxt(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
    .map((l) => l.split(/[>=<!;\s]/)[0].trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * POST /api/audit/github
 * Fetch dependencies from a GitHub repo and run supply chain risk scoring.
 * Body: { repo: string }  — GitHub URL or "owner/repo"
 */
app.post("/api/audit/github", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const repoInput: string = body?.repo ?? "";

  const parsed = parseGitHubRepo(repoInput);
  if (!parsed) {
    return c.json({ error: "Invalid repo. Use 'owner/repo' or a GitHub URL." }, 400);
  }

  const { owner, repo } = parsed;

  // Try to fetch package.json and/or requirements.txt
  const [packageJsonContent, requirementsTxtContent] = await Promise.all([
    fetchGitHubRaw(owner, repo, "package.json"),
    fetchGitHubRaw(owner, repo, "requirements.txt"),
  ]);

  const npmPackages = packageJsonContent ? extractFromPackageJson(packageJsonContent) : [];
  const pypiPackages = requirementsTxtContent ? extractFromRequirementsTxt(requirementsTxtContent) : [];

  if (npmPackages.length === 0 && pypiPackages.length === 0) {
    return c.json({
      error: `No dependencies found in ${owner}/${repo}. Checked: package.json, requirements.txt.`,
    }, 404);
  }

  // Run audits in parallel across both ecosystems
  type AuditResult = {
    name: string;
    ecosystem: string;
    score: number | null;
    maintainers: number | null;
    weeklyDownloads: number | null;
    ageYears: number | null;
    trend: string | null;
    daysSinceLastPublish: number | null;
    riskFlags: string[];
    scoreBreakdown: { longevity: number; downloadMomentum: number; releaseConsistency: number; maintainerDepth: number; githubBacking: number } | null;
    error?: string;
  };

  const auditPackages = async (pkgs: string[], ecosystem: "npm" | "pypi"): Promise<AuditResult[]> => {
    const MAX_CONCURRENT = 5;
    const results: AuditResult[] = [];
    for (let i = 0; i < pkgs.length; i += MAX_CONCURRENT) {
      const batch = pkgs.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(async (pkg): Promise<AuditResult> => {
          try {
            if (ecosystem === "pypi") {
              const profile = await buildPyPICommitmentProfile(pkg);
              if (!profile) return { name: pkg, ecosystem, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
              const weeklyDl = profile.recentDailyDownloads * 7;
              const riskFlags: string[] = [];
              if (profile.maintainerCount <= 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL");
              else if (profile.maintainerCount <= 1 && weeklyDl > 1_000_000) riskFlags.push("HIGH");
              if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
              return { name: profile.name, ecosystem, score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: weeklyDl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, riskFlags, scoreBreakdown: profile.scoreBreakdown };
            } else {
              const profile = await buildNpmCommitmentProfile(pkg);
              if (!profile) return { name: pkg, ecosystem, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
              const wdl = profile.recentWeeklyDownloads ?? 0;
              const riskFlags: string[] = [];
              if (profile.maintainerCount <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
              else if (profile.maintainerCount <= 1 && wdl > 1_000_000) riskFlags.push("HIGH");
              if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
              return { name: profile.name, ecosystem, score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: wdl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, riskFlags, scoreBreakdown: profile.scoreBreakdown };
            }
          } catch (err) {
            return { name: pkg, ecosystem, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: err instanceof Error ? err.message : "error" };
          }
        })
      );
      results.push(...batchResults);
    }
    return results;
  };

  const [npmResults, pypiResults] = await Promise.all([
    auditPackages(npmPackages, "npm"),
    auditPackages(pypiPackages, "pypi"),
  ]);

  const allResults = [...npmResults, ...pypiResults];
  allResults.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

  return c.json({
    repo: `${owner}/${repo}`,
    npmPackages: npmPackages.length,
    pypiPackages: pypiPackages.length,
    count: allResults.length,
    results: allResults,
  });
});

// ── SVG Badge Generator ───────────────────────────────────────────────

/**
 * Generate a shields.io-compatible SVG badge.
 * Uses Verdana 11px metrics (~6.2px per character average).
 */
function generateBadge(label: string, value: string, color: string): string {
  // Approximate character widths for Verdana 11px
  const charWidth = 6.2;
  const padding = 10;
  const labelWidth = Math.ceil(label.length * charWidth + padding * 2);
  const valueWidth = Math.ceil(value.length * charWidth + padding * 2);
  const totalWidth = labelWidth + valueWidth;
  const labelCenter = Math.floor(labelWidth / 2);
  const valueCenter = labelWidth + Math.floor(valueWidth / 2);

  // Escape XML entities
  const escapeXml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const labelEsc = escapeXml(label);
  const valueEsc = escapeXml(value);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${labelEsc}: ${valueEsc}">
<title>${labelEsc}: ${valueEsc}</title>
<linearGradient id="s" x2="0" y2="100%">
<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
<stop offset="1" stop-opacity=".1"/>
</linearGradient>
<clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${labelWidth}" height="20" fill="#555"/>
<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
<rect width="${totalWidth}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
<text x="${labelCenter * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - padding * 2) * 10}" lengthAdjust="spacing">${labelEsc}</text>
<text x="${labelCenter * 10}" y="140" transform="scale(.1)" textLength="${(labelWidth - padding * 2) * 10}" lengthAdjust="spacing">${labelEsc}</text>
<text x="${valueCenter * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueWidth - padding * 2) * 10}" lengthAdjust="spacing">${valueEsc}</text>
<text x="${valueCenter * 10}" y="140" transform="scale(.1)" textLength="${(valueWidth - padding * 2) * 10}" lengthAdjust="spacing">${valueEsc}</text>
</g>
</svg>`;
}

/**
 * GET /api/badge/:ecosystem/:package{.+}
 *
 * Returns an SVG badge with the commitment score for an npm or PyPI package.
 * Designed to embed in GitHub READMEs:
 *   ![commit score](https://poc-backend.amdal-dev.workers.dev/api/badge/npm/axios)
 *
 * Colors: green (healthy) → yellow (moderate) → orange (high risk) → red (CRITICAL)
 * Cache-Control: 5 minutes (edge cached by Cloudflare)
 */
app.get("/api/badge/:ecosystem/*", async (c) => {
  const ecosystem = c.req.param("ecosystem");
  // The wildcard captures the rest of the path (handles scoped packages like @scope/name)
  const packageName = decodeURIComponent(c.req.path.replace(`/api/badge/${ecosystem}/`, ""));

  if (ecosystem !== "npm" && ecosystem !== "pypi") {
    const svg = generateBadge("commit", "invalid ecosystem", "#9f9f9f");
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=60" },
    });
  }

  let score: number | null = null;
  let riskFlags: string[] = [];

  try {
    if (ecosystem === "npm") {
      const profile = await buildNpmCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        const wdl = profile.recentWeeklyDownloads ?? 0;
        if (profile.maintainerCount === 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
      }
    } else {
      const profile = await buildPyPICommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        const weeklyDl = profile.recentDailyDownloads * 7;
        if (profile.maintainerCount === 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL");
      }
    }
  } catch {
    // Fall through to error badge
  }

  let value: string;
  let color: string;

  if (score === null) {
    value = "not found";
    color = "#9f9f9f";
  } else if (riskFlags.includes("CRITICAL")) {
    value = `${score} ⚠ CRITICAL`;
    color = "#e05d44";
  } else if (score < 40) {
    value = `${score} high risk`;
    color = "#fe7d37";
  } else if (score < 60) {
    value = `${score} moderate`;
    color = "#dfb317";
  } else if (score < 75) {
    value = `${score} good`;
    color = "#97ca00";
  } else {
    value = `${score} healthy`;
    color = "#44cc11";
  }

  const svg = generateBadge("commit", value, color);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "max-age=300, s-maxage=300",
      "X-Powered-By": "getcommit.dev",
    },
  });
});

// ── Dependency Graph Helpers ─────────────────────────────────────────

/**
 * Fetch the direct npm dependencies of a package (latest version).
 * Returns { packageName: semverRange } or {} on failure.
 */
async function fetchNpmLatestDeps(pkg: string): Promise<Record<string, string>> {
  const encodedName = encodeURIComponent(pkg).replace(/^%40/, "@");
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodedName}/latest`, {
      headers: { Accept: "application/json" },
      // @ts-ignore CF fetch cache hint
      cf: { cacheEverything: true, cacheTtl: 600 },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      dependencies?: Record<string, string>;
    };
    return data.dependencies ?? {};
  } catch {
    return {};
  }
}

type GraphNode = {
  name: string;
  score: number | null;
  maintainers: number | null;
  weeklyDownloads: number | null;
  ageYears: number | null;
  trend: string | null;
  riskFlags: string[];
  depth: number; // 0 = root, 1 = direct dep, 2 = transitive
  error?: string;
};

type GraphEdge = { from: string; to: string };

/**
 * Score a single npm package and return a GraphNode (depth already set by caller).
 */
async function scoreNpmNode(pkg: string, depth: number): Promise<GraphNode> {
  try {
    const profile = await buildNpmCommitmentProfile(pkg);
    if (!profile) {
      return { name: pkg, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], depth, error: "not found" };
    }
    const wdl = profile.recentWeeklyDownloads ?? 0;
    const riskFlags: string[] = [];
    if (profile.maintainerCount <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL: sole maintainer + >10M/wk");
    else if (profile.maintainerCount <= 1 && wdl > 1_000_000) riskFlags.push("HIGH: sole maintainer + >1M/wk");
    if (profile.ageYears < 1 && wdl > 100_000) riskFlags.push("HIGH: new package (<1yr) + high downloads");
    if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
    return {
      name: profile.name,
      score: profile.commitmentScore,
      maintainers: profile.maintainerCount,
      weeklyDownloads: wdl,
      ageYears: Math.round(profile.ageYears * 10) / 10,
      trend: profile.downloadTrend,
      riskFlags,
      depth,
    };
  } catch (err) {
    return { name: pkg, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], depth, error: err instanceof Error ? err.message : "error" };
  }
}

async function batchScoreNodes(pkgs: string[], depth: number): Promise<GraphNode[]> {
  const BATCH = 5;
  const results: GraphNode[] = [];
  for (let i = 0; i < pkgs.length; i += BATCH) {
    const batch = pkgs.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map((pkg) => scoreNpmNode(pkg, depth)));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Build a dependency risk graph for an npm package.
 * depth=1: root + direct deps
 * depth=2: root + direct deps + transitive deps of CRITICAL/HIGH packages (capped at MAX_TRANSITIVE)
 */
async function buildNpmDepGraph(
  rootPkg: string,
  depth: 1 | 2 = 1
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  criticalTransitivePaths: string[];
}> {
  const MAX_DIRECT = 25;
  const MAX_TRANSITIVE = 30;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>([rootPkg.toLowerCase()]);

  // Score root
  const rootNode = await scoreNpmNode(rootPkg, 0);
  nodes.push(rootNode);

  // Fetch direct deps
  const directDepsMap = await fetchNpmLatestDeps(rootPkg);
  const directDeps = Object.keys(directDepsMap).slice(0, MAX_DIRECT);

  // Add edges root → direct
  for (const dep of directDeps) {
    edges.push({ from: rootNode.name, to: dep });
    seen.add(dep.toLowerCase());
  }

  // Score direct deps
  const directNodes = await batchScoreNodes(directDeps, 1);
  nodes.push(...directNodes);

  if (depth >= 2) {
    // For each risky direct dep, fetch their deps.
    // "Risky" = CRITICAL/HIGH flag OR sole maintainer (downloads may be
    // unreliable when fetched in bulk — sole-maintainer packages are high-risk
    // regardless, so we always traverse them at depth=2).
    const riskyDirect = directNodes.filter(
      (n) =>
        n.riskFlags.some((f) => f.startsWith("CRITICAL") || f.startsWith("HIGH")) ||
        (n.maintainers !== null && n.maintainers <= 1)
    );

    const transitiveNew: string[] = [];
    for (const parent of riskyDirect) {
      const transMap = await fetchNpmLatestDeps(parent.name);
      const transDeps = Object.keys(transMap).slice(0, 15);
      for (const dep of transDeps) {
        if (!seen.has(dep.toLowerCase()) && transitiveNew.length < MAX_TRANSITIVE) {
          seen.add(dep.toLowerCase());
          transitiveNew.push(dep);
          edges.push({ from: parent.name, to: dep });
        } else if (seen.has(dep.toLowerCase())) {
          // Already in graph — still add edge if not duplicate
          const edgeExists = edges.some((e) => e.from === parent.name && e.to === dep);
          if (!edgeExists) edges.push({ from: parent.name, to: dep });
        }
      }
    }

    // Score all new transitive deps
    const newTransitive = transitiveNew;
    const transitiveNodes = await batchScoreNodes(newTransitive, 2);
    nodes.push(...transitiveNodes);
  }

  // Find critical transitive paths (root → parent → critical dep)
  const criticalNodes = nodes.filter((n) => n.depth > 0 && n.riskFlags.some((f) => f.startsWith("CRITICAL")));
  const criticalTransitivePaths = criticalNodes.map((n) => {
    const parentEdge = edges.find((e) => e.to === n.name);
    if (parentEdge && parentEdge.from !== rootNode.name) {
      return `${rootNode.name} → ${parentEdge.from} → ${n.name}`;
    }
    return `${rootNode.name} → ${n.name}`;
  });

  return { nodes, edges, criticalTransitivePaths };
}

/**
 * POST /api/graph/npm
 * Build a dependency risk graph for an npm package.
 * Body: { package: string, depth?: 1 | 2 }
 */
app.post("/api/graph/npm", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const pkg: string = body?.package ?? "";
  const depth: 1 | 2 = body?.depth === 2 ? 2 : 1;

  if (!pkg || pkg.trim().length === 0) {
    return c.json({ error: "package is required. E.g. { \"package\": \"express\" }" }, 400);
  }

  const { nodes, edges, criticalTransitivePaths } = await buildNpmDepGraph(pkg.trim(), depth);

  const criticalCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("CRITICAL"))).length;
  const highCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("HIGH"))).length;
  const warnCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("WARN"))).length;
  const worstScore = nodes.reduce((min, n) => n.score !== null ? Math.min(min, n.score) : min, 101);

  return c.json({
    root: pkg.trim(),
    depth,
    nodes,
    edges,
    summary: {
      totalNodes: nodes.length,
      criticalCount,
      highCount,
      warnCount,
      worstScore: worstScore === 101 ? null : worstScore,
      criticalTransitivePaths,
    },
  });
});

// ── npm Badge Endpoint (public, no /api/ prefix) ─────────────────────
//
// GET /badge/npm/:package{.+}
//
// Returns a shields.io-style SVG badge for embedding in npm READMEs.
// Usage:
//   [![Commitment Score](https://poc-backend.amdal-dev.workers.dev/badge/npm/axios)](https://getcommit.dev/audit?packages=axios)
//
// Colors: green (≥70) → yellow (40-69) → red (<40) → black (CRITICAL)
// Cache: 24h CDN-friendly

app.get("/badge/npm/*", async (c) => {
  const packageName = decodeURIComponent(c.req.path.replace("/badge/npm/", ""));

  if (!packageName) {
    const svg = generateBadge("commitment", "unknown", "#9f9f9f");
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=60" },
    });
  }

  let score: number | null = null;
  let isCritical = false;

  try {
    const profile = await buildNpmCommitmentProfile(packageName);
    if (profile) {
      score = profile.commitmentScore;
      const wdl = profile.recentWeeklyDownloads ?? 0;
      if (profile.maintainerCount === 1 && wdl > 10_000_000) isCritical = true;
    }
  } catch {
    // Fall through to "unknown" badge
  }

  let value: string;
  let color: string;

  if (score === null) {
    value = "unknown";
    color = "#9f9f9f"; // grey
  } else if (isCritical) {
    value = `${score}/100 CRITICAL`;
    color = "#222222"; // black
  } else if (score < 40) {
    value = `${score}/100`;
    color = "#e05d44"; // red
  } else if (score < 70) {
    value = `${score}/100`;
    color = "#dfb317"; // yellow
  } else {
    value = `${score}/100`;
    color = "#44cc11"; // green
  }

  const svg = generateBadge("commitment", value, color);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "X-Powered-By": "getcommit.dev",
    },
  });
});

// ── API Key Endpoints ────────────────────────────────────────────────

/**
 * POST /api/keys/create
 * Accept { email } → generate free-tier API key → email it → return { ok, message }
 * Rate limit: 3 requests per IP per day
 */
app.post("/api/keys/create", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email: string = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "invalid_email", message: "A valid email address is required." }, 400);
  }

  // IP-based rate limit: 3 key creations per IP per day
  const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const now = new Date();
  const ipRow = await c.env.DB.prepare(
    `SELECT count, reset_at FROM key_creation_rate_limits WHERE ip = ? LIMIT 1`
  ).bind(ip).first<{ count: number; reset_at: string }>();

  let ipCount = 0;
  if (ipRow) {
    if (new Date(ipRow.reset_at) > now) {
      ipCount = ipRow.count;
    }
    // else: period expired, treat as fresh
  }

  if (ipCount >= 3) {
    return c.json({
      error: "rate_limit_exceeded",
      message: "Maximum 3 API keys per IP per day. Try again tomorrow.",
    }, 429);
  }

  // Update IP rate limit counter
  const tomorrowIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO key_creation_rate_limits (ip, count, reset_at)
     VALUES (?, 1, ?)
     ON CONFLICT(ip) DO UPDATE SET
       count = CASE WHEN reset_at <= datetime('now') THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= datetime('now') THEN ? ELSE reset_at END`
  ).bind(ip, tomorrowIso, tomorrowIso).run();

  // Generate API key: sk_commit_ + 32 random hex chars
  const rawBytes = new Uint8Array(16);
  crypto.getRandomValues(rawBytes);
  const randomHex = Array.from(rawBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const apiKey = `sk_commit_${randomHex}`;
  const keyHash = await sha256Hex(apiKey);
  const keyPrefix = apiKey.slice(0, 19); // "sk_commit_" + first 9 hex chars → e.g. "sk_commit_a1b2c3d4e"

  // Generate ID (nanoid-style: 16 random hex chars)
  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Period reset: midnight tomorrow UTC (daily for free tier)
  const periodResetAt = nextResetAt("daily");

  // Insert into D1
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, created_at)
     VALUES (?, ?, ?, ?, 'free', 0, ?, datetime('now'))`
  ).bind(id, keyHash, keyPrefix, email, periodResetAt).run();

  // Send via Resend email API (RESEND_API_KEY is a worker secret)
  let emailSent = false;

  const emailBody = `Your Commit API Key

Here is your free API key for Commit:

  ${apiKey}

Keep this key safe — it won't be shown again.

Usage limits (free tier):
  • 200 requests/day
  • Resets daily at midnight UTC

Quick start:
  curl https://poc-backend.amdal-dev.workers.dev/api/audit \\
    -H "Authorization: Bearer ${apiKey}" \\
    -H "Content-Type: application/json" \\
    -d '{"packages": ["express", "lodash"]}'

Check your usage:
  curl https://poc-backend.amdal-dev.workers.dev/api/keys/usage \\
    -H "Authorization: Bearer ${apiKey}"

Need more? Upgrade to Pro ($29/month, 10K requests/month):
  https://getcommit.dev/pricing

—
Commit by getcommit.dev`;

  if (c.env.RESEND_API_KEY) {
    try {
      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${c.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Commit <noreply@getcommit.dev>",
          to: [email],
          subject: "Your Commit API Key",
          text: emailBody,
        }),
      });
      emailSent = emailResp.ok;
    } catch {
      // fall through to fallback
    }
  }

  if (emailSent) {
    return c.json({
      ok: true,
      message: `API key sent to ${email}. Check your inbox.`,
      key_prefix: keyPrefix,
    });
  } else {
    // Fallback: return key in response with warning
    // This happens when RESEND_API_KEY is not configured or email delivery fails
    return c.json({
      ok: true,
      message: "Your API key is shown below — save it now.",
      key: apiKey,
      key_prefix: keyPrefix,
      note: "Email delivery unavailable. This is the only time your key will be shown.",
    });
  }
});

/**
 * GET /api/keys/usage
 * Requires valid API key in Authorization: Bearer header.
 * Returns usage stats for the authenticated key.
 */
app.get("/api/keys/usage", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer sk_commit_")) {
    return c.json(
      { error: "authentication_required", message: "Provide your API key via Authorization: Bearer sk_commit_..." },
      401
    );
  }

  const token = authHeader.slice(7);
  const keyHash = await sha256Hex(token);

  const row = await c.env.DB.prepare(
    `SELECT id, key_prefix, email, tier, requests_this_period, period_reset_at, created_at, last_used_at, revoked_at
     FROM api_keys WHERE key_hash = ? LIMIT 1`
  ).bind(keyHash).first<{
    id: string;
    key_prefix: string;
    email: string;
    tier: string;
    requests_this_period: number;
    period_reset_at: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }>();

  if (!row) {
    return c.json({ error: "invalid_api_key", message: "API key not found." }, 401);
  }

  if (row.revoked_at) {
    return c.json({ error: "api_key_revoked", message: "This API key has been revoked." }, 401);
  }

  const tier = (row.tier as "free" | "pro" | "enterprise") || "free";
  const tierConfig = TIER_LIMITS[tier] || TIER_LIMITS.free;

  // Check if period has reset
  let requestsThisPeriod = row.requests_this_period;
  let periodResetAt = row.period_reset_at;
  if (new Date(periodResetAt) <= new Date()) {
    periodResetAt = nextResetAt(tierConfig.period);
    requestsThisPeriod = 0;
    await c.env.DB.prepare(`UPDATE api_keys SET requests_this_period = 0, period_reset_at = ? WHERE id = ?`)
      .bind(periodResetAt, row.id).run();
  }

  const limit = tierConfig.limit === Infinity ? null : tierConfig.limit;

  return c.json({
    key_prefix: row.key_prefix,
    tier,
    requests_used: requestsThisPeriod,
    requests_limit: limit,
    period: tierConfig.period,
    period_reset_at: periodResetAt,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    upgrade_url: tier === "free" ? "https://getcommit.dev/pricing" : null,
  });
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
    version: "1.0.0",
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

  // Tool: audit_github_repo
  mcp.tool(
    "audit_github_repo",
    `Audit the supply chain risk of a GitHub repository's dependencies. Fetches the repo's package.json and/or requirements.txt from GitHub and runs behavioral commitment scoring on every dependency.

This is the fastest way to audit a project — just provide the GitHub URL or owner/repo slug, and get a full risk table in seconds.

Risk flags:
- CRITICAL: single maintainer + >10M weekly downloads (high-value target like chalk, zod, axios)
- HIGH: sole maintainer + >1M/wk downloads, OR new package (<1yr) with high adoption
- WARN: no release in 12+ months (potential abandonware)

Examples:
- "vercel/next.js" — audit Next.js dependencies
- "https://github.com/langchain-ai/langchainjs" — audit LangChain JS
- "facebook/react" — audit React's dependency tree
- "anthropics/anthropic-sdk-python" — audit Anthropic Python SDK

Use this when someone asks "is my project at risk?" or "audit this repo's dependencies".`,
    {
      repo: z
        .string()
        .describe(
          'GitHub repository to audit. Accepts: "owner/repo", "https://github.com/owner/repo", or any GitHub URL. Examples: "vercel/next.js", "https://github.com/langchain-ai/langchainjs"'
        ),
    },
    async ({ repo: repoInput }) => {
      const parsed = parseGitHubRepo(repoInput);
      if (!parsed) {
        return {
          content: [{ type: "text" as const, text: `Invalid repo format: "${repoInput}". Use "owner/repo" or a GitHub URL.` }],
          isError: true,
        };
      }

      const { owner, repo } = parsed;

      const [packageJsonContent, requirementsTxtContent] = await Promise.all([
        fetchGitHubRaw(owner, repo, "package.json"),
        fetchGitHubRaw(owner, repo, "requirements.txt"),
      ]);

      const npmPackages = packageJsonContent ? extractFromPackageJson(packageJsonContent) : [];
      const pypiPackages = requirementsTxtContent ? extractFromRequirementsTxt(requirementsTxtContent) : [];

      if (npmPackages.length === 0 && pypiPackages.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No dependencies found in ${owner}/${repo}. Checked: package.json, requirements.txt.` }],
          isError: true,
        };
      }

      type GitAuditResult = {
        name: string;
        ecosystem: string;
        score: number | null;
        maintainers: number | null;
        weeklyDownloads: number | null;
        ageYears: number | null;
        trend: string | null;
        riskFlags: string[];
        error?: string;
      };

      const auditPkgs = async (pkgs: string[], eco: "npm" | "pypi"): Promise<GitAuditResult[]> => {
        const results: GitAuditResult[] = [];
        for (let i = 0; i < pkgs.length; i += 5) {
          const batch = pkgs.slice(i, i + 5);
          const batchResults = await Promise.all(
            batch.map(async (pkg): Promise<GitAuditResult> => {
              try {
                if (eco === "pypi") {
                  const profile = await buildPyPICommitmentProfile(pkg);
                  if (!profile) return { name: pkg, ecosystem: eco, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], error: "not found" };
                  const weeklyDl = profile.recentDailyDownloads * 7;
                  const riskFlags: string[] = [];
                  if (profile.maintainerCount <= 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL: sole maintainer + >10M/wk");
                  else if (profile.maintainerCount <= 1 && weeklyDl > 1_000_000) riskFlags.push("HIGH: sole maintainer + >1M/wk");
                  if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
                  return { name: profile.name, ecosystem: eco, score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: weeklyDl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, riskFlags };
                } else {
                  const profile = await buildNpmCommitmentProfile(pkg);
                  if (!profile) return { name: pkg, ecosystem: eco, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], error: "not found" };
                  const wdl = profile.recentWeeklyDownloads ?? 0;
                  const riskFlags: string[] = [];
                  if (profile.maintainerCount <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL: sole maintainer + >10M/wk");
                  else if (profile.maintainerCount <= 1 && wdl > 1_000_000) riskFlags.push("HIGH: sole maintainer + >1M/wk");
                  if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
                  return { name: profile.name, ecosystem: eco, score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: wdl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, riskFlags };
                }
              } catch (err) {
                return { name: pkg, ecosystem: eco, score: null, maintainers: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], error: err instanceof Error ? err.message : "error" };
              }
            })
          );
          results.push(...batchResults);
        }
        return results;
      };

      const [npmResults, pypiResults] = await Promise.all([
        auditPkgs(npmPackages, "npm"),
        auditPkgs(pypiPackages, "pypi"),
      ]);

      const allResults = [...npmResults, ...pypiResults];
      allResults.sort((a, b) => {
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return a.score - b.score;
      });

      const rows = allResults.map((r) => {
        const scoreStr = r.score !== null ? `${r.score}/100` : "N/A";
        const dlStr = r.weeklyDownloads !== null
          ? r.weeklyDownloads >= 1_000_000 ? `${(r.weeklyDownloads / 1_000_000).toFixed(1)}M/wk`
          : r.weeklyDownloads >= 1_000 ? `${Math.round(r.weeklyDownloads / 1_000)}k/wk`
          : `${r.weeklyDownloads}/wk` : "N/A";
        const maintStr = r.maintainers !== null ? `${r.maintainers} maint.` : "N/A";
        const ageStr = r.ageYears !== null ? r.ageYears >= 1 ? `${Math.floor(r.ageYears)}yr` : `${Math.round(r.ageYears * 12)}mo` : "N/A";
        const flags = r.riskFlags.length > 0 ? ` ⚠️ ${r.riskFlags.join("; ")}` : "";
        return `  ${scoreStr.padEnd(7)} ${r.name.padEnd(35)} ${dlStr.padEnd(12)} ${maintStr.padEnd(10)} ${ageStr}${flags}`;
      });

      const criticalCount = allResults.filter((r) => r.riskFlags.some((f) => f.startsWith("CRITICAL"))).length;
      const highCount = allResults.filter((r) => r.riskFlags.some((f) => f.startsWith("HIGH"))).length;
      const warnCount = allResults.filter((r) => r.riskFlags.some((f) => f.startsWith("WARN"))).length;

      const summary = [
        `GitHub Dependency Audit: ${owner}/${repo}`,
        `Found: ${npmPackages.length} npm + ${pypiPackages.length} PyPI packages`,
        `Risk: ${criticalCount} CRITICAL, ${highCount} HIGH, ${warnCount} WARN`,
        ``,
        `  Score   Package                             Downloads    Maintainers Age`,
        `  ------  ----------------------------------  -----------  ----------- ---`,
        ...rows,
        ``,
        `Score: 0-100 behavioral commitment. <40 = elevated risk. CRITICAL = immediate audit recommended.`,
        `Full audit: https://getcommit.dev/audit`,
      ].join("\n");

      return {
        content: [
          { type: "text" as const, text: summary },
          { type: "text" as const, text: JSON.stringify({ repo: `${owner}/${repo}`, results: allResults }, null, 2) },
        ],
      };
    }
  );

  // Tool: audit_dependency_tree
  mcp.tool(
    "audit_dependency_tree",
    `Map the full dependency tree of an npm package and identify CRITICAL supply chain risks at every level.

Unlike auditing a flat list of packages, this tool traverses the dependency graph — showing not just your direct dependencies but also what your dependencies depend on. Hidden CRITICAL packages (sole maintainer + >10M weekly downloads) often lurk 1-2 levels deep.

Risk flags:
- CRITICAL: single maintainer + >10M weekly downloads — sole point of failure for a massive attack surface
- HIGH: sole maintainer + >1M/wk, OR new package (<1yr) with high adoption
- WARN: no release in 12+ months (potential abandonware)

depth=1 (default): root package + all direct dependencies
depth=2: also traverses one more level for any CRITICAL/HIGH direct deps (reveals hidden exposure)

Examples:
- audit_dependency_tree("express") — see all of Express's deps and their risk scores
- audit_dependency_tree("langchain", 2) — reveal transitive CRITICAL deps 2 levels deep
- audit_dependency_tree("@anthropic-ai/sdk") — audit Anthropic SDK full tree

Use this when someone asks:
- "What am I really depending on?"
- "Are my dependencies' dependencies safe?"
- "Show me the full supply chain risk for package X"`,
    {
      package: z
        .string()
        .describe('npm package name to map. Examples: "express", "langchain", "@anthropic-ai/sdk", "zod"'),
      depth: z
        .number()
        .int()
        .min(1)
        .max(2)
        .default(1)
        .describe('How deep to traverse. 1 = direct deps only (fast). 2 = also traverse deps of CRITICAL/HIGH packages (slower, reveals hidden risk). Default: 1'),
    },
    async ({ package: pkg, depth }) => {
      const safeDepth: 1 | 2 = depth >= 2 ? 2 : 1;
      const { nodes, edges, criticalTransitivePaths } = await buildNpmDepGraph(pkg.trim(), safeDepth);

      const criticalNodes = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("CRITICAL")));
      const highNodes = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("HIGH")));
      const warnNodes = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("WARN")));
      const rootNode = nodes.find((n) => n.depth === 0);

      const formatDl = (wdl: number | null) => {
        if (wdl === null) return "N/A";
        if (wdl >= 1_000_000) return `${(wdl / 1_000_000).toFixed(1)}M/wk`;
        if (wdl >= 1_000) return `${Math.round(wdl / 1_000)}k/wk`;
        return `${wdl}/wk`;
      };

      // Build risk table (sorted worst first)
      const riskNodes = [...criticalNodes, ...highNodes, ...warnNodes];
      const riskRows = riskNodes.map((n) => {
        const score = n.score !== null ? `${n.score}/100` : "N/A";
        const dl = formatDl(n.weeklyDownloads);
        const maint = n.maintainers !== null ? `${n.maintainers} maint.` : "N/A";
        const depthLabel = n.depth === 0 ? "root" : n.depth === 1 ? "direct" : "transitive";
        return `  ${score.padEnd(7)} ${n.name.padEnd(35)} ${dl.padEnd(12)} ${maint.padEnd(10)} [${depthLabel}] ⚠️ ${n.riskFlags[0]}`;
      });

      const directDeps = nodes.filter((n) => n.depth === 1);
      const transitiveDeps = nodes.filter((n) => n.depth === 2);

      const lines = [
        `Dependency Tree Risk Audit: ${pkg.trim()}`,
        `Root score: ${rootNode?.score ?? "N/A"}/100`,
        `Direct deps: ${directDeps.length} | Transitive scanned: ${transitiveDeps.length}`,
        `Risk summary: ${criticalNodes.length} CRITICAL, ${highNodes.length} HIGH, ${warnNodes.length} WARN`,
        ``,
      ];

      if (criticalTransitivePaths.length > 0) {
        lines.push(`Critical exposure paths:`);
        for (const path of criticalTransitivePaths) {
          lines.push(`  ⚠️ ${path}`);
        }
        lines.push(``);
      }

      if (riskRows.length > 0) {
        lines.push(`  Score   Package                             Downloads    Maintainers Depth`);
        lines.push(`  ------  ----------------------------------  -----------  ----------- -------`);
        lines.push(...riskRows);
        lines.push(``);
      } else {
        lines.push(`No CRITICAL or HIGH risk packages found in this tree.`);
        lines.push(``);
      }

      lines.push(`Score: 0-100 behavioral commitment. CRITICAL = sole maintainer + >10M downloads/wk.`);
      lines.push(`Full audit: https://getcommit.dev/audit`);

      if (safeDepth === 1 && criticalNodes.length === 0 && directDeps.length > 0) {
        lines.push(`Tip: Run with depth=2 to check for hidden transitive risks.`);
      }

      return {
        content: [
          { type: "text" as const, text: lines.join("\n") },
          {
            type: "text" as const,
            text: JSON.stringify({
              root: pkg.trim(),
              depth: safeDepth,
              summary: {
                totalNodes: nodes.length,
                criticalCount: criticalNodes.length,
                highCount: highNodes.length,
                warnCount: warnNodes.length,
                criticalTransitivePaths,
              },
              nodes,
              edges,
            }, null, 2),
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
