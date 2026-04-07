import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { insertCommitment, getDomainStats, type Commitment } from "./db.ts";
import { buildCommitmentProfile, searchAndProfile } from "./brreg.ts";

const app = new Hono();

// ── Middleware ──
app.use("*", logger());
app.use("/api/*", cors());

// ── Health ──
app.get("/", (c) => c.json({ status: "ok", service: "proof-of-commitment" }));

// ── POST /api/commit ──
// Submit anonymous visit commitment(s).
// Body: single commitment or array of commitments.
// Each commitment: { domain, visitCount, totalSeconds, firstSeen, lastSeen }
app.post("/api/commit", async (c) => {
  const body = await c.req.json();

  // Accept single object or array
  const items: unknown[] = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    return c.json({ error: "Empty payload" }, 400);
  }

  const errors: string[] = [];
  let accepted = 0;

  for (const item of items) {
    const parsed = validateCommitment(item);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    // Dev server has no World ID auth — pass null so anonymous inserts
    // don't conflict with each other via the UNIQUE(domain, world_id_sub) index.
    insertCommitment(parsed.value, null);
    accepted++;
  }

  if (accepted === 0) {
    return c.json({ error: "No valid commitments", details: errors }, 400);
  }

  return c.json({ accepted, errors: errors.length > 0 ? errors : undefined });
});

// ── GET /api/domain/:domain ──
// Get aggregate stats for a domain.
app.get("/api/domain/:domain", (c) => {
  const domain = c.req.param("domain");
  const stats = getDomainStats(domain);

  if (!stats) {
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

  return c.json(stats);
});

// ── GET /api/business/search?q=name ──
// Search Norwegian businesses by name and return commitment profiles.
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

// ── GET /api/business/:orgNumber ──
// Look up a specific business by org number and return commitment profile.
app.get("/api/business/:orgNumber", async (c) => {
  const orgNumber = c.req.param("orgNumber").replace(/\s/g, "");

  if (!/^\d{9}$/.test(orgNumber)) {
    return c.json({ error: "Organization number must be 9 digits" }, 400);
  }

  const profile = await buildCommitmentProfile(orgNumber);

  if (!profile) {
    return c.json({ error: `No business found with org number ${orgNumber}` }, 404);
  }

  return c.json(profile);
});

// ── Validation ──

type ValidationResult =
  | { ok: true; value: Commitment }
  | { ok: false; error: string };

function validateCommitment(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Commitment must be an object" };
  }

  const obj = input as Record<string, unknown>;

  // domain: required non-empty string
  if (typeof obj.domain !== "string" || obj.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }

  // visitCount: required positive integer
  if (typeof obj.visitCount !== "number" || !Number.isInteger(obj.visitCount) || obj.visitCount < 1) {
    return { ok: false, error: "visitCount must be a positive integer" };
  }

  // totalSeconds: required non-negative integer
  if (typeof obj.totalSeconds !== "number" || !Number.isInteger(obj.totalSeconds) || obj.totalSeconds < 0) {
    return { ok: false, error: "totalSeconds must be a non-negative integer" };
  }

  // firstSeen: required unix timestamp (ms)
  if (typeof obj.firstSeen !== "number" || obj.firstSeen < 0) {
    return { ok: false, error: "firstSeen must be a non-negative number (unix ms)" };
  }

  // lastSeen: required unix timestamp (ms), >= firstSeen
  if (typeof obj.lastSeen !== "number" || obj.lastSeen < obj.firstSeen) {
    return { ok: false, error: "lastSeen must be >= firstSeen" };
  }

  // Sanitize domain: lowercase, strip protocol/path
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

// ── Start ──
const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};

console.log(`Proof of Commitment backend listening on :${port}`);
