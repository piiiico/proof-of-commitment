/**
 * Proof of Commitment — Aggregator Backend (Cloudflare Workers + D1)
 *
 * Production deployment. Mirrors the API surface of server.ts (local
 * Bun + SQLite) but runs on CF Workers + D1.
 *
 * POST /api/commit       — submit commitment(s)
 * GET  /api/domain/:d    — stats for a specific domain
 * GET  /                 — health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

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

export default app;
