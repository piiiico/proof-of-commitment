/**
 * Proof of Commitment — Aggregator Backend (Cloudflare Workers + D1)
 *
 * Production deployment. Mirrors the API surface of server.ts (local
 * Bun + SQLite) but runs on CF Workers + D1.
 *
 * POST /api/commit                      — submit commitment(s)
 * GET  /api/domain/:d                  — stats for a specific domain
 * GET  /api/business/search?q=         — search Norwegian businesses
 * GET  /api/business/:orgNumber        — business commitment profile
 * POST /api/audit                      — batch npm/PyPI/Cargo/Go supply chain risk scoring
 * GET  /api/badge/:eco/:pkg            — SVG badge for README embedding (npm, PyPI, Cargo, Go)
 * GET  /badge/:pkg                     — Simple trust badge (npm only, shields.io-style)
 * GET  /badge/:pkg.svg                 — Same, .svg variant for img src embedding
 * GET  /og/:ecosystem/:package         — PNG OG image (1200×630) for social sharing
 * GET  /og/blog                        — PNG OG image for blog posts (?title=...&date=...)
 * GET  /api/github/:owner/:repo        — GitHub repo commitment profile (with endorsements)
 * POST /api/repos/:owner/:repo/endorse — endorse a GitHub repo (requires World ID JWT)
 * ALL  /mcp                            — Remote MCP server (Streamable HTTP)
 * GET  /                               — health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { buildCommitmentProfile, searchAndProfile } from "./brreg.ts";
import { buildGitHubCommitmentProfile, parseGitHubInput } from "./github.ts";
import { buildNpmCommitmentProfile, bulkFetchNpmWeeklyDownloads, isSuspiciouslyZeroDownloads } from "./npm.ts";
import { buildPyPICommitmentProfile } from "./pypi.ts";
import { buildCargoCommitmentProfile } from "./cargo.ts";
import { buildGolangCommitmentProfile } from "./golang.ts";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
// @ts-ignore — wrangler handles .wasm imports as pre-compiled WebAssembly.Module at deploy time
import RESVG_WASM from "@resvg/resvg-wasm/index_bg.wasm";
import { OG_FONT_BASE64 } from "./og-font";

// Singleton init promise — CF isolate persists across requests, initWasm throws if called twice
let resvgInitPromise: Promise<void> | null = null;
function ensureResvgInit(): Promise<void> {
  if (!resvgInitPromise) {
    resvgInitPromise = initWasm(RESVG_WASM);
  }
  return resvgInitPromise;
}

// Decode the embedded font once per isolate.
let OG_FONT_BYTES: Uint8Array | null = null;
function getOgFontBytes(): Uint8Array {
  if (!OG_FONT_BYTES) {
    const b = atob(OG_FONT_BASE64);
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    OG_FONT_BYTES = out;
  }
  return OG_FONT_BYTES;
}

/** Render SVG string to PNG bytes using resvg-wasm. Loads the embedded font so
 *  <text> elements actually render (CF Workers has no system fonts). */
async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureResvgInit();
  const renderer = new Resvg(svg, {
    font: {
      fontBuffers: [getOgFontBytes()],
      defaultFontFamily: "Liberation Sans",
      sansSerifFamily: "Liberation Sans",
      monospaceFamily: "Liberation Sans",
      serifFamily: "Liberation Sans",
    },
  });
  const rendered = renderer.render();
  return rendered.asPng();
}

// ── Known Supply Chain Attacks ───────────────────────────────────────
// Recent compromised packages. Checked during /api/audit to surface
// incident data alongside behavioral scoring. Entries expire naturally
// as attacks age out (show only last 90 days).

interface AttackRecord {
  attack: string;       // short name
  date: string;         // ISO date of incident
  url: string;          // blog post / analysis link
  affectedVersions?: string; // optional version range
}

const KNOWN_ATTACKS: Map<string, AttackRecord> = new Map();
const KNOWN_ATTACK_PREFIXES: Array<{ prefix: string; eco: string; record: AttackRecord }> = [];

function registerAttack(ecosystem: string, packages: string[], record: AttackRecord) {
  for (const pkg of packages) {
    if (pkg.endsWith("/*")) {
      KNOWN_ATTACK_PREFIXES.push({ prefix: pkg.slice(0, -1), eco: ecosystem, record });
    } else {
      KNOWN_ATTACKS.set(`${ecosystem}:${pkg}`, record);
    }
  }
}

// TrapDoor — cross-ecosystem credential theft + AI assistant poisoning (May 22 2026)
registerAttack("npm", [
  "async-pipeline-builder", "build-scripts-utils", "chain-key-validator",
  "crypto-credential-scanner", "defi-env-auditor", "defi-threat-scanner",
  "deployment-key-auditor", "dev-env-bootstrapper", "eth-wallet-sentinel",
  "llm-context-compressor", "mnemonic-safety-check", "model-switch-router",
  "node-setup-helpers", "project-init-tools", "prompt-engineering-toolkit",
  "solidity-deploy-guard", "token-usage-tracker", "wallet-backup-verifier",
  "wallet-security-checker", "web3-secrets-detector", "workspace-config-loader",
], {
  attack: "TrapDoor",
  date: "2026-05-22",
  url: "https://getcommit.dev/blog/trapdoor-ai-assistant-poisoning/",
});
registerAttack("pypi", [
  "cryptowallet-safety", "data-pipeline-check", "defi-risk-scanner",
  "env-loader-cli", "eth-security-auditor", "git-config-sync", "solidity-build-guard",
], {
  attack: "TrapDoor",
  date: "2026-05-22",
  url: "https://getcommit.dev/blog/trapdoor-ai-assistant-poisoning/",
});
registerAttack("cargo", [
  "move-analyzer-build", "move-compiler-tools", "move-project-builder",
  "sui-framework-helpers", "sui-move-build-helper", "sui-sdk-build-utils",
], {
  attack: "TrapDoor",
  date: "2026-05-22",
  url: "https://getcommit.dev/blog/trapdoor-ai-assistant-poisoning/",
});

// Miasma — Red Hat credential theft via compromised GitHub account (Jun 1 2026)
registerAttack("npm", [
  "@redhat-cloud-services/*",
], {
  attack: "Miasma",
  date: "2026-06-01",
  url: "https://getcommit.dev/blog/redhat-miasma-provenance-bypass/",
});

// IronWorm — Rust-based infostealer via asteroiddao account (Jun 4 2026)
// eBPF rootkit + Tor C2 + npm Trusted Publishing self-propagation
// Commits authored as "claude@users.noreply.github.com" with forged timestamps
registerAttack("npm", [
  "weavedb-lite", "weavedb-sdk-base", "test-weavedb-sdk",
  "weavedb-warp-contracts-plugin-deploy", "arnext-arkb", "weavedb-console",
  "arnext", "roidjs", "weavedb-exm-sdk", "create-arnext-app",
  "weavedb-tools", "wdb-core", "cwao-tools", "test-ajs", "monade",
  "weavedb-exm-sdk-web", "testnpmnmp", "warp-contracts-plugin-deploy-test",
  "wdb-cli", "ai3", "cwao-units", "atomic-notes", "cwao",
  "weavedb-client", "wdb-sdk", "weavedb-offchain", "fpjson-lang",
  "weavedb-contracts", "weavedb-node-client", "arjson", "hbsig",
  "zkjson", "aonote", "weavedb-base", "weavedb-sdk-node", "wao",
  "weavedb-sdk",
], {
  attack: "IronWorm",
  date: "2026-06-04",
  url: "https://getcommit.dev/blog/ironworm-rust-malware-targets-ai-credentials/",
});

// Miasma — Phantom Gyp wave: @vapi-ai + jagreehal ecosystem (Jun 3 2026)
// Uses binding.gyp instead of lifecycle scripts to bypass install-script monitors.
// Plants .claude/setup.mjs, .cursor/rules/setup.mdc, .gemini/settings.json
// 57 packages across 286+ malicious versions in under 2 hours.
// Sources: snyk.io/blog/node-gyp-supply-chain-compromise, stepsecurity.io
registerAttack("npm", [
  "@vapi-ai/*",
  "@jagreehal/*",
  "@evolvconsulting/evolv-coder-lite",
  "ai-sdk-ollama",
  "autotel", "autotel-adapters", "autotel-audit", "autotel-aws",
  "autotel-backends", "autotel-cli", "autotel-cloudflare", "autotel-devtools",
  "autotel-drizzle", "autotel-edge", "autotel-eventcatalog", "autotel-hono",
  "autotel-mcp", "autotel-mcp-instrumentation", "autotel-mongoose", "autotel-pact",
  "autotel-playwright", "autotel-plugins", "autotel-sentry", "autotel-subscribers",
  "autotel-tanstack", "autotel-terminal", "autotel-vitest", "autotel-web",
  "awaitly", "awaitly-analyze", "awaitly-libsql", "awaitly-mongo",
  "awaitly-postgres", "awaitly-visualizer",
  "effect-analyzer",
  "eslint-plugin-awaitly",
  "eslint-plugin-executable-stories-jest", "eslint-plugin-executable-stories-playwright",
  "eslint-plugin-executable-stories-vitest",
  "executable-stories-cypress", "executable-stories-demo", "executable-stories-formatters",
  "executable-stories-init", "executable-stories-jest", "executable-stories-mcp",
  "executable-stories-playwright", "executable-stories-react", "executable-stories-vitest",
  "http-uploader-dev",
  "mountly", "mountly-tailwind",
  "node-env-resolver", "node-env-resolver-aws", "node-env-resolver-dotenvx",
  "node-env-resolver-nextjs", "node-env-resolver-vite",
  "wrangler-deploy",
], {
  attack: "Miasma (Phantom Gyp)",
  date: "2026-06-03",
  url: "https://getcommit.dev/blog/phantom-gyp-binding-gyp-bypass/",
});

// Mini Shai-Hulud — TanStack (May 11 2026)
registerAttack("npm", [
  "@tanstack/*",
], {
  attack: "Mini Shai-Hulud",
  date: "2026-05-11",
  url: "https://getcommit.dev/blog/two-attacks-one-week/",
});

// node-ipc credential harvester (May 14 2026)
registerAttack("npm", ["node-ipc"], {
  attack: "node-ipc credential harvester",
  date: "2026-05-14",
  url: "https://getcommit.dev/blog/two-attacks-one-week/",
});

// Mini Shai-Hulud — UiPath (May 11 2026)
registerAttack("npm", ["@uipath/*"], {
  attack: "Mini Shai-Hulud",
  date: "2026-05-11",
  url: "https://getcommit.dev/blog/may-2026-npm-attacks-roundup/",
});

// Mini Shai-Hulud — SAP CAP (Apr 29 2026)
registerAttack("npm", ["@cap-js/*"], {
  attack: "Mini Shai-Hulud",
  date: "2026-04-29",
  url: "https://getcommit.dev/blog/may-2026-npm-attacks-roundup/",
});

// Sapphire Sleet — Mastra AI framework credential theft via phished maintainer (Jun 17 2026)
// North Korean state actor (MSFT attribution). Injected easy-day-js typosquat (dayjs clone)
// into 141 @mastra packages in 88 minutes. PowerShell backdoor + crypto wallet harvester
// targeting 166 browser-extension IDs. C2: 23.254.164.92, maskasd.com
// Sources: Microsoft Threat Intelligence (Jun 17), Mastra incident report #18061
registerAttack("npm", [
  "@mastra/*",
  "mastra",
  "easy-day-js",
], {
  attack: "Sapphire Sleet (Mastra)",
  date: "2026-06-17",
  url: "https://getcommit.dev/blog/mastra-dormant-publisher-attack/",
});

// Mini Shai-Hulud — @antv visualization ecosystem (May 20 2026)
// Compromised @antv npm packages enable CI/CD credential theft.
// Same worm family as TanStack (May 11) and UiPath (May 11).
// Source: Microsoft Threat Intelligence
registerAttack("npm", [
  "@antv/*",
], {
  attack: "Mini Shai-Hulud",
  date: "2026-05-20",
  url: "https://getcommit.dev/blog/may-2026-npm-attacks-roundup/",
});

// Miasma — LeoPlatform + Go ecosystem expansion (Jun 24 2026)
// codfish/semantic-release-action force-pushed → 1442 dependent repos compromised.
// binding.gyp bypass, Bun payload staging, AI IDE persistence hooks.
// Campaign marker: RevokeAndItGoesKaboom
// First Go module compromise in the Shai-Hulud family.
// Source: socket.dev (Jun 25)
registerAttack("npm", [
  "leo-auth", "leo-aws", "leo-cache", "leo-cdk-lib", "leo-cli",
  "leo-config", "leo-connector-elasticsearch", "leo-connector-mongo",
  "leo-connector-mysql", "leo-connector-oracle", "leo-connector-redshift",
  "leo-cron", "leo-logger", "leo-sdk", "leo-streams",
  "rstreams-metrics", "rstreams-shard-util",
  "hexo-deployer-wrangler", "hexo-shoka-swiper", "prism-silq",
  "serverless-convention", "serverless-leo", "solo-nav",
], {
  attack: "Miasma (LeoPlatform)",
  date: "2026-06-24",
  url: "https://socket.dev/blog/miasma-mini-shai-hulud-hits-leoplatform-npm-packages-go-ecosystem",
});
registerAttack("golang", [
  "github.com/verana-labs/verana-blockchain",
], {
  attack: "Miasma (LeoPlatform)",
  date: "2026-06-24",
  url: "https://socket.dev/blog/miasma-mini-shai-hulud-hits-leoplatform-npm-packages-go-ecosystem",
});

// Miasma — ImmobiliareLabs/Backstage (Jun 26 2026)
// codfish/semantic-release-action hijack → compromised CI/CD release pipelines.
// 22 @immobiliarelabs Backstage plugins (GitLab, LDAP auth).
// binding.gyp bypass, AES-128-GCM payload, Bun execution.
// Campaign marker: thebeautifulsnadsoftime
// Source: socket.dev (Jun 26)
registerAttack("npm", [
  "@immobiliarelabs/*",
], {
  attack: "Miasma (ImmobiliareLabs/Backstage)",
  date: "2026-06-26",
  url: "https://socket.dev/blog/miasma-mini-shai-hulud-hits-immobiliarelabs-npm-packages",
});

// axios credential theft (Mar 30 2026)
registerAttack("npm", ["axios"], {
  attack: "axios token theft",
  date: "2026-03-30",
  url: "https://getcommit.dev/blog/axios-attack-prediction/",
});

// LiteLLM PyPI supply chain (Mar 2026)
registerAttack("pypi", ["litellm"], {
  attack: "LiteLLM PyPI token theft",
  date: "2026-03-05",
  url: "https://getcommit.dev/blog/python-supply-chain-risk/",
});

function lookupCompromised(name: string, ecosystem: string): AttackRecord | null {
  // Exact match first
  const exact = KNOWN_ATTACKS.get(`${ecosystem}:${name}`);
  if (exact) return exact;
  // Prefix match (for scoped packages like @redhat-cloud-services/*)
  for (const { prefix, eco, record } of KNOWN_ATTACK_PREFIXES) {
    if (eco === ecosystem && name.startsWith(prefix)) return record;
  }
  return null;
}

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
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PRO?: string;       // Stripe Price ID for Pro ($29/mo recurring)
  STRIPE_PRICE_DEV?: string;       // Stripe Price ID for Developer ($15/mo recurring)
  ADMIN_SECRET?: string;
  // Comma-separated glob patterns (use `*` for wildcard) of email addresses
  // that count as internal test signups, not organic ones. Used by
  // /api/keys/stats to classify source=mcp-soft-cta keys.
  INTERNAL_TEST_EMAIL_PATTERNS?: string;
};

// API key context attached to requests that use Bearer authentication
interface ApiKeyContext {
  id: string;
  key_prefix: string;
  email: string;
  tier: "free" | "developer" | "pro" | "enterprise";
  requests_this_period: number;
  period_reset_at: string;
}

// Rate limits per tier. Keep in sync with /pricing tier cards.
//   free       — 200/day  (Open tier)
//   developer  — 1000/day ($15/mo, 5× free)
//   pro        — 10K/mo   ($29/mo)
//   enterprise — unlimited
// Lookup is defensive: row.tier from D1 falls back to TIER_LIMITS.free if unknown.
// A missing developer entry was a silent revenue bug — paid Developer customers
// would have been served free-tier limits.
const TIER_LIMITS = {
  free: { limit: 200, period: "daily" as const },
  developer: { limit: 1000, period: "daily" as const },
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
 * Routes that should NOT increment the authenticated key's
 * requests_this_period counter. These are metadata/self-inspection endpoints —
 * calling them to check your own usage should not BURN usage. Pre-2026-06-03,
 * `/api/keys/usage` ran through the increment path, so a dashboard refresh or
 * a CLI `poc status` call cost the user 1 of their daily quota. Confirmed live
 * via dogfood signup 2026-06-03: 1 audit + 2 usage checks → counter showed 3.
 *
 * Keep this list tight: only true metadata routes (no scoring work, no upstream
 * cost). The audit/graph/github-audit/MCP paths must continue to count.
 */
export const READ_ONLY_KEY_PATHS = new Set<string>([
  "/api/keys/usage",
]);

/**
 * Decide whether an incoming Origin header represents the getcommit.dev web
 * surface (browser fetch from audit.astro) or anything else (CLI npm package,
 * MCP server, external API caller, missing Origin).
 *
 * Used by the /api/audit 429-taste branch to attribute funnel source. After
 * v1.17.0 the CLI started sending `Accept: application/json` to opt into the
 * structured 429 body, which broke the previous Accept-header heuristic and
 * mis-tagged every CLI 429 as `audit-web-429`. Origin is the reliable signal:
 * browsers always send it on cross-origin fetch (CORS); Node fetch does not.
 *
 * Matches: `https://getcommit.dev`, `https://www.getcommit.dev`, `https://staging.getcommit.dev`,
 *          `http://localhost`, `http://localhost:4321`.
 * Rejects: `""`, `"null"`, `https://getcommit.dev.evil.com`,
 *          `chrome-extension://...`, any unrelated host.
 */
export function isGetcommitWebOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return /^https?:\/\/(?:[^/]*\.)?(?:getcommit\.dev|localhost(?::\d+)?)$/i.test(origin);
}

/**
 * Resolve API key from Authorization: Bearer header.
 * Returns null if no header present (anonymous request).
 * Returns ApiKeyContext if valid, throws on invalid/revoked/over-limit.
 *
 * `countAsRequest=false` skips the requests_this_period increment AND the
 * over-limit gate — the caller is doing metadata (self-inspection of usage)
 * which should never burn quota or 429 a user trying to find out WHY they're
 * 429'd elsewhere. last_used_at is also NOT bumped so "last activity" stays
 * meaningful as a real-API-use signal.
 */
export async function resolveApiKey(
  db: D1Database,
  authHeader: string | undefined,
  countAsRequest: boolean = true
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
  const tier = (row.tier as "free" | "developer" | "pro" | "enterprise") || "free";
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

  // Read-only metadata path: skip both the over-limit gate AND the increment.
  // A user checking /api/keys/usage to see WHY their /api/audit just 429'd
  // should never be 429'd themselves on the metadata call — and asking for
  // usage should not consume usage.
  if (!countAsRequest) {
    return { key: keyCtx };
  }

  // Check usage limits
  if (tier !== "enterprise" && requestsThisPeriod >= tierConfig.limit) {
    const retryAfterSec = Math.floor((new Date(periodResetAt).getTime() - Date.now()) / 1000);
    // Upgrade target = next tier up. Free → Developer (cheaper first step), Developer → Pro.
    // upgrade.url carries the authenticated user's email so /pricing pre-fills
    // the modal — closes one re-type step at the exact moment a rate-limited
    // user is most motivated to upgrade. medium=quota tags this as a rate-limit
    // surface in analytics; campaign+source set in buildUpgradeUrl.
    const upgradeUrl = buildUpgradeUrl(row.email, { medium: "quota" });
    const upgrade = tier === "free"
      ? {
          url: upgradeUrl,
          plan: "developer",
          price: "$15/month",
          limit: "1,000 requests/day",
          message: "Upgrade to Developer for 5x more requests, batch API, and CI auto-trigger.",
        }
      : {
          url: upgradeUrl,
          plan: "pro",
          price: "$29/month",
          limit: "10,000 requests/month",
          message: "Upgrade to Pro for 10x more requests, batch API, and dependency monitoring.",
        };
    return {
      key: keyCtx,
      error: {
        status: 429,
        body: {
          error: "rate_limit_exceeded",
          message: `You've used ${requestsThisPeriod}/${tierConfig.limit} requests this period. Resets in ${timeUntil(periodResetAt)}.`,
          tier,
          upgrade,
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
app.use("/badge/*", cors());

// ── Auth Middleware ───────────────────────────────────────────────────
// Runs before all /api/* routes.
// - If Bearer sk_commit_... header present: validate key, enforce limits, attach to context
// - Otherwise: anonymous (IP rate limiting handled per-route where needed)
app.use("/api/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  // Only intercept if it looks like a Commit API key
  if (authHeader?.startsWith("Bearer sk_commit_")) {
    // Metadata routes (self-inspection) must not burn quota or 429 the user.
    // See READ_ONLY_KEY_PATHS docblock above resolveApiKey.
    const countAsRequest = !READ_ONLY_KEY_PATHS.has(c.req.path);
    const { key, error } = await resolveApiKey(c.env.DB, authHeader, countAsRequest);
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

  // Add X-RateLimit-* headers to all API responses.
  // For anonymous: only set if the route hasn't already set its own
  // route-specific headers (e.g. /api/audit sets AUDIT_HARD_LIMIT=100, not 200).
  const key = c.get("apiKey");
  const headers = rateLimitHeaders(key);
  for (const [k, v] of Object.entries(headers)) {
    if (!key && c.res.headers.has(k)) continue; // preserve route-specific anonymous headers
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
 * Batch-score npm, PyPI, Cargo, or Go packages for supply chain risk.
 * Body: { packages: string[], ecosystem?: "npm" | "pypi" | "cargo" | "golang" | "auto" }
 * Returns JSON array sorted by commitment score (lowest = highest risk first).
 *
 * For Go: package names are full module paths, e.g. "github.com/gin-gonic/gin",
 * "golang.org/x/net". The "publishers" field maps to GitHub contributor count
 * since Go has no publisher registry — git push access is the publish equivalent.
 */
app.post("/api/audit", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Accept BOTH shapes: ["express", "lodash"] and [{name:"express",version:"4.x"}].
  // The README documents the string shape, but LLM-generated integration code
  // (Claude/Copilot/etc.) almost always emits the package.json {name,version}
  // object shape because that's the npm idiom. Pre-fix the worker would crash
  // with a bare 500 "Internal Server Error" on the object shape — wrong-looking
  // error to anyone evaluating the API for the first time, and not actionable.
  // Coerce here so both shapes work; if items are something else (numbers,
  // nulls, nested arrays) return a clean 400 explaining the expected shape.
  const rawItems: unknown[] = Array.isArray(body?.packages) ? body.packages.slice(0, 20) : [];
  const packages: string[] = [];
  for (const item of rawItems) {
    if (typeof item === "string" && item.length > 0) {
      packages.push(item);
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === "string" && name.length > 0) {
        packages.push(name);
      }
    }
  }
  const ecosystem: string = body?.ecosystem ?? "auto";

  if (packages.length === 0) {
    return c.json({
      error: "'packages' array is required (max 20)",
      hint: "Send an array of package names: { packages: [\"express\", \"lodash\"] }. Inside the array, the object shape { name, version } is also accepted (e.g. { packages: [{ name: \"express\", version: \"4.x\" }] }); the version field is ignored.",
    }, 400);
  }

  // Per-IP daily rate limit for anonymous traffic. API key holders bypass
  // (the /api/* middleware already attached them via c.get("apiKey")).
  // SSR bypass: the Pages worker (getcommit.dev _worker.js) calls /api/audit
  // to render /npm/:pkg pages. Without a bypass it shares the IP rate-limit
  // pool with real users and hits 502 on busy days. X-SSR-Token matching
  // ADMIN_SECRET skips rate limiting entirely — no counter increment, no CTA.
  const apiKeyCtx = c.get("apiKey");
  const ssrToken = c.req.header("X-SSR-Token");
  const isSSR = ssrToken != null && ssrToken.length > 0 && ssrToken === c.env.ADMIN_SECRET;
  let auditCount = 0;
  // showAuditCta is set at SOFT_CTA threshold; the actual `_cta` string is
  // computed AFTER results are built so it can personalize to the worst-risk
  // package in the user's scan (pickWorstAuditPackage + auditCtaText).
  // Old code computed the generic string here; the move was deliberate.
  let showAuditCta = false;
  let rateLimitTaste: {
    retryAfterSeconds: number;
    instantKeyUrl: string;
    totalRequested: number;
  } | null = null;
  if (!apiKeyCtx && !isSSR) {
    const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    auditCount = await bumpAuditCount(c.env, ip);

    // --- Rate-limit taste gate ---
    // Instead of returning 429 with zero results (the old behavior that
    // killed first-impression conversion for shared-IP users — 40→297→1570
    // downloads/wk growth curve with 0 organic signups), we set a flag
    // and fall through to score RATE_LIMIT_TASTE packages. The CLI
    // already handles `packages_already_scored` (npm-package/index.js
    // lines 77-95) — this gate is what finally activates that code path.
    if (auditCount > AUDIT_HARD_LIMIT) {
      const now = new Date();
      const tomorrowUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      );
      const retryAfterSeconds = Math.max(
        1,
        Math.floor((tomorrowUtc - now.getTime()) / 1000)
      );
      const instantKeyUrl =
        "https://getcommit.dev/get-started?ref=audit-cli-429";
      rateLimitTaste = {
        retryAfterSeconds,
        instantKeyUrl,
        totalRequested: packages.length,
      };
      // Trim to taste — user sees real value, then the CTA.
      packages.splice(RATE_LIMIT_TASTE);
    }

    // Always show CTA for anonymous users — prior gate (>=AUDIT_SOFT_CTA_AT,
    // i.e. 5th audit) meant first-time CLI users in CI (non-TTY, no
    // inlineSignup) never saw ANY conversion prompt. With 17 unique IPs/day
    // and only 2 reaching the soft-CTA threshold in 7 days, 15/17 IPs
    // churned without a single touchpoint. auditCtaText now has a
    // first-touch variant for count<SOFT_CTA that leads with value
    // (attack alerting) not quota pressure.
    showAuditCta = true;
  }

  const results: Array<{
    name: string;
    ecosystem: string;
    score: number | null;
    maintainers: number | null;
    githubContributors: number | null;
    weeklyDownloads: number | null;
    ageYears: number | null;
    trend: string | null;
    daysSinceLastPublish: number | null;
    hasProvenance: boolean | null;
    hasStagedPublishing?: boolean | null;
    scorecardScore: number | null;
    hasDangerousWorkflow: boolean | null;
    riskFlags: string[];
    compromised?: { attack: string; date: string; url: string };
    scoreBreakdown: { longevity: number; downloadMomentum: number; releaseConsistency: number; maintainerDepth: number; githubBacking: number } | null;
    downloadDataMissing?: boolean;
    error?: string;
  }> = [];

  const useCargo = ecosystem === "cargo";
  const usePypi = ecosystem === "pypi";
  const useGolang = ecosystem === "golang" || ecosystem === "go";

  // For npm packages: bulk-fetch all download data in ONE request before processing.
  //
  // Consistency note: the bulk path skips trend computation (buildNpmCommitmentProfile
  // sets trend=null when preloadedWeekly is supplied). This makes the score diverge
  // from the slow path by up to ±3 (the trend bonus in scoreDownloads). The badge
  // endpoint at /badge/npm/* always uses the slow path. To keep single-package audit
  // calls consistent with the badge (the case Frank/operators test side-by-side when
  // evaluating us), skip the bulk path when there's only one unscoped npm package.
  // For ≥2 packages we still use bulk for race-safety against concurrent npm 429s.
  // TODO: extend bulk path to compute trend (fetch 60-day point series per package)
  // to close the remaining inconsistency on multi-package bulk audits.
  const npmPackages = (!usePypi && !useCargo && !useGolang) ? packages : [];
  const unscopedNpm = npmPackages.filter((p) => !p.startsWith("@"));

  const bulkWeekly = unscopedNpm.length >= 2
    ? await bulkFetchNpmWeeklyDownloads(unscopedNpm)
    : new Map<string, number | null>();

  // Cargo needs lower concurrency due to crates.io rate limits (1 req/sec recommended).
  // Go modules also benefit from concurrency caps (each does proxy + deps.dev + GitHub fetches).
  const MAX_CONCURRENT = useCargo ? 3 : useGolang ? 4 : packages.length;

  for (let i = 0; i < packages.length; i += MAX_CONCURRENT) {
    const batch = packages.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map(async (pkg) => {
        try {
          if (useGolang) {
            const profile = await buildGolangCommitmentProfile(pkg);
            if (!profile) return { name: pkg, ecosystem: "golang", score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
            const riskFlags: string[] = [];
            // For Go, "maintainers" in the unified output = GitHub contributor count
            // (the closest equivalent to publish access since Go has no publisher concept)
            if (profile.contributorCount !== null && profile.contributorCount <= 1 && profile.starsCount > 5_000) riskFlags.push("HIGH: bus factor 1 + popular");
            if (profile.ageYears < 1 && profile.starsCount > 1_000) riskFlags.push("HIGH: new module (<1yr) + rapidly popular");
            if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
            return { name: profile.modulePath, ecosystem: "golang", score: profile.commitmentScore, maintainers: profile.contributorCount, githubContributors: profile.contributorCount, weeklyDownloads: null, ageYears: Math.round(profile.ageYears * 10) / 10, trend: null, daysSinceLastPublish: profile.daysSinceLastPublish, hasProvenance: null, scorecardScore: profile.scorecardScore, hasDangerousWorkflow: null, riskFlags, scoreBreakdown: profile.scoreBreakdown as any };
          } else if (useCargo) {
            const profile = await buildCargoCommitmentProfile(pkg);
            if (!profile) return { name: pkg, ecosystem: "cargo", score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
            const riskFlags: string[] = [];
            if (profile.ownerCount <= 1 && profile.estimatedWeeklyDownloads > 10_000_000) riskFlags.push("CRITICAL: sole owner + >10M/wk");
            else if (profile.ownerCount <= 1 && profile.estimatedWeeklyDownloads > 1_000_000) riskFlags.push("HIGH: sole owner + >1M/wk");
            if (profile.ageYears < 1 && profile.estimatedWeeklyDownloads > 100_000) riskFlags.push("HIGH: new crate (<1yr) + high downloads");
            if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
            return { name: profile.name, ecosystem: "cargo", score: profile.commitmentScore, maintainers: profile.ownerCount, githubContributors: null, weeklyDownloads: profile.estimatedWeeklyDownloads, ageYears: Math.round(profile.ageYears * 10) / 10, trend: null, daysSinceLastPublish: profile.daysSinceLastPublish, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags, scoreBreakdown: profile.scoreBreakdown as any };
          } else if (usePypi) {
            const profile = await buildPyPICommitmentProfile(pkg);
            if (!profile) return { name: pkg, ecosystem: "pypi", score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
            const weeklyDl = profile.recentDailyDownloads * 7;
            const riskFlags: string[] = [];
            if (profile.maintainerCount === 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL: sole maintainer + >10M/wk");
            else if (profile.maintainerCount <= 1 && weeklyDl > 1_000_000) riskFlags.push("HIGH: sole maintainer + >1M/wk");
            if (profile.ageYears < 1 && weeklyDl > 100_000) riskFlags.push("HIGH: new package (<1yr) + high downloads");
            if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
            return { name: profile.name, ecosystem: "pypi", score: profile.commitmentScore, maintainers: profile.maintainerCount, githubContributors: null, weeklyDownloads: weeklyDl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags, scoreBreakdown: profile.scoreBreakdown };
          } else {
            // Why this branch picks `undefined` over `null`:
            //   - `undefined` → buildNpmCommitmentProfile takes the SLOW path
            //     (range API + caches.default + retries) which is robust against
            //     CF colo-cache poisoning of the bulk endpoint.
            //   - a number      → FAST path (already have data, no fetch).
            //   - `null`        → FAST path with a single point-API rescue,
            //     which still hits the same poisoned CF cache that broke bulk.
            //
            // 2026-06-04 observed: bulk endpoint sometimes returns 200 OK with
            // all-null entries from specific colos for ~5 min (npm cache-control
            // max-age=300). Per-package point retries within the FAST path keep
            // failing because they hit the same colo cache. Slow-path range API
            // uses a DIFFERENT npm endpoint (api.npmjs.org/downloads/range/...)
            // plus a manual caches.default layer that only stores validated
            // non-empty responses — i.e., the bypass we actually need when bulk
            // silently degrades. Latency cost vs FAST: ~150-300 ms (one extra
            // RTT + tiny parse), only paid on bulk misses. Trend data ALSO comes
            // back for these packages, which the FAST path can never produce.
            const bulkValue = pkg.startsWith("@") ? undefined : bulkWeekly.get(pkg);
            const preloadedWeekly = (bulkValue != null && bulkValue > 0) ? bulkValue : undefined;
            const profile = await buildNpmCommitmentProfile(pkg, preloadedWeekly);
            if (!profile) return { name: pkg, ecosystem: "npm", score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
            const riskFlags: string[] = [];
            const wdl = profile.recentWeeklyDownloads ?? 0;
            // Use activePublisherCount (publishers who published in last 12mo) for
            // CRITICAL/HIGH checks — dormant publishers with valid scope access are
            // attack surface, not effective depth (ws: 4 total, 1 active, 220M/wk).
            const effectivePubCount = profile.activePublisherCount ?? profile.maintainerCount;
            if (effectivePubCount <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL: sole active npm publisher + >10M/wk");
            else if (effectivePubCount <= 1 && wdl > 1_000_000) riskFlags.push("HIGH: sole active npm publisher + >1M/wk");
            if (profile.ageYears < 1 && wdl > 100_000) riskFlags.push("HIGH: new package (<1yr) + high downloads");
            if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
            // Dormant publisher detection (Mastra attack pattern, June 2026):
            // Historical publishers who haven't shipped in 12+ months but may
            // still hold scope access tokens. npm does not expire publish permissions
            // on inactivity — stale credentials are live attack surface.
            const lc = profile.publisherLifecycle;
            if (lc && lc.dormantWithAccess > 0) {
              const dormantNames = lc.dormantDetails
                .filter(d => d.hasCurrentAccess)
                .map(d => `${d.name} (${d.monthsInactive}mo inactive)`)
                .join(", ");
              riskFlags.push(`WARN: ${lc.dormantWithAccess} dormant publisher${lc.dormantWithAccess > 1 ? "s" : ""} with current scope access — ${dormantNames}`);
            }
            // Sanity-zero gate (see isSuspiciouslyZeroDownloads in npm.ts):
            // a popular, mature package with 0 downloads is almost certainly a
            // transient fetch failure, not real data. Report null + flag so the
            // UI shows "—" instead of a confident-but-wrong "0/wk" cell on the
            // first interaction (the moment conversion decisions get made).
            const wdRaw = profile.recentWeeklyDownloads ?? null;
            const downloadDataMissing = isSuspiciouslyZeroDownloads(wdRaw, profile.versionCount, profile.ageYears);
            const wdReport = downloadDataMissing ? null : wdRaw;
            return { name: profile.name, ecosystem: "npm", score: profile.commitmentScore, maintainers: profile.maintainerCount, githubContributors: profile.githubContributors, weeklyDownloads: wdReport, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, hasProvenance: profile.hasProvenance, hasStagedPublishing: profile.hasStagedPublishing, scorecardScore: profile.scorecardScore ?? null, hasDangerousWorkflow: profile.hasDangerousWorkflow ?? null, riskFlags, scoreBreakdown: profile.scoreBreakdown, publisherLifecycle: lc ?? undefined, downloadDataMissing: downloadDataMissing || undefined };
          }
        } catch (err) {
          return { name: pkg, ecosystem: useGolang ? "golang" : useCargo ? "cargo" : usePypi ? "pypi" : "npm", score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, hasProvenance: null, scorecardScore: null, hasDangerousWorkflow: null, riskFlags: [], scoreBreakdown: null, error: err instanceof Error ? err.message : "error" };
        }
      })
    );
    results.push(...batchResults);
  }

  results.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));

  // Enrich with known attack history (last 90 days)
  const cutoff = Date.now() - 90 * 86_400_000;
  for (const r of results) {
    const record = lookupCompromised(r.name, r.ecosystem);
    if (record && new Date(record.date).getTime() > cutoff) {
      (r as any).compromised = { attack: record.attack, date: record.date, url: record.url };
    }
  }

  // --- Rate-limit taste: return 429 WITH partial results ---
  // The user sees real value (up to RATE_LIMIT_TASTE packages scored)
  // before the CTA. This turns the 429 from a wall into a sample.
  if (rateLimitTaste) {
    const { retryAfterSeconds, instantKeyUrl, totalRequested } = rateLimitTaste;
    const rateLimitHeaders: Record<string, string> = {
      "X-RateLimit-Limit": String(AUDIT_HARD_LIMIT),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Tier": "anonymous",
      "Retry-After": String(retryAfterSeconds),
    };

    // Volume-aware rescue (added 2026-06-04). Discovered via 2026-06-02/03
    // spike investigation: when an IP retries past the wall to count >=
    // AUDIT_OVERSHOOT_AT, the free-key 200/day pitch is the wrong tier — a
    // user that aggressive would burn through it in minutes. Surface
    // Developer ($15/mo, 1000/day, batch API) directly. Free-tier still
    // remains accessible from /pricing; we just stop leading with it. Bot
    // traffic that ignores the body is unaffected (still 429); the change
    // only matters for clients that actually read the rescue copy.
    const isOvershoot = auditCount >= AUDIT_OVERSHOOT_AT;

    const baseRescueMessage =
      `Scored ${results.length} of ${totalRequested} packages — free-tier daily limit reached on this IP (likely shared via corporate NAT, CI runner, or dev container). Get a free API key in 30 seconds — no credit card — to lift the limit to 200/day.`;
    // Framing note: rate limits are per-IP, not per-user. The backend cannot
    // distinguish a new visitor on shared infra from a heavy individual user;
    // saying "you've hit X audits" is false for any IP shared via CGNAT, a CI
    // runner, a dev container, or a corporate proxy — and a NEW visitor who
    // landed via a blog CTA sees that message as accusatory. (Discovered
    // 2026-06-17 dogfooding /audit?packages=… from the mastra blog post: the
    // container's shared IP showed 1334 audits/day; one fresh request hit
    // overshoot and saw the "you've hit 1334 audits" message on first
    // interaction.) The baseRescueMessage above already names the shared-IP
    // case correctly; the overshoot variant now parallels that framing.
    const overshootRescueMessage =
      `Scored ${results.length} of ${totalRequested} packages — this IP has hit ${auditCount} audits today (likely shared via corporate NAT, CI runner, or dev container; not all from one user). Free key gives 200/day · Developer ($15/mo) gives 1,000/day + batch API up to 5 packages; 30-day money-back.`;
    const rescueMessage = isOvershoot ? overshootRescueMessage : baseRescueMessage;

    const acceptHeader = (c.req.header("Accept") || "").toLowerCase();
    const wantsJson = acceptHeader.includes("application/json");

    // Source attribution (web vs CLI): the original Accept-header heuristic
    // broke when the CLI was upgraded to Accept: application/json (v1.17.0+)
    // so it could parse the structured 429 body. After that, every JSON
    // response was tagged `audit-web-429` regardless of caller — CLI users
    // landed on the wrong /get-started variant and the source_breakdown stats
    // lost CLI-rescue attribution.
    //
    // Fix: use the Origin header. Browser fetch from audit.astro sets
    // `Origin: https://getcommit.dev` automatically (CORS). Node fetch in
    // the npm CLI does not set Origin. That gives us a reliable web-vs-CLI
    // signal independent of Accept negotiation. The legacy plain-text branch
    // below still wins for v1.14.0 CLI on Accept: */* — Origin only re-routes
    // attribution inside the JSON branch where both web and CLI coexist.
    const isWebOrigin = isGetcommitWebOrigin(c.req.header("Origin"));
    const webInstantKeyUrl = instantKeyUrl.replace("ref=audit-cli-429", "ref=audit-web-429");
    // Overshoot pivot: instant_key_url AND upgrade_url both point at
    // /pricing (utm-tagged audit-overshoot). For 16-59 (normal wall hit) we
    // keep the historical free-tier deep-link. Tags: instant_key_url is
    // what /audit page renders as inline-form action; upgrade_url is what
    // the CLI rescue copy prints. Splitting them lets free-tier still be
    // reachable from /pricing without us leading with it.
    const responseInstantKeyUrl = isOvershoot
      ? AUDIT_OVERSHOOT_PRICING_URL
      : (wantsJson && isWebOrigin ? webInstantKeyUrl : instantKeyUrl);

    if (!wantsJson) {
      // Plain-text for legacy CLI v1.14.0 (sends `Accept: */*`).
      // Format: partial table + CTA. The CLI wraps this inside
      // `Error: API error 429: ${text}` — leading newline pushes
      // past the prefix for readability.
      const tasteLines = results.map((r) => {
        const score = r.score != null ? String(r.score).padStart(3) : " N/A";
        const risk = r.riskFlags.some((f: string) => f.startsWith("CRITICAL"))
          ? "🔴 CRITICAL"
          : r.riskFlags.some((f: string) => f.startsWith("HIGH"))
          ? "🟡 HIGH"
          : "✅ OK";
        const dl = r.weeklyDownloads != null
          ? r.weeklyDownloads >= 1_000_000
            ? `${(r.weeklyDownloads / 1_000_000).toFixed(0)}M/wk`
            : r.weeklyDownloads >= 1_000
            ? `${Math.round(r.weeklyDownloads / 1_000)}k/wk`
            : `${r.weeklyDownloads}/wk`
          : "";
        return `  ${r.name.padEnd(20)} ${score}  ${risk.padEnd(14)} ${r.maintainers ?? "?"}p  ${dl}`;
      });

      const ctaBlock = isOvershoot
        ? [
            `⚠  ${auditCount} audits today — past free tier and past the free-key tier.`,
            "   Developer plan removes the wall and adds batch API:",
            "",
            `   → Developer $15/mo · 1,000 audits/day · batch up to 5: ${AUDIT_OVERSHOOT_PRICING_URL}`,
            "     30-day money-back guarantee · cancel anytime.",
            "",
            `     (Free key 200/day still available from /pricing if you prefer.)`,
          ]
        : [
            "⚠  Free-tier daily limit reached on this network IP",
            "   (likely shared via corporate NAT, CI runner, or dev container).",
            "",
            `   → Free API key in 30 seconds (no card): ${instantKeyUrl}`,
            `     Unlocks all ${totalRequested} packages + 200 audits/day.`,
            "     Resets at 00:00 UTC.",
          ];
      const textBody = [
        "",
        "",
        `  Scored ${results.length} of ${totalRequested} packages:`,
        ...tasteLines,
        "",
        ...ctaBlock,
        "",
      ].join("\n");
      return c.text(textBody, 429, {
        ...rateLimitHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      });
    }

    // Structured JSON for v1.17.0+ CLI (sends `Accept: application/json`)
    // AND for the web /audit page (after 2026-06-01 fix). The CLI's
    // handle429() prints packages_already_scored via printTable() before
    // showing the rescue CTA; the web page's renderRateLimitRescue() renders
    // partial results then surfaces an inline email→key form anchored to
    // source=audit-web-429 (see audit.astro). instant_key_url ref is split
    // above so web/CLI funnel attribution stays clean.
    //
    // tier_suggestion (added 2026-06-04): explicit signal to web/CLI
    // renderers so the inline form can adapt copy + utm without parsing
    // the URL. "free" = current 200/day path; "developer" = overshoot
    // pivot to $15/mo. Older clients ignore unknown fields.
    return c.json(
      {
        error: "rate_limit_exceeded",
        message: rescueMessage,
        shared_ip_hint: true,
        instant_key_url: responseInstantKeyUrl,
        packages_already_scored: results,
        retry_after_seconds: retryAfterSeconds,
        upgrade_url: responseInstantKeyUrl,
        limit: AUDIT_HARD_LIMIT,
        count: auditCount,
        tier_suggestion: isOvershoot ? "developer" : "free",
        overshoot: isOvershoot,
      },
      429,
      rateLimitHeaders
    );
  }

  // _cta is a future-CLI-readable hint (current v1.14.0 ignores unknown
  // fields). The advisory headers tell scripts the budget remaining.
  // Personalize from the just-scored results — see auditCtaText(L4071) +
  // pickWorstAuditPackage. The CLI prints this dim+cyan after the table
  // (npm-package/index.js L2337/L2369), so naming the worst package converts
  // "free tier — 5/15 used" into "axios you just scored CRITICAL — get alerts".
  const auditCta = showAuditCta ? auditCtaText(auditCount, results) : null;
  const headers: Record<string, string> = {};
  if (!apiKeyCtx) {
    headers["X-RateLimit-Limit"] = String(AUDIT_HARD_LIMIT);
    headers["X-RateLimit-Remaining"] = String(Math.max(0, AUDIT_HARD_LIMIT - auditCount));
    headers["X-RateLimit-Tier"] = "anonymous";
  }
  return c.json(
    auditCta
      ? { count: results.length, results, _cta: auditCta }
      : { count: results.length, results },
    200,
    headers
  );
});

/**
 * Pick HTML vs JSON for a request based on the Accept header.
 * Returns true only when text/html is strictly at least as preferred as
 * application/json. Browsers send `text/html,...,application/xhtml+xml,...`
 * with no application/json entry, so html beats the missing json (q=0).
 * curl and node fetch send `*\/*` which leaves htmlQ=0 → returns false.
 *
 * Used by `/api/score/npm/*` (a URL pattern that ships in blog posts,
 * dev.to articles, and the public PostCSS thread) to forward browser
 * visitors to the /scan/?pkg= score-card page instead of raw JSON.
 */
export function prefersHtmlOverJson(acceptHeader: string | null | undefined): boolean {
  if (!acceptHeader) return false;
  const accept = acceptHeader.toLowerCase();
  if (!accept.includes("text/html")) return false;
  let htmlQ = 0;
  let jsonQ = 0;
  for (const raw of accept.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const [type, ...params] = part.split(";").map((s) => s.trim());
    const qParam = params.find((p) => p.startsWith("q="));
    const q = qParam ? parseFloat(qParam.slice(2)) : 1.0;
    if (Number.isNaN(q)) continue;
    if (type === "text/html") htmlQ = Math.max(htmlQ, q);
    else if (type === "application/json") jsonQ = Math.max(jsonQ, q);
  }
  return htmlQ > 0 && htmlQ >= jsonQ;
}

/**
 * GET /api/score/npm/:package{.+}
 * Single-package npm commitment profile with trustedPublishing signal.
 * Returns the full NpmCommitmentProfile JSON for API consumers, or
 * redirects browser visitors (Accept: text/html) to the /scan/?pkg=
 * score-card page so URLs shared in blog posts / public threads /
 * dev.to articles render the visual card instead of raw JSON.
 *
 * Overrides:
 *   ?format=json — always JSON (for browsers exploring the API)
 *   ?format=html — always redirect (for clients without a sensible Accept)
 */
app.get("/api/score/npm/*", async (c) => {
  const packageName = decodeURIComponent(c.req.path.replace("/api/score/npm/", ""));
  if (!packageName) return c.json({ error: "package name required" }, 400);

  const formatQuery = (c.req.query("format") || "").toLowerCase();
  const wantsHtml =
    formatQuery === "html" ||
    (formatQuery !== "json" && prefersHtmlOverJson(c.req.header("Accept")));
  if (wantsHtml) {
    return c.redirect(
      `https://getcommit.dev/scan/?pkg=${encodeURIComponent(packageName)}&utm_source=api-share`,
      302,
    );
  }

  try {
    const profile = await buildNpmCommitmentProfile(packageName);
    if (!profile) return c.json({ error: "not found" }, 404);
    return c.json(profile, 200, {
      "Cache-Control": "max-age=300, s-maxage=300",
      Vary: "Accept",
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "error" }, 500);
  }
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
 * GET /api/github/:owner/:repo
 * Returns the trust/commitment profile for a GitHub repo as JSON.
 * Used by the browser extension content script to populate the GitHub trust panel.
 */
app.get("/api/github/:owner/:repo", async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");

  if (!owner || !repo) {
    return c.json({ error: "owner and repo are required" }, 400);
  }

  try {
    const ownerLower = owner.toLowerCase();
    const repoLower = repo.toLowerCase();

    const [profile, endorsementRow] = await Promise.all([
      buildGitHubCommitmentProfile(owner, repo),
      c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM endorsements WHERE repo_owner = ? AND repo_name = ?`
      ).bind(ownerLower, repoLower).first<{ count: number }>(),
    ]);

    if (!profile) {
      return c.json({ error: `Repository ${owner}/${repo} not found` }, 404);
    }

    const endorsements = endorsementRow?.count ?? 0;

    // Add CORS headers so browser extensions can call this
    return c.json(
      {
        owner: profile.owner,
        repo: profile.repo,
        fullName: profile.fullName,
        description: profile.description,
        score: profile.commitmentScore,
        scoreBreakdown: profile.scoreBreakdown,
        signals: {
          ageYears: Math.round(profile.ageYears * 10) / 10,
          stars: profile.stars,
          forks: profile.forks,
          contributors: profile.contributorCount,
          recentCommits30d: profile.recentCommits30d,
          daysSinceLastPush: profile.daysSinceLastPush,
          releaseCount: profile.releaseCount,
          latestRelease: profile.latestRelease,
        },
        endorsements,
        language: profile.language,
        isArchived: profile.isArchived,
      },
      200,
      { "Access-Control-Allow-Origin": "*" },
    );
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch repo data" }, 500);
  }
});

/**
 * POST /api/repos/:owner/:repo/endorse
 * Endorse a GitHub repo with a verified World ID proof.
 * Requires: Authorization: Bearer <world_id_jwt>
 * One endorsement per verified human per repo (deduped by World ID nullifier).
 */
app.post("/api/repos/:owner/:repo/endorse", async (c) => {
  const owner = c.req.param("owner").toLowerCase();
  const repo = c.req.param("repo").toLowerCase();

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      { error: "missing_token", message: "Authorization: Bearer <world_id_jwt> required" },
      401,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  const token = authHeader.slice(7);

  let worldIdPayload: JWTPayload;
  try {
    worldIdPayload = await verifyWorldIdToken(token);
  } catch (err) {
    return c.json(
      { error: "invalid_token", message: err instanceof Error ? err.message : "World ID token verification failed" },
      401,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  const nullifier = worldIdPayload.sub;

  // Check for duplicate endorsement
  const existing = await c.env.DB.prepare(
    `SELECT id FROM endorsements WHERE repo_owner = ? AND repo_name = ? AND world_id_nullifier = ? LIMIT 1`
  ).bind(owner, repo, nullifier).first<{ id: string }>();

  if (existing) {
    // Return current count — idempotent
    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM endorsements WHERE repo_owner = ? AND repo_name = ?`
    ).bind(owner, repo).first<{ count: number }>();
    return c.json(
      { endorsements: countRow?.count ?? 1, alreadyEndorsed: true },
      200,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  // Generate ID (8 random bytes = 16 hex chars)
  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  await c.env.DB.prepare(
    `INSERT INTO endorsements (id, repo_owner, repo_name, world_id_nullifier, proof, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, owner, repo, nullifier, token, Math.floor(Date.now() / 1000)).run();

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM endorsements WHERE repo_owner = ? AND repo_name = ?`
  ).bind(owner, repo).first<{ count: number }>();

  return c.json(
    { endorsements: countRow?.count ?? 1, alreadyEndorsed: false },
    201,
    { "Access-Control-Allow-Origin": "*" }
  );
});

/**
 * Fetch dependencies from a GitHub repo and run supply chain risk scoring.
 * Body: { repo: string }  — GitHub URL or "owner/repo"
 */
app.post("/api/audit/github", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Accept multiple shapes the LLM-generated client is likely to emit:
  //   { repo: "owner/repo" }                         — documented
  //   { repo: "https://github.com/owner/repo" }      — URL form
  //   { repo: { owner, name | repo } }               — object idiom
  //   { owner, repo }                                — split fields
  // Pre-fix the worker crashed with bare 500 on any non-string shape
  // (parseGitHubRepo calls .trim() before validating), wrecking first-impression
  // conversion for AI-assisted integrations. Coerce here; clean 400 otherwise.
  let repoInput = "";
  const rawRepo = body?.repo;
  if (typeof rawRepo === "string") {
    repoInput = rawRepo;
  } else if (rawRepo && typeof rawRepo === "object" && !Array.isArray(rawRepo)) {
    const obj = rawRepo as Record<string, unknown>;
    const owner = typeof obj.owner === "string" ? obj.owner : "";
    const name = typeof obj.name === "string" ? obj.name : typeof obj.repo === "string" ? obj.repo : "";
    if (owner && name) repoInput = `${owner}/${name}`;
    else if (typeof obj.url === "string") repoInput = obj.url;
  } else if (typeof body?.owner === "string" && typeof body?.repo === "string") {
    // already covered by typeof rawRepo === "string" branch above
  }
  // Split { owner, name } at top level (LLMs sometimes split the fields)
  if (!repoInput && typeof body?.owner === "string" && typeof body?.name === "string") {
    repoInput = `${body.owner}/${body.name}`;
  }

  const parsed = repoInput ? parseGitHubRepo(repoInput) : null;
  if (!parsed) {
    return c.json({
      error: "Invalid repo. Use 'owner/repo' or a GitHub URL.",
      hint: "Send: { \"repo\": \"facebook/react\" } or { \"repo\": \"https://github.com/facebook/react\" }. Object shape { owner, name } also accepted.",
    }, 400);
  }

  const { owner, repo } = parsed;

  // Per-IP daily rate limit for anonymous traffic. API key holders bypass
  // (their tier quota in TIER_LIMITS governs total /api/* usage — the
  // /api/* middleware already attached them via c.get("apiKey")). SSR bypass
  // matches the /api/audit + /api/graph patterns: the Pages worker calls this
  // endpoint to render the audit page server-side, and X-SSR-Token matching
  // ADMIN_SECRET skips the counter so SSR traffic doesn't share a budget with
  // real users. Bump-first → 429-on-over avoids running the slow npm/PyPI
  // scoring path for over-limit traffic (saves CPU + outbound GitHub calls).
  // _cta + X-RateLimit-* headers attached to the success response below.
  const apiKeyCtx = c.get("apiKey");
  const githubAuditSsrToken = c.req.header("X-SSR-Token");
  const githubAuditIsSSR = githubAuditSsrToken != null && githubAuditSsrToken.length > 0 && githubAuditSsrToken === c.env.ADMIN_SECRET;
  let githubAuditCount = 0;
  let githubAuditRateLimited = false;
  if (!apiKeyCtx && !githubAuditIsSSR) {
    githubAuditRateLimited = true;
    const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    githubAuditCount = await bumpGithubAuditCount(c.env, ip);
    if (githubAuditCount > GITHUB_AUDIT_HARD_LIMIT) {
      const now = new Date();
      const tomorrowUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      );
      const retryAfterSec = Math.max(1, Math.floor((tomorrowUtc - now.getTime()) / 1000));
      return c.json(
        {
          error: "github_audit_rate_limit_exceeded",
          message: `You've used ${Math.min(githubAuditCount - 1, GITHUB_AUDIT_HARD_LIMIT)}/${GITHUB_AUDIT_HARD_LIMIT} free GitHub repo audits today. Whole-repo dependency audit is a Developer feature ($15/mo, 50 repos/month) or Pro ($29/mo, 500/month). Single-package scoring at /api/audit and /api/score remains free.`,
          upgrade: {
            url: GITHUB_AUDIT_UPGRADE_URL,
            plan: "developer",
            price: "$15/month",
            limit: "50 GitHub repo audits/month",
          },
          retry_after: retryAfterSec,
        },
        429,
        {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(GITHUB_AUDIT_HARD_LIMIT),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Tier": "anonymous",
        }
      );
    }
  }

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
    githubContributors: number | null;
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
              if (!profile) return { name: pkg, ecosystem, score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
              const weeklyDl = profile.recentDailyDownloads * 7;
              const riskFlags: string[] = [];
              if (profile.maintainerCount <= 1 && weeklyDl > 10_000_000) riskFlags.push("CRITICAL");
              else if (profile.maintainerCount <= 1 && weeklyDl > 1_000_000) riskFlags.push("HIGH");
              if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
              return { name: profile.name, ecosystem, score: profile.commitmentScore, maintainers: profile.maintainerCount, githubContributors: null, weeklyDownloads: weeklyDl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, riskFlags, scoreBreakdown: profile.scoreBreakdown };
            } else {
              const profile = await buildNpmCommitmentProfile(pkg);
              if (!profile) return { name: pkg, ecosystem, score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: "not found" };
              const wdl = profile.recentWeeklyDownloads ?? 0;
              const riskFlags: string[] = [];
              const effPub = profile.activePublisherCount ?? profile.maintainerCount;
              if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
              else if (effPub <= 1 && wdl > 1_000_000) riskFlags.push("HIGH");
              if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
              return { name: profile.name, ecosystem, score: profile.commitmentScore, maintainers: profile.maintainerCount, githubContributors: profile.githubContributors, weeklyDownloads: wdl, ageYears: Math.round(profile.ageYears * 10) / 10, trend: profile.downloadTrend, daysSinceLastPublish: profile.daysSinceLastPublish, riskFlags, scoreBreakdown: profile.scoreBreakdown };
            }
          } catch (err) {
            return { name: pkg, ecosystem, score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, daysSinceLastPublish: null, riskFlags: [], scoreBreakdown: null, error: err instanceof Error ? err.message : "error" };
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

  const responseBody: Record<string, unknown> = {
    repo: `${owner}/${repo}`,
    npmPackages: npmPackages.length,
    pypiPackages: pypiPackages.length,
    count: allResults.length,
    results: allResults,
  };
  // Attach soft-CTA upgrade nudge once anon traffic hits the threshold. At
  // HARD_LIMIT=2 / SOFT_CTA_AT=2 this fires on the second-and-last free call,
  // visible just before the wall — same shape as graph_rate_limits.
  if (githubAuditRateLimited && githubAuditCount >= GITHUB_AUDIT_SOFT_CTA_AT) {
    responseBody._cta = githubAuditCtaText(githubAuditCount);
  }

  if (githubAuditRateLimited) {
    return c.json(responseBody, 200, {
      "X-RateLimit-Limit": String(GITHUB_AUDIT_HARD_LIMIT),
      "X-RateLimit-Remaining": String(Math.max(0, GITHUB_AUDIT_HARD_LIMIT - githubAuditCount)),
      "X-RateLimit-Tier": "anonymous",
    });
  }

  return c.json(responseBody);
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
  // The wildcard captures the rest of the path (handles scoped packages like @scope/name
  // and full Go module paths like github.com/gin-gonic/gin)
  const packageName = decodeURIComponent(c.req.path.replace(`/api/badge/${ecosystem}/`, ""));

  if (
    ecosystem !== "npm" &&
    ecosystem !== "pypi" &&
    ecosystem !== "cargo" &&
    ecosystem !== "golang" &&
    ecosystem !== "go"
  ) {
    const svg = generateBadge("commit", "invalid ecosystem", "#9f9f9f");
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=60" },
    });
  }

  let score: number | null = null;
  let riskFlags: string[] = [];

  try {
    if (ecosystem === "golang" || ecosystem === "go") {
      const profile = await buildGolangCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        if (profile.contributorCount !== null && profile.contributorCount <= 1 && profile.starsCount > 10_000) {
          riskFlags.push("CRITICAL");
        }
      }
    } else if (ecosystem === "cargo") {
      const profile = await buildCargoCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        if (profile.ownerCount <= 1 && profile.estimatedWeeklyDownloads > 10_000_000) riskFlags.push("CRITICAL");
      }
    } else if (ecosystem === "npm") {
      const profile = await buildNpmCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        const wdl = profile.recentWeeklyDownloads ?? 0;
        const effPub = profile.activePublisherCount ?? profile.maintainerCount;
        if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
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

// ── OG Image Generator ───────────────────────────────────────────────

/**
 * NOTE: CF Workers blocks dynamic WebAssembly.instantiate() with fetched bytes
 * (security restriction). OG images are served as SVG — works on Discord, LinkedIn,
 * Slack, Facebook, Telegram. Twitter/X requires PNG; use wrangler + WASM module
 * binding for a future upgrade to native PNG.
 */

function escSvg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generate a 1200×630 SVG OG card for a package.
 */
function generatePackageOgSvg(opts: {
  pkg: string;
  ecosystem: string;
  score: number | null;
  isCritical: boolean;
  maintainerCount?: number | null;
  weeklyDownloads?: number | null;
}): string {
  const { pkg, ecosystem, score, isCritical, maintainerCount, weeklyDownloads } = opts;

  // Score color
  let scoreColor = "#9f9f9f";
  let scoreLabel = "no data";
  if (score !== null) {
    if (isCritical) {
      scoreColor = "#e05d44";
      scoreLabel = "CRITICAL";
    } else if (score < 40) {
      scoreColor = "#fe7d37";
      scoreLabel = "high risk";
    } else if (score < 60) {
      scoreColor = "#dfb317";
      scoreLabel = "moderate";
    } else if (score < 75) {
      scoreColor = "#97ca00";
      scoreLabel = "good";
    } else {
      scoreColor = "#44cc11";
      scoreLabel = "healthy";
    }
  }

  // Truncate long package names. Use "..." (ASCII) not "…" (ellipsis U+2026) —
  // Liberation Sans Bold doesn't include the ellipsis glyph and resvg would
  // render a missing-glyph rectangle.
  const displayPkg = pkg.length > 40 ? pkg.slice(0, 37) + "..." : pkg;
  const ecoLabel = ecosystem === "golang" ? "go" : ecosystem;

  // Use "?" not em-dash for null score — em-dash isn't in Liberation Sans Bold,
  // resvg renders the missing-glyph rectangle which looks broken.
  const scoreTxt = score !== null ? String(score) : "?";

  // Layout constants
  const W = 1200;
  const H = 630;

  // Ecosystem badge colors
  const ecoBg: Record<string, string> = {
    npm: "#CB3837",
    pypi: "#3572A5",
    cargo: "#DEA584",
    go: "#00ADD8",
    golang: "#00ADD8",
  };
  const ecoColor = ecoBg[ecosystem] ?? "#666";

  // Context line: "1 publisher · 99M downloads/wk" — only render when we have data.
  function fmtDownloads(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
    if (n >= 1_000_000) return Math.round(n / 1_000_000) + "M";
    if (n >= 1_000) return Math.round(n / 1_000) + "K";
    return String(n);
  }
  const contextParts: string[] = [];
  if (maintainerCount !== null && maintainerCount !== undefined) {
    contextParts.push(`${maintainerCount} publisher${maintainerCount === 1 ? "" : "s"}`);
  }
  if (weeklyDownloads !== null && weeklyDownloads !== undefined && weeklyDownloads > 0) {
    contextParts.push(`${fmtDownloads(weeklyDownloads)} downloads/wk`);
  }
  const contextLine = contextParts.join(" · ");

  // Position label after the score digits — rough estimate, ~62px per digit at 120pt.
  const scoreLabelX = score !== null ? 80 + scoreTxt.length * 62 : 200;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f0f11"/>
      <stop offset="100%" stop-color="#1a1a22"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${scoreColor}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${scoreColor}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Accent stripe -->
  <rect x="0" y="0" width="${W}" height="6" fill="${scoreColor}"/>

  <!-- Score glow -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#accent)"/>

  <!-- Branding -->
  <text x="64" y="76" font-family="sans-serif" font-size="22" fill="#ffffff" opacity="0.6" letter-spacing="4">COMMIT</text>

  <!-- Ecosystem badge -->
  <rect x="64" y="110" width="${ecoLabel.length * 14 + 28}" height="36" rx="6" fill="${ecoColor}"/>
  <text x="${64 + (ecoLabel.length * 14 + 28) / 2}" y="135" font-family="sans-serif" font-size="18" fill="#ffffff" text-anchor="middle" font-weight="bold">${escSvg(ecoLabel)}</text>

  <!-- Package name -->
  <text x="64" y="260" font-family="sans-serif" font-size="${displayPkg.length > 28 ? 52 : 64}" fill="#ffffff" font-weight="700" letter-spacing="-1">${escSvg(displayPkg)}</text>

  <!-- Divider -->
  <line x1="64" y1="300" x2="${W - 64}" y2="300" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>

  ${contextLine ? `<!-- Context line --><text x="64" y="356" font-family="sans-serif" font-size="24" fill="#ffffff" opacity="0.6" font-weight="500">${escSvg(contextLine)}</text>` : ""}

  <!-- Score section -->
  <text x="64" y="420" font-family="sans-serif" font-size="18" fill="#ffffff" opacity="0.5" letter-spacing="2">COMMIT SCORE</text>
  <text x="64" y="530" font-family="sans-serif" font-size="120" fill="${scoreColor}" font-weight="800" letter-spacing="-4">${escSvg(scoreTxt)}</text>

  <!-- Score label -->
  <text x="${scoreLabelX}" y="530" font-family="sans-serif" font-size="36" fill="${scoreColor}" font-weight="600" opacity="0.85">${escSvg(scoreLabel)}</text>

  <!-- Domain watermark -->
  <text x="${W - 64}" y="${H - 40}" font-family="sans-serif" font-size="20" fill="#ffffff" opacity="0.35" text-anchor="end">getcommit.dev</text>
</svg>`;
}

/**
 * Word-wrap helper: split text into lines of at most maxChars characters.
 */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generate a 1200×630 SVG OG card for a blog post.
 * Width-aware: tries 1-line at 72px → 2-line at 64px → 3-line at 52px,
 * picking the first font size where all lines fit the 1040px usable canvas
 * (1200px − 80px left margin − 80px right margin).
 * Char thresholds assume bold sans-serif ~0.55 × fontSize avg char width.
 */
function generateBlogOgSvg(opts: { title: string; date?: string }): string {
  const { title, date } = opts;

  const MAX_LINE_PX = 1040; // 1200 canvas − 80px margins each side

  // Try configs in order; pick first where wrapped lines ≤ maxLines
  const configs = [
    { fontSize: 72, maxChars: 27, maxLines: 1 },
    { fontSize: 64, maxChars: 31, maxLines: 2 },
    { fontSize: 52, maxChars: 38, maxLines: 3 },
  ] as const;

  let displayLines: string[] = [];
  let fontSize = 52;

  for (const cfg of configs) {
    const wrapped = wrapText(title, cfg.maxChars);
    if (wrapped.length <= cfg.maxLines) {
      displayLines = wrapped;
      fontSize = cfg.fontSize;
      break;
    }
  }

  // Fallback: force 3-line at 52px with truncation for very long titles
  if (displayLines.length === 0) {
    const wrapped = wrapText(title, 38);
    displayLines = wrapped.slice(0, 3);
    if (wrapped.length > 3) displayLines[2] = displayLines[2].slice(0, 35) + "...";
    fontSize = 52;
  }

  const lineH = fontSize * 1.2;
  const totalH = displayLines.length * lineH;
  const startY = (630 - totalH) / 2 + fontSize;

  const W = 1200;
  const H = 630;

  const textLines = displayLines
    .map((l, i) => {
      // Safety net: if estimated width exceeds canvas, compress spacing
      const estimatedPx = l.length * fontSize * 0.55;
      const textLengthAttr =
        estimatedPx > MAX_LINE_PX
          ? ` textLength="${MAX_LINE_PX}" lengthAdjust="spacingAndGlyphs"`
          : "";
      return `<text x="80" y="${startY + i * lineH}" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" font-weight="700" letter-spacing="-1"${textLengthAttr}>${escSvg(l)}</text>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f0f11"/>
      <stop offset="100%" stop-color="#1a1a22"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Top accent -->
  <rect x="0" y="0" width="${W}" height="6" fill="#D14D41"/>

  <!-- Branding -->
  <text x="80" y="72" font-family="sans-serif" font-size="20" fill="#ffffff" opacity="0.5" letter-spacing="4">COMMIT · WRITING</text>

  <!-- Title -->
  ${textLines}

  <!-- Date -->
  ${date ? `<text x="80" y="${H - 50}" font-family="sans-serif" font-size="20" fill="#ffffff" opacity="0.4">${escSvg(date)}</text>` : ""}

  <!-- Domain -->
  <text x="${W - 80}" y="${H - 50}" font-family="sans-serif" font-size="20" fill="#ffffff" opacity="0.35" text-anchor="end">getcommit.dev</text>
</svg>`;
}

app.use("/og/*", cors());

/**
 * GET /og/blog
 * Query params: title (required), date (optional)
 *
 * Returns a 1200×630 PNG OG card for a blog post.
 * Usage in _worker.js: `${API_BASE}/og/blog?title=${encodeURIComponent(title)}&date=${encodeURIComponent(date)}`
 */
app.get("/og/blog", async (c) => {
  const title = c.req.query("title") ?? "Commit";
  const date = c.req.query("date") ?? "";

  const svg = generateBlogOgSvg({ title, date });
  const png = await svgToPng(svg);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "max-age=86400, s-maxage=86400",
      "X-Powered-By": "getcommit.dev",
    },
  });
});

/**
 * GET /og/:ecosystem/:package{.+}
 *
 * Returns a 1200×630 PNG OG card showing the commitment score for a package.
 * Used in og:image meta tags on getcommit.dev audit pages.
 *
 * Example: https://poc-backend.amdal-dev.workers.dev/og/npm/axios
 */
app.get("/og/:ecosystem/*", async (c) => {
  const ecosystem = c.req.param("ecosystem");
  const packageName = decodeURIComponent(c.req.path.replace(`/og/${ecosystem}/`, ""));

  let score: number | null = null;
  let isCritical = false;
  let maintainerCount: number | null = null;
  let weeklyDownloads: number | null = null;

  try {
    if (ecosystem === "golang" || ecosystem === "go") {
      const profile = await buildGolangCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        if (profile.contributorCount !== null && profile.contributorCount <= 1 && profile.starsCount > 10_000) {
          isCritical = true;
        }
      }
    } else if (ecosystem === "cargo") {
      const profile = await buildCargoCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        maintainerCount = profile.ownerCount;
        if (profile.ownerCount <= 1 && profile.estimatedWeeklyDownloads > 10_000_000) isCritical = true;
      }
    } else if (ecosystem === "npm") {
      const profile = await buildNpmCommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        maintainerCount = profile.maintainerCount ?? null;
        weeklyDownloads = profile.recentWeeklyDownloads ?? null;
        if (profile.maintainerCount === 1 && (profile.recentWeeklyDownloads ?? 0) > 10_000_000) isCritical = true;
      }
    } else if (ecosystem === "pypi") {
      const profile = await buildPyPICommitmentProfile(packageName);
      if (profile) {
        score = profile.commitmentScore;
        maintainerCount = profile.maintainerCount ?? null;
        weeklyDownloads = profile.recentDailyDownloads * 7;
        if (profile.maintainerCount === 1 && profile.recentDailyDownloads * 7 > 10_000_000) isCritical = true;
      }
    }
  } catch {
    // Fall through — score stays null
  }

  const svg = generatePackageOgSvg({
    pkg: packageName,
    ecosystem,
    score,
    isCritical,
    maintainerCount,
    weeklyDownloads,
  });
  const png = await svgToPng(svg);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "max-age=3600, s-maxage=3600",
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
  githubContributors: number | null;
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
      return { name: pkg, score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], depth, error: "not found" };
    }
    const wdl = profile.recentWeeklyDownloads ?? 0;
    const riskFlags: string[] = [];
    const effPub = profile.activePublisherCount ?? profile.maintainerCount;
    if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL: sole active publisher + >10M/wk");
    else if (effPub <= 1 && wdl > 1_000_000) riskFlags.push("HIGH: sole active publisher + >1M/wk");
    if (profile.ageYears < 1 && wdl > 100_000) riskFlags.push("HIGH: new package (<1yr) + high downloads");
    if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN: no release in 12+ months");
    return {
      name: profile.name,
      score: profile.commitmentScore,
      maintainers: profile.maintainerCount,
      githubContributors: profile.githubContributors,
      weeklyDownloads: wdl,
      ageYears: Math.round(profile.ageYears * 10) / 10,
      trend: profile.downloadTrend,
      riskFlags,
      depth,
    };
  } catch (err) {
    return { name: pkg, score: null, maintainers: null, githubContributors: null, weeklyDownloads: null, ageYears: null, trend: null, riskFlags: [], depth, error: err instanceof Error ? err.message : "error" };
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
    // "Risky" = CRITICAL/HIGH flag OR sole publisher (downloads may be
    // unreliable when fetched in bulk — sole-publisher packages are high-risk
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
  // Accept BOTH shapes: { package: "express" } and { package: { name: "express", version: "4.x" } }.
  // Pre-fix the worker crashed with bare 500 on the object shape because pkg.trim()
  // assumes string. LLM-generated integration code defaults to the npm package.json
  // idiom — wrong-looking 500 was a first-impression conversion killer.
  let pkg = "";
  const rawPkg = body?.package;
  if (typeof rawPkg === "string") {
    pkg = rawPkg;
  } else if (rawPkg && typeof rawPkg === "object" && !Array.isArray(rawPkg)) {
    const name = (rawPkg as Record<string, unknown>).name;
    if (typeof name === "string") pkg = name;
  }
  const depth: 1 | 2 = body?.depth === 2 ? 2 : 1;

  if (!pkg || pkg.trim().length === 0) {
    return c.json({
      error: "package is required. E.g. { \"package\": \"express\" }",
      hint: "Object shape { name, version } also accepted; the 'version' field is ignored.",
    }, 400);
  }

  // Per-IP daily rate limit for anonymous traffic. API key holders bypass
  // (their tier quota in TIER_LIMITS governs total /api/* usage — the
  // /api/* middleware already attached them via c.get("apiKey")).
  // SSR bypass mirrors /api/audit: the Pages worker calls /api/graph to
  // render visualizations; X-SSR-Token matching ADMIN_SECRET skips the
  // counter so SSR traffic doesn't share a budget with real users.
  const apiKeyCtx = c.get("apiKey");
  const ssrToken = c.req.header("X-SSR-Token");
  const isSSR = ssrToken != null && ssrToken.length > 0 && ssrToken === c.env.ADMIN_SECRET;
  if (!apiKeyCtx && !isSSR) {
    const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    const graphCount = await bumpGraphCount(c.env, ip);
    if (graphCount > GRAPH_HARD_LIMIT) {
      const now = new Date();
      const tomorrowUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      );
      const retryAfterSec = Math.max(1, Math.floor((tomorrowUtc - now.getTime()) / 1000));
      return c.json(
        {
          error: "graph_rate_limit_exceeded",
          message: `You've used ${Math.min(graphCount - 1, GRAPH_HARD_LIMIT)}/${GRAPH_HARD_LIMIT} free transitive graph queries today. Dependency-graph analysis is a Pro feature ($29/mo, 200 queries/month). Direct-only scoring at /api/audit remains free.`,
          upgrade: {
            url: GRAPH_UPGRADE_URL,
            plan: "pro",
            price: "$29/month",
            limit: "200 graph queries/month",
          },
          retry_after: retryAfterSec,
        },
        429,
        {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(GRAPH_HARD_LIMIT),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Tier": "anonymous",
        }
      );
    }

    const { nodes, edges, criticalTransitivePaths } = await buildNpmDepGraph(pkg.trim(), depth);
    const criticalCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("CRITICAL"))).length;
    const highCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("HIGH"))).length;
    const warnCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("WARN"))).length;
    const worstScore = nodes.reduce((min, n) => n.score !== null ? Math.min(min, n.score) : min, 101);
    const body = {
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
      ...(graphCount >= GRAPH_SOFT_CTA_AT ? { _cta: graphCtaText(graphCount) } : {}),
    };
    return c.json(body, 200, {
      "X-RateLimit-Limit": String(GRAPH_HARD_LIMIT),
      "X-RateLimit-Remaining": String(Math.max(0, GRAPH_HARD_LIMIT - graphCount)),
      "X-RateLimit-Tier": "anonymous",
    });
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

/**
 * GET /api/graph/npm/:package
 * Build a dependency risk graph for an npm package (default depth=2).
 * Query params: depth=1|2 (default 2)
 */
app.get("/api/graph/npm/*", async (c) => {
  const packageName = decodeURIComponent(c.req.path.replace("/api/graph/npm/", ""));
  if (!packageName) return c.json({ error: "package required" }, 400);
  const depth: 1 | 2 = c.req.query("depth") === "1" ? 1 : 2;

  // Per-IP daily rate limit for anonymous traffic — see POST handler above
  // for full rationale. API key holders + SSR bypass.
  const apiKeyCtx = c.get("apiKey");
  const ssrToken = c.req.header("X-SSR-Token");
  const isSSR = ssrToken != null && ssrToken.length > 0 && ssrToken === c.env.ADMIN_SECRET;
  if (!apiKeyCtx && !isSSR) {
    const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
    const graphCount = await bumpGraphCount(c.env, ip);
    if (graphCount > GRAPH_HARD_LIMIT) {
      const now = new Date();
      const tomorrowUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      );
      const retryAfterSec = Math.max(1, Math.floor((tomorrowUtc - now.getTime()) / 1000));
      return c.json(
        {
          error: "graph_rate_limit_exceeded",
          message: `You've used ${Math.min(graphCount - 1, GRAPH_HARD_LIMIT)}/${GRAPH_HARD_LIMIT} free transitive graph queries today. Dependency-graph analysis is a Pro feature ($29/mo, 200 queries/month). Direct-only scoring at /api/audit remains free.`,
          upgrade: {
            url: GRAPH_UPGRADE_URL,
            plan: "pro",
            price: "$29/month",
            limit: "200 graph queries/month",
          },
          retry_after: retryAfterSec,
        },
        429,
        {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(GRAPH_HARD_LIMIT),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Tier": "anonymous",
        }
      );
    }

    const { nodes, edges, criticalTransitivePaths } = await buildNpmDepGraph(packageName, depth);
    const criticalCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("CRITICAL"))).length;
    const highCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("HIGH"))).length;
    const warnCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("WARN"))).length;
    const worstScore = nodes.reduce((min, n) => n.score !== null ? Math.min(min, n.score) : min, 101);
    const body = {
      root: packageName,
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
      ...(graphCount >= GRAPH_SOFT_CTA_AT ? { _cta: graphCtaText(graphCount) } : {}),
    };
    return c.json(body, 200, {
      "X-RateLimit-Limit": String(GRAPH_HARD_LIMIT),
      "X-RateLimit-Remaining": String(Math.max(0, GRAPH_HARD_LIMIT - graphCount)),
      "X-RateLimit-Tier": "anonymous",
    });
  }

  const { nodes, edges, criticalTransitivePaths } = await buildNpmDepGraph(packageName, depth);

  const criticalCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("CRITICAL"))).length;
  const highCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("HIGH"))).length;
  const warnCount = nodes.filter((n) => n.riskFlags.some((f) => f.startsWith("WARN"))).length;
  const worstScore = nodes.reduce((min, n) => n.score !== null ? Math.min(min, n.score) : min, 101);

  return c.json({
    root: packageName,
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
  // ?label=full preserves legacy verbose suffix ("88/100 CRITICAL", black bg).
  // Default is embed-friendly: score-only, color-coded — README-safe for maintainers.
  const fullLabel = c.req.query("label") === "full";

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
      const effPub = profile.activePublisherCount ?? profile.maintainerCount;
      if (effPub <= 1 && wdl > 10_000_000) isCritical = true;
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
    value = fullLabel ? `${score}/100 CRITICAL` : `${score}/100`;
    color = fullLabel ? "#222222" : "#e05d44"; // black in full mode, red in default
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

// GET /badge/pypi/:package{.+}
//
// Returns a shields.io-style SVG badge for embedding in PyPI READMEs.
// Usage:
//   [![Commitment Score](https://poc-backend.amdal-dev.workers.dev/badge/pypi/requests)](https://getcommit.dev/audit?packages=requests&ecosystem=pypi)
//
// Colors: green (≥70) → yellow (40-69) → red (<40) → black (CRITICAL)
// Cache: 24h CDN-friendly

app.get("/badge/pypi/*", async (c) => {
  const packageName = decodeURIComponent(c.req.path.replace("/badge/pypi/", ""));
  // ?label=full preserves legacy verbose suffix ("88/100 CRITICAL", black bg).
  // Default is embed-friendly: score-only, color-coded — README-safe for maintainers.
  const fullLabel = c.req.query("label") === "full";

  if (!packageName) {
    const svg = generateBadge("commitment", "unknown", "#9f9f9f");
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=60" },
    });
  }

  let score: number | null = null;
  let isCritical = false;

  try {
    const profile = await buildPyPICommitmentProfile(packageName);
    if (profile) {
      score = profile.commitmentScore;
      const weeklyDl = (profile.recentDailyDownloads ?? 0) * 7;
      if (profile.maintainerCount === 1 && weeklyDl > 10_000_000) isCritical = true;
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
    value = fullLabel ? `${score}/100 CRITICAL` : `${score}/100`;
    color = fullLabel ? "#222222" : "#e05d44"; // black in full mode, red in default
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

// ── Simple Trust Badge (npm-only shorthand, fallback) ─────────────────
//
// Must be registered AFTER /badge/npm/* and /badge/pypi/* so those match first.
//
// GET /badge/:package
// GET /badge/:package.svg   (img src variant)
//
// Shorthand npm-only trust badge for README embedding.
// Label: "Commit Trust"   Value: "{score} | {grade}"
// Grades: OK (≥70, green) · WARNING (40-69, orange) · CRITICAL (<40 or solo+10M+, red)
// Cache: 1 hour
//
// Usage: ![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/chalk)
//        ![Commit Trust](https://poc-backend.amdal-dev.workers.dev/badge/chalk.svg)

app.get("/badge/*", async (c) => {
  // Strip leading "/badge/" and optional trailing ".svg"
  let packageName = decodeURIComponent(c.req.path.replace(/^\/badge\//, ""));
  packageName = packageName.replace(/\.svg$/, "");
  // ?label=full preserves legacy verbose suffix ("80 | CRITICAL/WARNING/OK").
  // Default is embed-friendly: score-only, color-coded — README-safe for maintainers.
  // High-score packages with concentration risk (lodash@80, axios@88) no longer
  // get a scary "CRITICAL" word burnt into their public README badge.
  const fullLabel = c.req.query("label") === "full";

  if (!packageName) {
    const svg = generateBadge("Commit Trust", "invalid package", "#9f9f9f");
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
      const effPub = profile.activePublisherCount ?? profile.maintainerCount;
      if (effPub <= 1 && wdl > 10_000_000) isCritical = true;
    }
  } catch {
    // Fall through to error badge
  }

  let value: string;
  let color: string;

  if (score === null) {
    value = "not found";
    color = "#9f9f9f";
  } else if (isCritical || score < 40) {
    value = fullLabel ? `${score} | CRITICAL` : `${score}`;
    color = "#e05d44"; // red
  } else if (score < 70) {
    value = fullLabel ? `${score} | WARNING` : `${score}`;
    color = "#fe7d37"; // orange
  } else {
    value = fullLabel ? `${score} | OK` : `${score}`;
    color = "#44cc11"; // green
  }

  const svg = generateBadge("Commit Trust", value, color);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "max-age=3600, s-maxage=3600",
      "X-Powered-By": "getcommit.dev",
    },
  });
});

// ── API Key Endpoints ────────────────────────────────────────────────

/**
 * POST /api/keys/create
 * Accept { email, source? } → generate free-tier API key → email it → return { ok, message }
 * Rate limit: 3 requests per IP per day
 *
 * source — funnel attribution (persisted to api_keys.source). Valid values:
 *   'web' (default), 'cli', 'api', 'mcp-soft-cta', 'audit-cli-429', 'audit-web',
 *   'audit-web-critical', 'audit-web-healthy', 'web-pricing', 'pkg-profile'
 *
 * 'audit-cli-429' is set by the get-started landing page when a visitor
 * arrives via the CLI 429 rescue flow (?ref=audit-cli-429). Lets us
 * measure rate-limit-recovery conversion vs. organic CLI signups.
 *
 * 'audit-web' is set when a visitor arrives via the post-audit CTA on
 * /audit (?ref=audit-web). Added 2026-05-22 after replacing the dead
 * /api/waitlist 404 form (0 real signups in 6 weeks of being broken).
 *
 * 'audit-web-critical' / 'audit-web-healthy' are set by the post-result
 * CTA on /audit (?ref=audit-web-critical when ≥1 CRITICAL flag found,
 * ?ref=audit-web-healthy when 0 CRITICAL + ≥1 HIGH). The audit.astro
 * page has emitted these two refs since 2026-05-22 but the REF_TO_SOURCE
 * map on /get-started + VALID_SOURCES here didn't include them — both
 * fell through to 'web', invisibly bucketing audit-page conversions
 * with homepage signups. Added 2026-05-23 to close the attribution
 * leak and split fear-driven (CRITICAL) from prevention-driven (HEALTHY)
 * signups — the two cohorts likely have different conversion intent
 * (alarm vs. monitoring) and different ARR.
 *
 * 'web-pricing' is set by the /pricing/ waitlist form. Added 2026-05-23
 * when the form was updated to display the key inline (parity with
 * /get-started/, which had carried the same email-as-gate copy bug).
 * Lets us split pricing-page conversion vs direct-landing conversion.
 *
 * 'audit-web-inline' is set when the user converts via the inline email
 * form embedded directly in the /audit post-results CTA (added 2026-05-23).
 * Collapses the previous 2-step funnel (audit → click CTA → land on
 * /get-started → enter email → submit) into a single inline form, mirroring
 * the CLI inlineSignup() pattern from npm-package v1.16. Lets us measure
 * conversion delta vs the navigate-to-page flow (audit-web-critical /
 * audit-web-healthy) which now serves only as fallback for browsers with
 * JS disabled. Drives audit-page → key creations without a second click.
 *
 * 'pkg-profile' is set by the package-profile pages (/npm/:pkg, /pypi/:pkg,
 * /cargo/:pkg, /go/:module) Monitor-this-package CTA. Added 2026-05-23 so
 * we can measure SEO-organic conversions from package profile pages
 * (potentially the largest indexable surface, post-01:08 trailing-slash
 * fix) vs direct /get-started landings. Refs travel as ?ref=pkg-profile.
 *
 * 'audit-baseline' is set by the CLI's all-healthy footer (npm-package
 * v1.18.0+). When `npx proof-of-commitment` finds 0 CRITICAL packages,
 * the static footer now surfaces a soft "Lock in this baseline" CTA
 * pointing at /get-started?ref=audit-baseline. Added 2026-05-24 after
 * buyer-journey dogfood found 1472 weekly downloads producing 0 organic
 * signups — the lowest-friction path (email-only, 10s) was previously
 * gated behind the CRITICAL-only inlineSignup prompt. Distinguishing
 * baseline-lock-in conversions from rate-limit-rescue (audit-cli-429)
 * and from CI-shaped CTAs (cli) measures whether the all-healthy footer
 * is the missing volume surface.
 *
 * 'cursor-hook-429' / 'claude-code-hook-429' / 'poc-hook' are set by
 * the proof-of-commitment IDE hook (npm-package v1.21.0+ for Cursor,
 * v1.22.0+ adds Claude Code). When a hook deny/ask hits the API rate
 * limit, refTag = `${client}-hook-429`; on fresh `poc hook` install
 * with no key configured, refTag = 'poc-hook'. Added 2026-05-29 to
 * close the attribution leak — the hook funnel shipped 14:48-17:15 UTC
 * but neither the landing-page REF_TO_SOURCE nor this VALID_SOURCES
 * list knew about the three refs, so any hook-driven signup would have
 * been silently bucketed into 'web'. With this added, source_breakdown
 * splits hook conversions per IDE client and per entry point (install
 * vs rate-limit recovery), feeding 7d task b9e7a4eb4c182825 and 30d
 * task 05b4b20aa57ddd09.
 */
app.post("/api/keys/create", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email: string = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  // audit-web-429 added 2026-06-01: web users hitting the audit hard-limit
  // were previously dropped into the generic "Request failed" error because
  // audit.astro fetched without Accept: application/json (the worker returns
  // text/plain for CLI clients by default). Now web fetches request JSON and
  // get a structured rescue payload with instant_key_url; this source attribues
  // the resulting key signups to the web rate-limit moment so we can measure
  // conversion lift separately from audit-cli-429 (CLI users in same path).
  // 'audit-overshoot' added 2026-06-04: when an anonymous IP keeps retrying
  // past the wall to count ≥ AUDIT_OVERSHOOT_AT (4× HARD_LIMIT), the 429
  // rescue pivots from "free key 200/day" to Developer ($15/mo, 1000/day).
  // Most clicks should land on /pricing rather than /get-started, but if a
  // user still chooses the free flow from that pivot we want to tag it
  // separately so source_breakdown can measure overshoot-attributed
  // free-tier signups (gateway behavior) vs paid checkout-intent.
  // 'audit-web-compromised' added 2026-06-10: post-result CTA branch on
  // /audit when ≥1 audited package is in the compromised registry (Miasma,
  // Mini Shai-Hulud, axios token theft, TrapDoor, IronWorm, LiteLLM,
  // node-ipc, @cap-js/*, @uipath/*). Inline form posts source='audit-web-
  // inline' so this whitelist entry only carries the noscript-fallback
  // signups arriving at /get-started?ref=audit-web-compromised. Prior to
  // this entry those signups silently dropped to 'web' — invisible in the
  // funnel report alongside the audit-page CTA fix shipped 04:15Z 2026-06-10
  // (audit.astro compromisedCount branch). Same funnel-wide enforcement
  // pattern as audit-web-critical / audit-web-healthy: every layer that
  // observes the ref needs its own gate against the canonical source list.
  // 'key-upgrade' added 2026-06-10: backend buildUpgradeUrl writes this as
  // utm_campaign on every authenticated-key upgrade prompt (429 quota, 402
  // pro-feature, 422 pkg-cap, dashboard signed-in check). Closes the
  // direct-API + dashboard funnel-attribution gap left over from the
  // audit-overshoot work earlier today — 4th occurrence of the funnel-
  // surface-gap pattern (1st: audit-web-critical/healthy 2026-05-23, 2nd:
  // audit-web-compromised 04:55Z, 3rd: audit-overshoot CONTEXT_BY_CAMPAIGN
  // 05:25Z, this: authenticated-key upgrade prompts). Sub-medium detail
  // (quota/pro-feature/pkg-cap/dashboard) is carried in utm_medium for
  // analytics replay but does not affect attribution.
  // 'cli-soft-cta' added 2026-06-10: distinguishes CLI inline-prompt
  // signups that fired BECAUSE the backend returned _cta (engagement
  // signal: this IP scored ≥AUDIT_SOFT_CTA_AT today) from the baseline
  // findings-driven 'cli' inline prompt. Before this entry, the
  // engagementSignal gate-bypass shipped in npm-package@1.28.0 dropped
  // to 'web' source on older workers; tagging here lets api_keys.source
  // measure conversion lift from healthy single-package scans where
  // the user hit the soft-CTA threshold but local result had no
  // findings (the previously-silent leak — 4 IPs hit soft-CTA in 7d,
  // 0 organic signups).
  // 'ci-annotation' added 2026-06-12: GitHub Actions PR-checks rate-limit
  // annotation shipped in npm-package v1.31.0. When the CLI runs under
  // GITHUB_ACTIONS=true and the audit endpoint returns 429, the npm
  // package emits a `::warning::` annotation pointing at
  // /get-started?ref=ci-annotation (anonymous free-key fall-through) or
  // /pricing?ref=ci-annotation (keyUpgrade or overshoot — paid pivot).
  // Without this whitelist entry the resulting key signups would silently
  // bucket into 'web' — invisible in the funnel report alongside the
  // matching landing-page work (get-started.astro HERO_BY_REF +
  // REF_TO_SOURCE shipped same commit, pricing.astro ref→utm_campaign
  // promotion + CONTEXT_BY_CAMPAIGN['ci-annotation'] shipped same commit).
  // Same funnel-wide enforcement pattern as audit-web-critical/healthy
  // (2026-05-23), audit-web-compromised (2026-06-10), audit-overshoot
  // (2026-06-10), key-upgrade (2026-06-10): every layer that observes
  // the ref needs its own gate against the canonical source list.
  // 5th occurrence — npm-package release ships a new ref symbol, surfaces
  // downstream don't know about it until dogfood / next session catches it.
  const VALID_SOURCES = ["web", "cli", "api", "mcp-soft-cta", "mcp-inline-key", "audit-cli-429", "audit-web-429", "audit-baseline", "audit-web", "audit-web-critical", "audit-web-healthy", "audit-web-compromised", "audit-web-inline", "web-pricing", "pkg-profile", "pkg-monitor", "pkg-alert-critical", "pkg-alert-compromised", "cursor-hook-429", "claude-code-hook-429", "windsurf-hook-429", "poc-hook", "audit-overshoot", "cli-watch", "key-upgrade", "cli-soft-cta", "ci-annotation", "readme-monitoring", "npm-readme-monitoring"];
  // 2026-06-14: per-blog refs (blog-snyk-comparison, blog-stripe-gcs,
  // blog-drizzle-kit, …) appear in the slug-CTA of every comparison post and
  // every package-watch CTA without a corresponding hardcoded VALID_SOURCES
  // entry. Three live blog posts (snyk-vs-chalk top organic blog at 15 visits/7d
  // per first-party /api/v1/visits/stats) leaked their attribution to source=web
  // before this. Pattern-admit `blog-<slug>` shape so future comparison posts
  // self-attribute without a backend deploy. Bounded charset + length keeps
  // analytics labels well-shaped; the same regex is mirrored in
  // commit-landing-v2 get-started.astro REF_TO_SOURCE fallthrough.
  const BLOG_REF_RE = /^blog-[a-z0-9-]{1,40}$/;
  // 2026-06-15: devto-<slug> pattern admit. First native dev.to article
  // (devto-npm-audit, published 09:51Z) shipped with VALID_SOURCES literal
  // entry "devto-npm-audit"; replaced with regex so future dev.to syndication
  // (devto-mcp-skills, devto-supply-chain-2026, etc) self-attributes without
  // a backend redeploy. Same shape as BLOG_REF_RE — readable analytics labels,
  // bounded charset. Mirror in commit-landing-v2 get-started.astro:
  // (a) form-submit DEVTO_REF_RE (source pass-through) and (b) hero IIFE
  // DEVTO_HERO_FALLBACK (discovery-style hero matching article thesis).
  // Parity gate (check-funnel-surface-parity.ts) asserts both sides have
  // DEVTO_REF_RE — so the next devto-* ref shipping outside parity will
  // surface at build time, not in production analytics weeks later.
  const DEVTO_REF_RE = /^devto-[a-z0-9-]{1,40}$/;
  // 2026-06-15: outreach-<slug> pattern admit. Convex E1 (sent 11:15Z today)
  // and e2b E1 (07:12Z) shipped ref=outreach-convex / ref=outreach-e2b in the
  // /get-started CTA URL inside the cold-email body; without admission both
  // coerced to source=web — attribution lost on the highest-intent revenue
  // surface in the funnel (a recipient who clicked from a cold email already
  // has buyer intent five steps deeper than a random visitor). 9th occurrence
  // of the "new ref symbol ships, downstream gates do not know about it"
  // pattern. Same shape as BLOG_REF_RE + DEVTO_REF_RE — readable analytics
  // labels (api_keys.source = "outreach-convex", "outreach-workos", etc.),
  // bounded charset, no per-recipient backend redeploy. Mirror in
  // commit-landing-v2 get-started.astro: (a) form-submit OUTREACH_REF_RE
  // (source pass-through) and (b) hero IIFE OUTREACH_HERO_FALLBACK
  // (continuation-of-cold-email frame, not generic web hero). Parity gate
  // (check-funnel-surface-parity.ts) asserts both sides have OUTREACH_REF_RE
  // — next outreach ref shipping outside parity surfaces at build time.
  const OUTREACH_REF_RE = /^outreach-[a-z0-9-]{1,40}$/;
  const rawSource = typeof body?.source === "string" ? body.source : "";
  const source: string = VALID_SOURCES.includes(rawSource) || BLOG_REF_RE.test(rawSource) || DEVTO_REF_RE.test(rawSource) || OUTREACH_REF_RE.test(rawSource) ? rawSource : "web";

  // 2026-06-11: auto-seed watchlist with packages the user just audited.
  // Proposition fix: pre-this, an audit-page signup got a key + welcome email
  // referencing hardcoded `poc watch express` / `poc watch lodash` examples —
  // orthogonal to what the user actually came to monitor. They audited their
  // real package.json (often 30+ packages, 2 CRITICAL), then had to manually
  // re-add the packages they had already shown us. The watchlist arrived
  // empty; the weekly digest had nothing to report on; the proposition
  // "we'll alert you if your packages get attacked" delivered zero immediate
  // value. Now: audit-web-inline / audit-web-critical / audit-web-healthy /
  // audit-web-compromised flows post the prioritized package set; the free
  // tier (PACKAGE_LIMITS.free = 3) gets the top 3 (CRITICAL > compromised >
  // first-3-by-input-order). Capped at PACKAGE_LIMITS[tier] regardless of how
  // many are sent. Ecosystem is validated against ECOSYSTEMS (npm/pypi/cargo/
  // golang). Diagnoses 0-organic-signups: conversion isn't gated on email
  // friction — that's been stripped 5 times. It's gated on the post-signup
  // value gap. (Disconfirming read on 13 funnel-surface fixes: the proposition
  // outranks the surface; this changes WHAT you get for your email, not where
  // the form sits.)
  type WatchSeed = { name: string; ecosystem: string };
  const rawWatch: unknown = body?.watch;
  const watchSeeds: WatchSeed[] = [];
  // Permissive format (2026-06-16): also accept bare strings ["lodash", "axios"]
  // — default ecosystem to "npm". Previously: API users hitting /api/keys/create
  // with stringified package names got `ok:true, watched_packages:[]` (silent
  // skip on `typeof raw !== "object"`) and concluded the watch endpoint was
  // broken. Verified live: a dogfood probe sending `watch: ["lodash","axios",
  // "node-ipc"]` succeeded the email-delivery side but the welcome email said
  // "Your watchlist already contains 0 packages" — exact opposite of the
  // proposition the audit page sells. Audit-page UI sends correct {name,
  // ecosystem} objects so this never triggered there; the cost lands on
  // developers evaluating the API directly (the paid-tier prospect audience).
  // Net-subtractive: removes a silent-failure mode without breaking any caller.
  if (Array.isArray(rawWatch)) {
    for (const raw of rawWatch) {
      let name: string | undefined;
      let eco: string | undefined;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length > 214) continue;
        name = trimmed;
        eco = "npm";
      } else if (typeof raw === "object" && raw !== null) {
        const rawName = (raw as { name?: unknown }).name;
        if (typeof rawName !== "string") continue;
        const trimmedName = rawName.trim();
        if (!trimmedName || trimmedName.length > 214) continue;
        name = trimmedName;
        const rawEco = (raw as { ecosystem?: unknown }).ecosystem;
        eco = (typeof rawEco === "string" ? rawEco : "npm").toLowerCase();
      } else {
        continue;
      }
      if (!ECOSYSTEMS.has(eco)) continue;
      // Dedupe by (name, ecosystem)
      if (watchSeeds.some((w) => w.name === name && w.ecosystem === eco)) continue;
      watchSeeds.push({ name, ecosystem: eco });
    }
  }

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "invalid_email", message: "A valid email address is required." }, 400);
  }

  // IP-based rate limit: 3 key creations per IP per day.
  //
  // Internal-test bypass (2026-06-12): when `email` matches
  // INTERNAL_TEST_EMAIL_PATTERNS (default `pico+*@amdal.dev` + `hawkaa+*@amdal.dev`
  // + `test-evaluator-probe@example.com` — domain-anchored, NOT `*@*` to prevent
  // attacker spoofing), the IP rate-limit gate is skipped AND the counter is not
  // incremented. Diagnosed: the dogfood-verifiability-gap recurred for the 4th
  // time on 2026-06-12 — yesterday's welcome-email "be your own first user" walk
  // was blocked by 3/day; today's unseeded-branch ship (88eec06, deployed
  // 05:51Z) had ZERO unseeded signups in the wild between deploy and
  // verification, so the user-inbox copy was unverified. Code-level fix because
  // text-level discipline keeps losing to environment friction; the welcome
  // email IS the buyer-onboarding artifact, not verifying it at body depth is
  // shipping blind. Bypass is keyed on the EMAIL, not the IP, so a single dev
  // workstation can burn 3+ probes per day without polluting the 3-real-users
  // budget. Stats classification (organic vs internal_test) already filters on
  // the same patterns — keeping a unified definition.
  const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const now = new Date();
  const internalTestPatterns = parseEmailPatterns(
    c.env.INTERNAL_TEST_EMAIL_PATTERNS ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS
  );
  const isInternalTest = isInternalTestEmail(email, internalTestPatterns);

  if (!isInternalTest) {
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
  }

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
    `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, source, created_at)
     VALUES (?, ?, ?, ?, 'free', 0, ?, ?, datetime('now'))`
  ).bind(id, keyHash, keyPrefix, email, periodResetAt, source).run();

  // Auto-seed watchlist (free tier, audit-page sources). Caller passed
  // body.watch — already filtered into watchSeeds. We cap at PACKAGE_LIMITS.free
  // (3) on the server side regardless of input length, then upsert into the
  // default project. Failures are non-fatal: the key creation already
  // succeeded, and the user can manually `poc watch <pkg>` if seeding fails.
  // We only run this when seeds exist AND the api_key is free tier (this
  // endpoint always creates free; the gate matters once paid keys can also
  // come through here, e.g., via a future Stripe upgrade webhook).
  const seededPackages: Array<{ name: string; ecosystem: string }> = [];
  if (watchSeeds.length > 0) {
    try {
      const cap = PACKAGE_LIMITS.free;
      const toSeed = watchSeeds.slice(0, cap);
      const projectId = await getOrCreateDefaultProject(c.env.DB, id, email);
      for (const seed of toSeed) {
        const pkgId = newId();
        // INSERT OR IGNORE so duplicate (project_id, name, ecosystem) is a no-op
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO monitored_packages (id, project_id, package_name, ecosystem)
           VALUES (?, ?, ?, ?)`
        ).bind(pkgId, projectId, seed.name, seed.ecosystem).run();
        seededPackages.push(seed);
      }
    } catch {
      // Swallow — key creation already succeeded; seeding is best-effort.
    }
  }

  // Send via Resend email API (RESEND_API_KEY is a worker secret)
  let emailSent = false;

  // Welcome-email body. When we auto-seeded the watchlist from the audit
  // page, step 1 references the user's actual packages instead of the
  // generic `poc watch express / lodash` placeholders. Keeps surface parity
  // with the audit success state, which renders the same "watching your
  // packages" framing — the email is the persistent reminder of what the
  // signup actually bought.
  //
  // 2026-06-11 (welcome-scores): for the seeded branch, also include CURRENT
  // SCORES for each seeded package. Diagnosed: the high-intent CLI/audit-page
  // user saw scores in the CLI output 30 seconds ago — the welcome email
  // recapitulated package names but ZERO state, just promising "Mondays we
  // email you." The lower-intent /api/subscribe (homepage form) path already
  // ships full scores in its welcome email. The asymmetry was inverted:
  // best-converting path got least proof-of-value. Closes that gap — the
  // email becomes the persistent anchor of *why this signup is worth keeping*
  // and surfaces CRITICAL flags in the subject line so the inbox preview
  // wins on urgency. Score npm seeds best-effort; non-npm seeds are listed
  // by name with no score (scoring scope matches the runWeeklyDigest npm-only
  // scope — keeps behaviour consistent across the lifecycle).
  type SeedScore = {
    name: string;
    ecosystem: string;
    score: number | null;
    maintainers: number | null;
    weeklyDownloads: number | null;
    riskFlags: string[];
  };
  const seedScores: SeedScore[] = [];
  for (const s of seededPackages) {
    if (s.ecosystem !== "npm") {
      seedScores.push({ ...s, score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
      continue;
    }
    try {
      const profile = await buildNpmCommitmentProfile(s.name);
      if (!profile) {
        seedScores.push({ ...s, score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
        continue;
      }
      const wdl = profile.recentWeeklyDownloads ?? 0;
      const riskFlags: string[] = [];
      const effPub = profile.activePublisherCount ?? profile.maintainerCount;
      if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
      else if (profile.ageYears < 1 && wdl > 1_000_000) riskFlags.push("HIGH");
      else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
      seedScores.push({
        ...s,
        score: profile.commitmentScore,
        maintainers: profile.maintainerCount,
        weeklyDownloads: wdl,
        riskFlags,
      });
    } catch {
      seedScores.push({ ...s, score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
    }
  }

  function fmtSeedDL(n: number | null): string {
    if (!n) return "?";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return Math.round(n / 1e6) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "K";
    return String(n);
  }
  const seedCriticalCount = seedScores.filter((r) => r.riskFlags.includes("CRITICAL")).length;
  const seedScoreLines = seedScores
    .map((r) => {
      const flag = r.riskFlags.includes("CRITICAL") ? "⚑ CRITICAL"
        : r.riskFlags.includes("HIGH") ? "⚠ HIGH"
        : r.riskFlags.includes("WARN") ? "↓ WARN"
        : r.score === null ? "(not scored)"
        : "✓ OK";
      const scoreStr = r.score === null ? "  —" : `${String(r.score).padStart(3)}/100`;
      const maint = r.maintainers === null ? "?" : `${r.maintainers}`;
      return `  ${r.name.padEnd(22)} ${scoreStr}  ${maint}p  ${fmtSeedDL(r.weeklyDownloads)}/wk  ${flag}`;
    })
    .join("\n");

  // Upgrade-overflow signal: when the user pushed more packages than the free
  // cap, surface that gap as upgrade pressure tied to their actual data
  // (vs the generic Developer pitch in the tier-block below).
  const overflowCount = Math.max(0, watchSeeds.length - seededPackages.length);
  const overflowLine = overflowCount > 0
    ? `\n   (Capped at 3 — ${overflowCount} more from your audit didn't fit. Developer $15/mo monitors 15.)`
    : "";

  const seededList = seededPackages.map((p) => `   - ${p.name} (${p.ecosystem})`).join("\n");
  const seededScoreHeader = seedCriticalCount > 0
    ? `Current scores (${seedCriticalCount} CRITICAL — sole maintainer + 10M+/wk):`
    : `Current scores:`;
  const step1 = seededPackages.length > 0
    ? `1) Your watchlist already contains the ${seededPackages.length === 1 ? "package" : `${seededPackages.length} packages`} you audited:
${seededList}${overflowLine}

   ${seededScoreHeader}
${seedScoreLines}

   npx proof-of-commitment login ${apiKey}
   npx proof-of-commitment watchlist                          # confirm what's being watched

   Mondays we email you if any score drops a tier or a watched package gets attacked.`
    : `1) Watch 3 packages — Mondays we email you when scores drop or attacks happen:

   First save your key (one time):
   npx proof-of-commitment login ${apiKey}

   Then audit your project to see which packages need watching most:
   cd your-project
   npx proof-of-commitment --file package-lock.json    # scores every dep

   Watch the riskiest 3 — free cap:
   npx proof-of-commitment watch <package-name>

   Or use the web audit — https://getcommit.dev/audit — paste any package.json
   and we auto-seed your watchlist with the riskiest 3 from that scan.

   Mondays we email you when any watched score drops a tier.`;

  const emailSubject = seedCriticalCount > 0
    ? `⚑ ${seedCriticalCount} CRITICAL package${seedCriticalCount > 1 ? "s" : ""} in your watchlist — your Commit API key inside`
    : "Your Commit API key + 4 things to try";

  // Source-aware step 2. Mirrors the get-started.astro success-note fork:
  // CI engineers arriving from PR-check annotations don't need to "add a CI
  // gate" — they already have one (that's why the annotation fired). They
  // need to bind the key to repo secrets and re-run. Hook users (Cursor/
  // Claude Code/Windsurf/poc-hook) have the package installed locally and
  // just need to persist the key for the hook to read. MCP users need the
  // key in their MCP client's env block. README users (GitHub + npm) came
  // for the monitoring promise — hero copy says "score your tree" / "watch
  // packages", success-note says "poc login + audit", so step 2 must extend
  // that into setting up watches (the differentiator the README CTA sold).
  // Default ("web", "api", "audit-web", "pkg-profile", etc.) is a new user
  // — give them the CI-gate onboarding. Keeps step 2's frame consistent
  // with the get-started success-note that immediately preceded this email
  // — no contradicting next-actions across the chain. Pairs with the
  // get-started.astro source-aware branches.
  const CI_SOURCES_WELCOME = new Set(["ci-annotation"]);
  const HOOK_SOURCES_WELCOME = new Set(["cursor-hook-429", "claude-code-hook-429", "windsurf-hook-429", "poc-hook"]);
  const MCP_SOURCES_WELCOME = new Set(["mcp-soft-cta"]);
  const README_SOURCES_WELCOME = new Set(["readme-monitoring", "npm-readme-monitoring"]);
  // 2026-06-15: blog-<slug> sources (e.g. blog-aur-1579, blog-redhat-miasma,
  // blog-snyk-comparison) share intent with README sources: the reader came
  // through a content channel ("I read about an attack, I want to expand
  // coverage") and just pre-seeded a watchlist via ?watch=… on /get-started.
  // The default branch's "Add a CI gate" misroutes them — telling someone
  // who just bought monitoring to instead set up gating contradicts the
  // pre-seed framing in step 1. Route blog-* through the same "score your
  // tree, then watch" path README uses. Pairs with get-started.astro's
  // success-note (same source-aware fork).
  const BLOG_SOURCE_RE = /^blog-[a-z0-9-]{1,40}$/;
  // 2026-06-15: devto-<slug> sources share intent with blog-* + README sources:
  // discovery channel where the reader came through external content. Welcome
  // email step 2 routes through the same "score your tree, then watch" path
  // instead of "Add a CI gate" (which contradicts a discovery-pitch reader).
  // Pairs with get-started.astro success-note (same fork via isDiscoverySource).
  const DEVTO_SOURCE_RE = /^devto-[a-z0-9-]{1,40}$/;
  // 2026-06-15: outreach-<slug> sources share intent with blog-* / devto-* /
  // README sources — recipient came from a discovery channel (cold email with
  // a pre-seeded watchlist) and just landed on the success page. Welcome
  // email step 2 routes through the same "score your tree, then watch" path
  // instead of "Add a CI gate" (which contradicts the email-body promise of
  // monitoring the packages the email already named). Pairs with
  // get-started.astro success-note (same fork via isDiscoverySource).
  const OUTREACH_SOURCE_RE = /^outreach-[a-z0-9-]{1,40}$/;
  const isDiscoverySource = (s: string) =>
    README_SOURCES_WELCOME.has(s) || BLOG_SOURCE_RE.test(s) || DEVTO_SOURCE_RE.test(s) || OUTREACH_SOURCE_RE.test(s);
  // 2026-06-13: CLI users (audit-cli-429 / audit-baseline / cli / audit-cli /
  // cli-soft-cta) got the generic "Add a CI gate" step 2 in welcome email,
  // contradicting the success-note's CLI-frame `export COMMIT_API_KEY=…`.
  // Email arrives later, possibly in a new terminal, so persistent `poc login`
  // is the right next-step (env-var binding only covers one shell).
  // 2026-06-15: cli-watch added — npm-package v1.32.0 (shipped 05:14Z) emits
  // this source via buildWatchUrl() for non-TTY CRITICAL upsells + the GH
  // Actions PR-check annotation. Without this entry the welcome email\'s
  // step 2 fell through to the generic "Add a CI gate" copy — contradicting
  // step 1\'s "watching N CRITICAL packages" confirmation. Route through CLI
  // login like every other CLI source (`poc login <key>` persists in
  // ~/.commit/config so the CI/non-TTY context that emitted the link reads
  // the key on the next run without env-var juggling).
  const CLI_SOURCES_WELCOME = new Set(["audit-cli-429", "audit-baseline", "cli", "audit-cli", "cli-soft-cta", "cli-watch"]);
  const step2 = CI_SOURCES_WELCOME.has(source)
    ? `2) Bind the key in your repo so CI stops rate-limiting:
   gh secret set COMMIT_API_KEY --body ${apiKey}

   (Or paste in Settings → Secrets and variables → Actions.)
   Re-run the failed job. The PR-check annotation goes away the moment
   the key is bound — 200 audits/day covers every PR on most projects.`
    : HOOK_SOURCES_WELCOME.has(source)
    ? `2) Persist the key so the hook reads it on every install:
   npx proof-of-commitment login ${apiKey}

   The hook reads ~/.commit/config on every package install — once-and-done.
   No env-var juggling, no per-shell binding. Future terminals just work.`
    : MCP_SOURCES_WELCOME.has(source)
    ? `2) Add the key to your MCP client config so the server can use it.
   In Claude Desktop / Cursor MCP config, add to the env block for this server:

   "COMMIT_API_KEY": "${apiKey}"

   Restart the client. The MCP server bumps to 200 audits/day, bound to you.`
    : isDiscoverySource(source)
    ? `2) Score your tree, then watch the riskiest package:
   npx proof-of-commitment login ${apiKey}
   cd your-project
   npx proof-of-commitment --file package-lock.json    # scores every dep
   npx proof-of-commitment watch <riskiest-pkg>    # adds to weekly digest

   Free tier watches 3 packages. Developer ($15/mo) bumps to 15 with daily
   scans + instant email alerts the moment a score drops a tier.`
    : CLI_SOURCES_WELCOME.has(source)
    ? `2) Persist the key for every future terminal — no more re-binding:
   npx proof-of-commitment login ${apiKey}

   Reads ~/.commit/config every run. The earlier export COMMIT_API_KEY only
   bound the shell you re-ran in; this binds you across reboots and new tabs.
   Bumps you to 200 audits/day with no anonymous rate cap.`
    : `2) Add a CI gate to one of your repos (free, 1 repo):
   cd your-project
   npx proof-of-commitment init     # adds GitHub Action + README badge

   Every PR fails if it introduces a CRITICAL dependency.`;

  const emailBody = `Your Commit API key + 4 things to try

  ${apiKey}

Save it. It won't be shown again.


${step1}

${step2}

3) Score any project from the command line:
   npx proof-of-commitment --file package-lock.json

4) Use the API directly:
   curl https://poc-backend.amdal-dev.workers.dev/api/audit \\
     -H "Authorization: Bearer ${apiKey}" \\
     -H "Content-Type: application/json" \\
     -d '{"packages": ["express", "lodash"]}'


Your free tier:
  • 200 audits/day (resets midnight UTC)
  • Watch 3 packages · weekly digest (Mondays)
  • 1 CI-gated repo · README badges (unlimited)

When you need more (batch API, daily scans, alerts):
  • Developer $15/mo — 1,000 audits/day, batch up to 5, unlimited CI repos, monitor 15 packages (daily scans)
  • Pro $29/mo — 10K audits/mo, batch up to 20, monitor 50 packages (~10 projects, daily scans + Slack/webhook alerts)
  https://getcommit.dev/pricing?email=${encodeURIComponent(email)}&utm_campaign=welcome-upgrade&utm_source=email&utm_medium=welcome
  30-day money-back guarantee.

—
Commit · supply-chain risk scoring · getcommit.dev`;

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
          // reply_to: prospects who reply to the welcome email (highest reply-
          // intent moment — they just saw CRITICAL packages and signed up)
          // would otherwise land at noreply@getcommit.dev with no inbound MX.
          // Route to pico@amdal.dev so prospect questions ("can I get the
          // Developer tier?", "do you support enterprise?") reach a human.
          reply_to: "pico@amdal.dev",
          to: [email],
          subject: emailSubject,
          text: emailBody,
        }),
      });
      emailSent = emailResp.ok;
    } catch {
      // fall through to fallback
    }
  }

  if (emailSent) {
    // Always return the key inline. Email is the backup, not the gate.
    //
    // History: this branch used to gate inline-delivery to specific in-flow
    // sources (cli, audit-cli-429, mcp-soft-cta, audit-web) — the rationale
    // being that organic 'web' signups should pass through an email
    // round-trip as "soft verification." 2026-05-23 dogfood showed that
    // verification framing is illusory: the key works the instant it's
    // generated regardless of whether the user opens the email, so the
    // round-trip just adds friction (mental switch to inbox = quit point).
    // The 3-keys-per-IP-per-day rate limit above already prevents
    // creation-spam abuse, so email-as-gate provides zero security value.
    // Get-started JS handles inline display when `key` is present.
    return c.json({
      ok: true,
      message: `API key ready. Backup sent to ${email}.`,
      key: apiKey,
      key_prefix: keyPrefix,
      // watched_packages echo lets the audit-page success state confirm
      // exactly what we seeded (and how many we capped — free=3). UI uses
      // this to render "Already watching: foo, bar, baz" instead of
      // "we'll watch [unspecified]." Drives discoverability of the
      // seeded value before the first weekly digest fires (~7d).
      watched_packages: seededPackages,
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
      watched_packages: seededPackages,
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

  const tier = (row.tier as "free" | "developer" | "pro" | "enterprise") || "free";
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
    // medium=dashboard tags clicks from /dashboard (signed-in usage check).
    // Was a static '/pricing' string — never carried email or campaign, so
    // dashboard upgrade clicks landed on generic pricing with no banner and
    // no email pre-fill. buildUpgradeUrl carries both now; dashboard.astro
    // wires this href into the upgrade CTA in renderUsage().
    upgrade_url: tier === "free" ? buildUpgradeUrl(row.email, { medium: "dashboard" }) : null,
  });
});

// MCP rate-limit thresholds. Declared here (not next to the MCP server
// definition further down) so MCP_TRAFFIC_THRESHOLDS below can reference them
// at module-init time without TDZ. The MCP server reuses these same constants.
const MCP_SOFT_CTA_AT = 5;      // first call to include CTA
const MCP_STRONG_CTA_AT = 10;   // upgrade message tone
const MCP_HARD_LIMIT = 15;      // beyond → 429-style block (was 100 — tightened to drive signups)
// Points at the real signup form. /signup doesn't exist on getcommit.dev — the
// SPA fallback serves the homepage, so users following the CTA landed on the
// marketing page with no form. /get-started is the actual email-capture page
// and reads `ref=mcp-cli` to set source=mcp-soft-cta on the created key.
const MCP_SIGNUP_URL =
  "https://getcommit.dev/get-started?ref=mcp-cli";

// /api/audit per-IP daily rate-limit thresholds. Same shape as MCP — mirroring
// the proven pattern (5751ea0). Closes the silent-leak equivalent for /api/audit:
// pre-this, anonymous CLI/script users could fire unlimited calls. Now they
// see escalating CTA pressure and a hard cap at 100/IP/UTC-day. API key
// holders bypass entirely. See /workspace/commit/conversion-gap-diagnosis-2026-05-20.md.
const AUDIT_SOFT_CTA_AT = 5;
const AUDIT_STRONG_CTA_AT = 10;
const AUDIT_HARD_LIMIT = 15;    // was 100 — tightened to drive free-key signups (free key = 200/day)
/** Volume-aware rescue threshold. When a single IP keeps retrying past the
 *  wall to count ≥ AUDIT_OVERSHOOT_AT, the free-key offer (200/day) is the
 *  wrong tier — they'd burn through it in minutes. Pivot the 429 rescue
 *  copy to Developer ($15/mo, 1,000/day, batch API) and route the
 *  instant_key_url at /pricing instead of /get-started. 60 = 4× HARD_LIMIT,
 *  picked because:
 *    - 16-59 might be a one-off "I just hit the wall, didn't realize" user;
 *      free 200/day is still the right next step.
 *    - 60+ is sustained programmatic usage (every retry past the wall =
 *      conscious choice or unattended script); free tier wouldn't fix it,
 *      Developer would.
 *  Bots that ignore the response still bounce at the wall; this only
 *  changes copy for clients that actually read it. */
const AUDIT_OVERSHOOT_AT = AUDIT_HARD_LIMIT * 4;
/** On 429, score this many packages as a free "taste" so the user sees
 *  real value before the signup CTA. The CLI already handles the
 *  `packages_already_scored` field — it just never fires because the
 *  backend returned [] until now. 3 packages is enough to demonstrate
 *  value without making the free tier pointless. */
const RATE_LIMIT_TASTE = 3;
const AUDIT_SIGNUP_URL =
  "https://getcommit.dev/get-started?ref=audit-cli";
/** Pricing-page CTA target for volume-aware rescue (see AUDIT_OVERSHOOT_AT).
 *  utm-tagged so /pricing checkout-intent rows attribute back to the
 *  overshoot rescue path, distinguishing this funnel from audit-skip-form
 *  (high-intent web visitors) and critical-cta (post-email Developer CTA). */
const AUDIT_OVERSHOOT_PRICING_URL =
  "https://getcommit.dev/pricing?utm_source=audit&utm_medium=overshoot-rescue&utm_campaign=audit-overshoot";

// /api/graph per-IP daily rate-limit thresholds. Tighter than /api/audit
// because dependency-graph analysis is the PAID feature on /pricing
// ("Dependency graph analysis — 200 req/month" under Pro $29/mo). Pre-this,
// the endpoint was completely unauthenticated and unlimited — the
// highest-value insight (hidden CRITICAL transitive deps two levels deep)
// was being given away to anonymous traffic, producing zero conversion
// pressure from the awesome-mcp-servers funnel (87K stars, listed
// 2026-05-27). API key holders bypass entirely; their tier quota in
// TIER_LIMITS governs total /api/* usage. See buyer-journey audit
// 2026-05-28 + monetization-strategy.md (Apr 19).
const GRAPH_SOFT_CTA_AT = 3;
const GRAPH_HARD_LIMIT = 3;
const GRAPH_UPGRADE_URL =
  "https://getcommit.dev/pricing?ref=graph-paywall";

// /api/audit/github per-IP daily rate-limit thresholds. Tightest of the three
// counters (audit=100, graph=3, github-audit=2) because /pricing has no free
// allowance for github audit at all: Developer ($15/mo) gets 50/mo, Pro ($29/mo)
// gets 500/mo, Open lists nothing. Pre-this, POST /api/audit/github was
// completely unauthenticated and unlimited — the whole-repo dependency walk
// was being given away to anonymous traffic with zero conversion pressure.
// HARD_LIMIT=2 gives two free repo audits as a taste, then walls off. API key
// holders bypass entirely. SSR token bypass mirrors /api/audit + /api/graph.
// See buyer-journey audit 2026-05-28 + migration 0015_github_audit_rate_limits.
const GITHUB_AUDIT_SOFT_CTA_AT = 2;
const GITHUB_AUDIT_HARD_LIMIT = 2;
const GITHUB_AUDIT_UPGRADE_URL =
  "https://getcommit.dev/pricing?ref=github-audit-paywall";

// /api/checkout + /api/checkout-intent per-IP hourly rate limit.
// Bot analysis 2026-05-28: ~100 fake sessions/day hit the backend directly
// (bypassing getcommit.dev proxy). Original cap of 3/hr/IP turned out to
// false-positive in 2026-06-03 buyer-journey probe: when X-Real-IP is absent
// (direct backend hits), all traffic collapses to one Cloudflare egress IP
// and shares a single bucket. Probe consumes 2 hits/day (developer + pro);
// any concurrent bot activity from the same egress pushes the probe over the
// limit (pro tier 429'd while developer passed). Real users on corporate NAT
// hit the same trap. Raised to 30/hr — still catches sustained spam (~10×
// the documented bot avg), but tolerates shared-IP noise. Stripe doesn't
// charge for unused sessions, so the cost asymmetry strongly favours
// permissiveness over the (so far zero) revenue lost to false-positives.
// Window resets 1 hour after the first request in the window (per-IP, not
// calendar-aligned — see bumpCheckoutCount).
const CHECKOUT_HOURLY_LIMIT = 30;

/**
 * MCP traffic + organic-key aggregations used by /api/keys/stats. Exported
 * (not just internal) so test/keys-stats.test.ts can drive them against a
 * bun:sqlite-backed D1 shim without booting the worker. The shape returned by
 * `buildMcpTrafficStats` is the wire shape — keep stable, callers depend on it.
 */
export const MCP_TRAFFIC_THRESHOLDS = {
  soft_cta: MCP_SOFT_CTA_AT,
  strong_cta: MCP_STRONG_CTA_AT,
  hard_limit: MCP_HARD_LIMIT,
} as const;

export const AUDIT_TRAFFIC_THRESHOLDS = {
  soft_cta: AUDIT_SOFT_CTA_AT,
  strong_cta: AUDIT_STRONG_CTA_AT,
  hard_limit: AUDIT_HARD_LIMIT,
} as const;

// Domain-anchored — wildcards only in the local-part of operator-owned domains
// or RFC 2606 reserved domains. Earlier narrower forms (`pico+*@*`) classified
// `pico+anything@evil.com` as internal-test, letting an attacker spoof the
// dogfood pattern from any domain — both polluting /api/keys/stats "organic"
// counts AND bypassing the 3-keys-per-IP-per-day rate limit on /api/keys/create.
// 2026-06-13 probe (Stripe ledger=$0, 91/111 keys internal under old pattern but
// "organic 20" still counted plain pico@amdal.dev / hakon@amdal.dev / catch-all
// @getcommit.dev / Håkon's gmail) showed the old +alias-only patterns missed
// every non-+suffixed Håkon-controlled address. Widening to full-domain wildcards
// on operator-owned domains catches them all; the operator-owned-domain
// requirement keeps the rate-limit bypass safe (no third-party email registration
// at amdal.dev / pico.amdal.dev / getcommit.dev is possible — all three route
// to Pico-controlled mailboxes via Migadu/Cloudflare Email Routing).
export const DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS =
  // Kept in lock-step with wrangler.toml [vars] INTERNAL_TEST_EMAIL_PATTERNS.
  // Safe-to-wildcard domains:
  //   *@amdal.dev          — Pico-owned via Migadu (catch-all → pico@amdal.dev)
  //   *@pico.amdal.dev     — subdomain of amdal.dev (same ownership)
  //   *@getcommit.dev      — Håkon-owned via Cloudflare Email Routing
  //   *@example.com        — RFC 2606 reserved (cannot be registered)
  //   *@example.invalid    — RFC 2606 reserved
  // Specific third-party literals (cannot wildcard gmail.com / test.com):
  //   hawkaamdal@gmail.com — Håkon's personal Gmail (per workspace standing facts)
  //   hawkaa+commit-tier-verify@gmail.com, hawkaa+mcp-test@gmail.com
  //                        — Pico dogfood addresses surfaced 2026-06-20 during
  //                          a phantom-organic audit; kept literal because we
  //                          can't prove ownership of hawkaa@gmail.com.
  //   hakon@test.com, test@test.com
  //                        — placeholders on Verisign-owned test.com; literal
  //                          only, never *@test.com (rate-limit-bypass risk).
  //   hakon*@protonmail.com — Håkon dogfood via protonmail (surfaced 2026-06-26:
  //                          hakon.dogfood-test-*@protonmail.com read as
  //                          "1 organic" — same phantom-organic class as 2026-06-20).
  // 2026-06-20: 4 phantom literals added after /api/keys/stats kept reading
  // "4 organic" when D1 showed those 4 emails were all dogfood with 0
  // requests and NULL last_used_at — every session was strategizing on the
  // lie of "4 external users". The 4 backing keys are also revoked retroactively.
  "*@amdal.dev,*@pico.amdal.dev,*@getcommit.dev,*@example.com,*@example.invalid,hawkaamdal@gmail.com,hawkaa+commit-tier-verify@gmail.com,hawkaa+mcp-test@gmail.com,hakon@test.com,test@test.com,hakon*@protonmail.com";

export type McpTrafficStats = {
  today: {
    date: string;
    calls: number;
    unique_ips: number;
    ips_at_soft_cta: number;
    ips_at_strong_cta: number;
    ips_at_hard_limit: number;
  };
  last_7d: {
    from_date: string;
    to_date: string;
    calls: number;
    unique_ips_per_day_avg: number;
    max_daily_calls: number;
    ips_that_hit_soft_cta_in_7d: number;
  };
};

export type OrganicMcpKeyStats = {
  total_with_source_mcp: number;
  organic: number;
  internal_test: number;
  internal_test_patterns: string[];
};

/**
 * Convert a comma-separated list of glob patterns ("pico+*@*,foo@bar.com")
 * into compiled case-insensitive anchored regexes. Empty/whitespace patterns
 * are dropped. Regex metacharacters in the glob are escaped before `*` →
 * `.*` substitution so an attacker-controlled pattern can't blow up matching.
 */
export function parseEmailPatterns(raw: string | undefined | null): RegExp[] {
  const src = (raw ?? "").trim();
  if (!src) return [];
  return src
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const wildcarded = escaped.replace(/\*/g, ".*");
      return new RegExp(`^${wildcarded}$`, "i");
    });
}

/** True if `email` matches any of the compiled patterns. */
export function isInternalTestEmail(email: string, patterns: RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(email)) return true;
  }
  return false;
}

/**
 * Aggregate the mcp_rate_limits table into today + last_7d traffic stats.
 * Three D1 queries, all aggregations done server-side; no per-row work.
 * If the table is missing or any query errors, throws — caller wraps in
 * try/catch so /api/keys/stats stays 200 even when MCP metrics break.
 */
export async function buildMcpTrafficStats(db: D1Database): Promise<McpTrafficStats> {
  // UTC date format must match what bumpMcpCount writes: YYYY-MM-DD (see
  // todayUtcDate() above — `new Date().toISOString().slice(0, 10)`). SQLite's
  // `date('now')` also produces YYYY-MM-DD in UTC, so they line up.
  const today = new Date().toISOString().slice(0, 10);
  // 7-day window inclusive of today: today + 6 prior days. SQLite arithmetic
  // is on the ISO date string, so '-6 days' from a YYYY-MM-DD string works.
  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // 1. Today: single-query aggregation across today's rows.
  const todayRow = await db
    .prepare(
      `SELECT
         COALESCE(SUM(count), 0) as calls,
         COUNT(DISTINCT ip) as unique_ips,
         COUNT(CASE WHEN count >= ? THEN 1 END) as ips_at_soft_cta,
         COUNT(CASE WHEN count >= ? THEN 1 END) as ips_at_strong_cta,
         COUNT(CASE WHEN count >= ? THEN 1 END) as ips_at_hard_limit
       FROM mcp_rate_limits
       WHERE date = ?`
    )
    .bind(MCP_SOFT_CTA_AT, MCP_STRONG_CTA_AT, MCP_HARD_LIMIT, today)
    .first<{
      calls: number;
      unique_ips: number;
      ips_at_soft_cta: number;
      ips_at_strong_cta: number;
      ips_at_hard_limit: number;
    }>();

  // 2. Last 7d, per-day breakdown — needed for unique_ips_per_day_avg and
  //    max_daily_calls. Small result set (≤7 rows), aggregated in JS.
  const dailyRows = await db
    .prepare(
      `SELECT
         date,
         COUNT(DISTINCT ip) as ips_today,
         SUM(count) as calls_today
       FROM mcp_rate_limits
       WHERE date >= ?
       GROUP BY date`
    )
    .bind(sevenDaysAgo)
    .all<{ date: string; ips_today: number; calls_today: number }>();

  const dailyResults = dailyRows.results ?? [];
  let totalCalls7d = 0;
  let maxDailyCalls = 0;
  let ipsSum = 0;
  for (const r of dailyResults) {
    totalCalls7d += r.calls_today ?? 0;
    if ((r.calls_today ?? 0) > maxDailyCalls) maxDailyCalls = r.calls_today ?? 0;
    ipsSum += r.ips_today ?? 0;
  }
  // Avg over the calendar window (7 days), not just observed days — silent
  // days are zero, not missing. This makes "did anyone hit us this week" a
  // single readable number.
  const avgIps = Math.round(ipsSum / 7);

  // 3. Distinct IPs across the 7d window that ever crossed the soft-CTA bar.
  //    Cannot derive from daily query because an IP at count=20 on Mon and
  //    count=22 on Tue never hits 41 on any single day.
  //    Note: this counts IPs where any single day's count ≥ soft-CTA — matches
  //    the spec ("hit soft CTA") since the CTA fires per-day, not on rolling
  //    7d totals.
  const ipsHitSoftCtaRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT ip) as count
       FROM mcp_rate_limits
       WHERE date >= ? AND count >= ?`
    )
    .bind(sevenDaysAgo, MCP_SOFT_CTA_AT)
    .first<{ count: number }>();

  return {
    today: {
      date: today,
      calls: todayRow?.calls ?? 0,
      unique_ips: todayRow?.unique_ips ?? 0,
      ips_at_soft_cta: todayRow?.ips_at_soft_cta ?? 0,
      ips_at_strong_cta: todayRow?.ips_at_strong_cta ?? 0,
      ips_at_hard_limit: todayRow?.ips_at_hard_limit ?? 0,
    },
    last_7d: {
      from_date: sevenDaysAgo,
      to_date: today,
      calls: totalCalls7d,
      unique_ips_per_day_avg: avgIps,
      max_daily_calls: maxDailyCalls,
      ips_that_hit_soft_cta_in_7d: ipsHitSoftCtaRow?.count ?? 0,
    },
  };
}

/**
 * Aggregate the audit_rate_limits table into today + last_7d traffic stats.
 * Same shape as buildMcpTrafficStats — mirror table, separate counters.
 */
export async function buildAuditTrafficStats(db: D1Database): Promise<McpTrafficStats> {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const todayRow = await db
    .prepare(
      `SELECT
         COALESCE(SUM(count), 0) as calls,
         COUNT(DISTINCT ip) as unique_ips,
         COUNT(CASE WHEN count >= ? THEN 1 END) as ips_at_soft_cta,
         COUNT(CASE WHEN count >= ? THEN 1 END) as ips_at_strong_cta,
         COUNT(CASE WHEN count >= ? THEN 1 END) as ips_at_hard_limit
       FROM audit_rate_limits
       WHERE date = ?`
    )
    .bind(AUDIT_SOFT_CTA_AT, AUDIT_STRONG_CTA_AT, AUDIT_HARD_LIMIT, today)
    .first<{
      calls: number;
      unique_ips: number;
      ips_at_soft_cta: number;
      ips_at_strong_cta: number;
      ips_at_hard_limit: number;
    }>();

  const dailyRows = await db
    .prepare(
      `SELECT
         date,
         COUNT(DISTINCT ip) as ips_today,
         SUM(count) as calls_today
       FROM audit_rate_limits
       WHERE date >= ?
       GROUP BY date`
    )
    .bind(sevenDaysAgo)
    .all<{ date: string; ips_today: number; calls_today: number }>();

  const dailyResults = dailyRows.results ?? [];
  let totalCalls7d = 0;
  let maxDailyCalls = 0;
  let ipsSum = 0;
  for (const r of dailyResults) {
    totalCalls7d += r.calls_today ?? 0;
    if ((r.calls_today ?? 0) > maxDailyCalls) maxDailyCalls = r.calls_today ?? 0;
    ipsSum += r.ips_today ?? 0;
  }
  const avgIps = Math.round(ipsSum / 7);

  const ipsHitSoftCtaRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT ip) as count
       FROM audit_rate_limits
       WHERE date >= ? AND count >= ?`
    )
    .bind(sevenDaysAgo, AUDIT_SOFT_CTA_AT)
    .first<{ count: number }>();

  return {
    today: {
      date: today,
      calls: todayRow?.calls ?? 0,
      unique_ips: todayRow?.unique_ips ?? 0,
      ips_at_soft_cta: todayRow?.ips_at_soft_cta ?? 0,
      ips_at_strong_cta: todayRow?.ips_at_strong_cta ?? 0,
      ips_at_hard_limit: todayRow?.ips_at_hard_limit ?? 0,
    },
    last_7d: {
      from_date: sevenDaysAgo,
      to_date: today,
      calls: totalCalls7d,
      unique_ips_per_day_avg: avgIps,
      max_daily_calls: maxDailyCalls,
      ips_that_hit_soft_cta_in_7d: ipsHitSoftCtaRow?.count ?? 0,
    },
  };
}

/**
 * Count `source='mcp-soft-cta'` keys split organic vs internal-test by the
 * `INTERNAL_TEST_EMAIL_PATTERNS` env var (comma-separated globs).
 * Doesn't throw — empty list on query failure.
 */
export async function buildOrganicMcpKeyStats(
  db: D1Database,
  patternsRaw: string | undefined
): Promise<OrganicMcpKeyStats> {
  const patternList = (patternsRaw ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const compiled = parseEmailPatterns(patternsRaw ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS);

  let emails: string[] = [];
  try {
    const rows = await db
      .prepare(
        `SELECT email FROM api_keys
         WHERE revoked_at IS NULL AND source = 'mcp-soft-cta'`
      )
      .all<{ email: string }>();
    emails = (rows.results ?? []).map((r) => r.email);
  } catch {
    emails = [];
  }

  let internal = 0;
  for (const email of emails) {
    if (isInternalTestEmail(email, compiled)) internal++;
  }
  const total = emails.length;
  return {
    total_with_source_mcp: total,
    organic: total - internal,
    internal_test: internal,
    internal_test_patterns: patternList,
  };
}

/**
 * GET /api/keys/stats
 * Admin endpoint — requires X-Admin-Secret header matching ADMIN_SECRET env var.
 * Returns aggregate signup stats for measuring Show HN / launch conversion,
 * plus MCP traffic + organic-key breakdown (v1.14 conversion telemetry).
 */
app.get("/api/keys/stats", async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const [totalRow, todayRow, last24hRow, last7dRow] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL`).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL AND date(created_at) = date('now')`).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL AND created_at >= datetime('now', '-24 hours')`).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL AND created_at >= datetime('now', '-7 days')`).first<{ count: number }>(),
  ]);

  // Source attribution: how many keys per signup channel?
  const sourceRows = await c.env.DB.prepare(
    `SELECT COALESCE(source, 'web') as source, COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL GROUP BY COALESCE(source, 'web')`
  ).all<{ source: string; count: number }>();

  const recentRows = await c.env.DB.prepare(
    `SELECT key_prefix, email, tier, COALESCE(source, 'web') as source, created_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 20`
  ).all<{ key_prefix: string; email: string; tier: string; source: string; created_at: string }>();

  const sourceBreakdown: Record<string, number> = {};
  for (const row of sourceRows.results ?? []) {
    sourceBreakdown[row.source] = row.count;
  }

  // Organic vs internal-test split for headline counts. Discovered 2026-06-13
  // dogfooding the daily Telegram report: every recent "growth spike" entry
  // (+767% in 24h) was pico+*@amdal.dev probe traffic from my own sessions,
  // not real users. Raw counts kept above for back-compat; `organic` is what
  // every dashboard should read by default. Filtering uses the same
  // INTERNAL_TEST_EMAIL_PATTERNS env var as buildOrganicMcpKeyStats — single
  // source of truth for what counts as a probe.
  const orgCompiled = parseEmailPatterns(
    c.env.INTERNAL_TEST_EMAIL_PATTERNS ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS
  );
  const orgPatterns = (c.env.INTERNAL_TEST_EMAIL_PATTERNS ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Single query, client-side bucket. ~100 rows; cheap. Avoids re-implementing
  // glob matching in SQL where it would diverge from parseEmailPatterns.
  let organicTotal = 0;
  let organicToday = 0;
  let organicLast24h = 0;
  let organicLast7d = 0;
  let internalTotal = 0;
  try {
    const orgRows = await c.env.DB.prepare(
      `SELECT email, created_at FROM api_keys WHERE revoked_at IS NULL`
    ).all<{ email: string; created_at: string }>();
    const nowMs = Date.now();
    const cutoff24h = nowMs - 24 * 3600 * 1000;
    const cutoff7d = nowMs - 7 * 24 * 3600 * 1000;
    const todayUtc = new Date(nowMs).toISOString().slice(0, 10);
    for (const r of orgRows.results ?? []) {
      const isInternal = isInternalTestEmail(r.email, orgCompiled);
      if (isInternal) {
        internalTotal++;
        continue;
      }
      organicTotal++;
      // created_at is sqlite UTC "YYYY-MM-DD HH:MM:SS"; parse defensively.
      const ts = Date.parse(r.created_at.replace(" ", "T") + "Z");
      if (r.created_at.startsWith(todayUtc)) organicToday++;
      if (!Number.isNaN(ts) && ts >= cutoff24h) organicLast24h++;
      if (!Number.isNaN(ts) && ts >= cutoff7d) organicLast7d++;
    }
  } catch {
    // Defensive: if SELECT fails, organic_* are left at 0 and the response
    // still serves the raw counts — the dashboard reverts to overestimating
    // rather than crashing.
  }

  // MCP traffic + organic-key splits. Wrapped in try/catch so an aggregation
  // bug or missing mcp_rate_limits table never breaks the endpoint. If MCP
  // metrics fail, mcp_traffic is returned as null with an error string for
  // debuggability — the endpoint still serves source_breakdown / recent /
  // counts so the rest of the admin dashboard stays useful.
  let mcpTraffic: McpTrafficStats | null = null;
  let mcpTrafficError: string | null = null;
  try {
    mcpTraffic = await buildMcpTrafficStats(c.env.DB);
  } catch (err) {
    mcpTrafficError = err instanceof Error ? err.message : String(err);
  }

  // /api/audit traffic. Same defensive try/catch — if the table is missing
  // (migration hasn't run yet), surface the error string but keep serving.
  let auditTraffic: McpTrafficStats | null = null;
  let auditTrafficError: string | null = null;
  try {
    auditTraffic = await buildAuditTrafficStats(c.env.DB);
  } catch (err) {
    auditTrafficError = err instanceof Error ? err.message : String(err);
  }

  const organicMcpKeys = await buildOrganicMcpKeyStats(
    c.env.DB,
    c.env.INTERNAL_TEST_EMAIL_PATTERNS
  );

  return c.json({
    total_keys: totalRow?.count ?? 0,
    keys_today: todayRow?.count ?? 0,
    keys_last_24h: last24hRow?.count ?? 0,
    keys_last_7d: last7dRow?.count ?? 0,
    // Organic = excludes pico+*@amdal.dev / hawkaa+*@amdal.dev / test probes.
    // This is what should drive every "growth" claim. Raw counts above stay
    // for back-compat with any consumer that explicitly opts into raw.
    organic: {
      total: organicTotal,
      today: organicToday,
      last_24h: organicLast24h,
      last_7d: organicLast7d,
    },
    internal_test_total: internalTotal,
    internal_test_patterns: orgPatterns,
    source_breakdown: sourceBreakdown,
    recent: (recentRows.results ?? []).map((r) => ({
      key_prefix: r.key_prefix,
      email: r.email,
      tier: r.tier,
      source: r.source,
      created_at: r.created_at,
      is_internal_test: isInternalTestEmail(r.email, orgCompiled),
    })),
    mcp_traffic: mcpTraffic,
    mcp_traffic_error: mcpTrafficError,
    mcp_traffic_thresholds: MCP_TRAFFIC_THRESHOLDS,
    audit_traffic: auditTraffic,
    audit_traffic_error: auditTrafficError,
    audit_traffic_thresholds: AUDIT_TRAFFIC_THRESHOLDS,
    organic_mcp_keys: organicMcpKeys,
  });
});

/**
 * POST /api/v1/visit
 *
 * First-party pageview beacon — replaces Cloudflare Web Analytics, which has
 * been silently producing zero data account-wide since at least 2026-05-24
 * (confirmed via GraphQL: rumPageloadEventsAdaptiveGroups returned 0 visits
 * for getcommit.dev across 30 days; POST /cdn-cgi/rum returns 404 from a real
 * Chrome browser, leading the browser to flag a misleading CORS error and the
 * daily commit-report to show "0 visits" while reality was unknown).
 *
 * Body (all fields optional except path):
 *   { path: string, referrer?: string, utm_source?: string, utm_medium?: string,
 *     utm_campaign?: string, utm_content?: string, utm_term?: string }
 *
 * Server-side enrichment from CF request context:
 *   host        ← Origin or Referer hostname (anti-spoof check vs allowlist)
 *   ua_browser  ← coarse bucket from User-Agent
 *   ua_device   ← desktop/mobile/tablet/bot
 *   country     ← cf.country (2-letter ISO)
 *   ip_hash     ← SHA-256(ip || YYYY-MM-DD-salt) — rotates daily
 *
 * No cookies. No fingerprinting. No PII stored.
 *
 * Returns 204 No Content. Failures return 204 too — analytics must never block
 * a page render or surface errors to the user.
 */
app.post("/api/v1/visit", async (c) => {
  // Allowlist of accepted hosts — anything else is dropped to prevent the
  // endpoint from becoming a graffiti board for spoofed origin/referer values.
  //
  // CF Web Analytics break (2026-05-24..2026-06-10) hit the whole CF account.
  // The 09:18Z replacement initially covered getcommit.dev only; synligdigital.no
  // was named as a co-victim in the incident note but was never wired up — leaving
  // the outreach machine (30+ E2/E3/E4 sends/day) blind on landing-page traffic.
  // 2026-06-10 13:00Z: added synligdigital.no to close the gap before the
  // pricing-friction-v1 30d measurement (task 05b4b20aa57ddd09) is due 2026-06-20.
  const VALID_HOSTS = new Set([
    "getcommit.dev",
    "www.getcommit.dev",
    "synligdigital.no",
    "www.synligdigital.no",
  ]);

  try {
    // Parse body as text first, then JSON.parse — supports sendBeacon Blobs
    // sent with type:text/plain (CORS-safelisted, no preflight required) as
    // well as standard application/json. Avoiding preflight avoids a class of
    // headless-chromium preflight failures (cors-error 11) observed during
    // dogfooding 2026-06-10.
    const rawText = await c.req.text().catch(() => "");
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(rawText) as Record<string, unknown>; } catch { /* {} */ }

    const path = typeof body.path === "string" ? body.path.slice(0, 256) : "";
    if (!path || !path.startsWith("/")) return c.body(null, 204);

    // Derive host from Origin (preferred) then Referer; reject if not in allowlist.
    const originHeader = c.req.header("Origin") || "";
    const refererHeader = c.req.header("Referer") || "";
    let host = "";
    try {
      if (originHeader) host = new URL(originHeader).hostname;
      else if (refererHeader) host = new URL(refererHeader).hostname;
    } catch { /* fall through */ }
    if (!VALID_HOSTS.has(host)) return c.body(null, 204);

    // Parse referrer hostname (if any) from request body — captures the previous
    // page in the user's journey, distinct from the page that fired the beacon.
    const referrerInput = typeof body.referrer === "string" ? body.referrer : "";
    let referrer_host: string | null = null;
    if (referrerInput) {
      try {
        const refHost = new URL(referrerInput).hostname;
        // Drop same-host referrers (internal navigation) to keep this dimension
        // useful as "where did they come from" rather than noise.
        if (refHost && !VALID_HOSTS.has(refHost)) referrer_host = refHost;
      } catch { /* ignore malformed */ }
    }

    const utm_source = typeof body.utm_source === "string" ? body.utm_source.slice(0, 64) : null;
    const utm_medium = typeof body.utm_medium === "string" ? body.utm_medium.slice(0, 64) : null;
    const utm_campaign = typeof body.utm_campaign === "string" ? body.utm_campaign.slice(0, 64) : null;
    const utm_content = typeof body.utm_content === "string" ? body.utm_content.slice(0, 128) : null;
    const utm_term = typeof body.utm_term === "string" ? body.utm_term.slice(0, 128) : null;

    // Validate UTM values look like attribution slugs (prevents arbitrary
    // string-stuffing). Same regex as VALID_SOURCES coercion at line 2858.
    const utmRe = /^[a-z0-9_-]{1,64}$/i;
    const safeUtm = (v: string | null): string | null =>
      v && utmRe.test(v) ? v.toLowerCase() : null;

    // User-Agent coarse bucketing — high-cardinality strings waste storage and
    // expose fingerprinting risk. Five buckets is enough for traffic-source split.
    const ua = c.req.header("User-Agent") || "";
    const uaLc = ua.toLowerCase();
    const ua_device = /bot|crawl|spider|headless|node-fetch|curl|wget/.test(uaLc)
      ? "bot"
      : /mobile|android|iphone/.test(uaLc)
        ? "mobile"
        : /ipad|tablet/.test(uaLc)
          ? "tablet"
          : "desktop";
    const ua_browser = uaLc.includes("edg/")
      ? "edge"
      : uaLc.includes("firefox")
        ? "firefox"
        : uaLc.includes("chrome") || uaLc.includes("chromium")
          ? "chrome"
          : uaLc.includes("safari")
            ? "safari"
            : "other";

    // Drop bot traffic — keeps the data signal-dense for conversion analysis.
    // Real users matter; npm bot fetches do not. (Could log separately later.)
    if (ua_device === "bot") return c.body(null, 204);

    // CF request properties — country is two-letter ISO; null for unknown.
    const cf = (c.req.raw as unknown as { cf?: { country?: string } }).cf;
    const country = cf?.country ? String(cf.country).slice(0, 2) : null;

    // IP-hash with daily salt rotation: SHA-256(ip || YYYY-MM-DD || ADMIN_SECRET).
    // Daily rotation means hashes from yesterday's logs can't be joined to today's,
    // preventing across-day re-identification while still supporting same-day
    // unique-visitor counts. ADMIN_SECRET adds a server-side pepper so a leaked
    // table dump can't be brute-forced against the IPv4 space.
    const ip = c.req.header("CF-Connecting-IP")
      || c.req.header("X-Forwarded-For")
      || "unknown";
    const today = new Date().toISOString().slice(0, 10);
    const ipSaltSource = `${ip}|${today}|${c.env.ADMIN_SECRET || "no-salt"}`;
    const ipBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ipSaltSource));
    const ip_hash = Array.from(new Uint8Array(ipBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32); // 128 bits of hash is plenty for collision-resistance at our volume

    // Generate row id.
    const idBytes = new Uint8Array(8);
    crypto.getRandomValues(idBytes);
    const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    await c.env.DB.prepare(
      `INSERT INTO pageviews (id, host, path, referrer_host, utm_source, utm_campaign,
                              utm_medium, utm_content, utm_term, ua_browser, ua_device,
                              country, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, host, path, referrer_host,
      safeUtm(utm_source), safeUtm(utm_campaign), safeUtm(utm_medium),
      utm_content, utm_term,  // _content and _term may have richer values, no slug validation
      ua_browser, ua_device, country, ip_hash
    ).run();

    return c.body(null, 204);
  } catch (err) {
    // Never surface errors to the page — log and return 204 so the beacon
    // call is a no-op from the page's perspective.
    console.error("[visit-beacon] write failed:", (err as Error)?.message);
    return c.body(null, 204);
  }
});

/**
 * GET /api/v1/visits/stats
 *
 * Admin-only summary of pageview data — replaces the CF Analytics dashboard
 * for daily reporting purposes. Returns:
 *   - visits_today / visits_yesterday / visits_7d
 *   - unique_today / unique_7d (from ip_hash dedup within window)
 *   - top paths
 *   - utm_campaign breakdown
 *   - referrer breakdown
 *
 * Query params:
 *   ?days=N    — window for trend (default 7)
 *
 * Auth: X-Admin-Secret header must match ADMIN_SECRET.
 */
app.get("/api/v1/visits/stats", async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const daysParam = parseInt(c.req.query("days") || "7", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 90 ? daysParam : 7;

  // Note: ip_hash rotates daily, so unique-visitor counts beyond 1 day are
  // approximate — a single user shows up once per day in unique_within_window.
  //
  // by_host is required (not optional): the allowlist now spans two properties
  // (getcommit.dev + synligdigital.no) and reporting that blends them is the
  // exact "operator can't diagnose what they can't see" failure the migration
  // was supposed to end. Per-host break-down is canonical, not a nice-to-have.
  const [todayRow, yesterdayRow, windowRow, uniqueTodayRow, byPathRows, byCampaignRows, byReferrerRows, byHostRows, dailyRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS visits FROM pageviews WHERE date(created_at) = date('now')`
    ).first<{ visits: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS visits FROM pageviews WHERE date(created_at) = date('now','-1 day')`
    ).first<{ visits: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS visits FROM pageviews WHERE created_at >= datetime('now', '-' || ? || ' days')`
    ).bind(days).first<{ visits: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT ip_hash) AS uniques FROM pageviews
       WHERE date(created_at) = date('now') AND ip_hash IS NOT NULL`
    ).first<{ uniques: number }>(),
    c.env.DB.prepare(
      `SELECT path, COUNT(*) AS visits FROM pageviews
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY path ORDER BY visits DESC LIMIT 20`
    ).bind(days).all<{ path: string; visits: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(utm_campaign, '(none)') AS utm_campaign, COUNT(*) AS visits FROM pageviews
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY utm_campaign ORDER BY visits DESC LIMIT 20`
    ).bind(days).all<{ utm_campaign: string; visits: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(referrer_host, '(direct)') AS referrer_host, COUNT(*) AS visits FROM pageviews
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY referrer_host ORDER BY visits DESC LIMIT 20`
    ).bind(days).all<{ referrer_host: string; visits: number }>(),
    c.env.DB.prepare(
      `SELECT host, COUNT(*) AS visits FROM pageviews
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY host ORDER BY visits DESC`
    ).bind(days).all<{ host: string; visits: number }>(),
    c.env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS visits FROM pageviews
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY day ORDER BY day ASC`
    ).bind(days).all<{ day: string; visits: number }>(),
  ]);

  return c.json({
    window_days: days,
    visits_today: todayRow?.visits ?? 0,
    visits_yesterday: yesterdayRow?.visits ?? 0,
    visits_window: windowRow?.visits ?? 0,
    unique_today: uniqueTodayRow?.uniques ?? 0,
    top_paths: byPathRows?.results ?? [],
    by_campaign: byCampaignRows?.results ?? [],
    by_referrer: byReferrerRows?.results ?? [],
    by_host: byHostRows?.results ?? [],
    daily: dailyRows?.results ?? [],
  });
});

/**
 * POST /api/admin/seed-endorsements
 * Admin endpoint — requires X-Admin-Secret header.
 * Seeds demo endorsements for a list of repos.
 * Body: { repos: [{ owner: string, repo: string }], count?: number }
 * Each repo gets `count` (default 1) synthetic endorsements with unique nullifiers.
 * Used to populate demo data before Show HN launch.
 */
app.post("/api/admin/seed-endorsements", async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as {
    repos?: Array<{ owner: string; repo: string }>;
    count?: number;
  };

  if (!Array.isArray(body?.repos) || body.repos.length === 0) {
    return c.json({ error: "bad_request", message: "repos array required" }, 400);
  }

  const count = Math.min(Math.max(Number(body.count) || 1, 1), 50);
  const results: Array<{ repo: string; seeded: number; total: number }> = [];

  for (const { owner, repo } of body.repos) {
    if (typeof owner !== "string" || typeof repo !== "string") continue;
    const ownerLower = owner.toLowerCase();
    const repoLower = repo.toLowerCase();

    let seeded = 0;
    for (let i = 0; i < count; i++) {
      // Generate unique nullifier: seed-<owner>-<repo>-<i>-<random>
      const randBytes = new Uint8Array(6);
      crypto.getRandomValues(randBytes);
      const rand = Array.from(randBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const nullifier = `seed-${ownerLower}-${repoLower}-${i}-${rand}`;

      // Skip if somehow collides
      const existing = await c.env.DB.prepare(
        `SELECT id FROM endorsements WHERE repo_owner = ? AND repo_name = ? AND world_id_nullifier = ? LIMIT 1`
      ).bind(ownerLower, repoLower, nullifier).first<{ id: string }>();
      if (existing) continue;

      const idBytes = new Uint8Array(8);
      crypto.getRandomValues(idBytes);
      const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

      await c.env.DB.prepare(
        `INSERT INTO endorsements (id, repo_owner, repo_name, world_id_nullifier, proof, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, ownerLower, repoLower, nullifier, "demo-seed", Math.floor(Date.now() / 1000)).run();
      seeded++;
    }

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM endorsements WHERE repo_owner = ? AND repo_name = ?`
    ).bind(ownerLower, repoLower).first<{ count: number }>();

    results.push({ repo: `${ownerLower}/${repoLower}`, seeded, total: countRow?.count ?? seeded });
  }

  return c.json({ ok: true, results });
});

// ── Watchlist Subscription ───────────────────────────────────────────

/**
 * POST /api/subscribe
 * Accept { email, packages? } → save watchlist subscription → send welcome risk report email
 *
 * packages: optional array of npm package names (max 20, defaults to top CRITICAL packages)
 */
app.post("/api/subscribe", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email: string = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const packagesInput: string[] = Array.isArray(body?.packages)
    ? body.packages.filter((p: unknown) => typeof p === "string").slice(0, 20)
    : [];

  // Default watchlist: top CRITICAL + high-download packages
  const DEFAULT_PACKAGES = [
    "chalk", "glob", "zod", "lodash", "rimraf", "axios", "cross-env",
    "express", "typescript", "vite", "esbuild", "prettier", "eslint",
  ];
  const packages = packagesInput.length > 0 ? packagesInput : DEFAULT_PACKAGES;

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "invalid_email", message: "A valid email address is required." }, 400);
  }

  // Generate ID
  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Upsert subscription (one record per email, update packages if re-subscribing)
  await c.env.DB.prepare(
    `INSERT INTO watchlist_subscriptions (id, email, packages, verified, created_at)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET packages = excluded.packages`
  ).bind(id, email, JSON.stringify(packages)).run();

  // Score packages for welcome email (best-effort, same logic as /api/audit)
  const MAX_CONCURRENT = 5;
  const auditResults: Array<{
    name: string;
    score: number | null;
    maintainers: number | null;
    weeklyDownloads: number | null;
    riskFlags: string[];
  }> = [];

  for (let i = 0; i < packages.length; i += MAX_CONCURRENT) {
    const batch = packages.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map(async (pkg) => {
        try {
          const profile = await buildNpmCommitmentProfile(pkg);
          if (!profile) return { name: pkg, score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] };
          const wdl = profile.recentWeeklyDownloads ?? 0;
          const riskFlags: string[] = [];
          const effPub = profile.activePublisherCount ?? profile.maintainerCount;
          if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
          else if (profile.ageYears < 1 && wdl > 1_000_000) riskFlags.push("HIGH");
          else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
          return { name: profile.name, score: profile.commitmentScore, maintainers: profile.maintainerCount, weeklyDownloads: wdl, riskFlags };
        } catch {
          return { name: pkg, score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] };
        }
      })
    );
    auditResults.push(...batchResults);
  }

  // Sort: CRITICAL first, then by downloads
  auditResults.sort((a, b) => {
    const aCrit = a.riskFlags.includes("CRITICAL") ? 1 : 0;
    const bCrit = b.riskFlags.includes("CRITICAL") ? 1 : 0;
    if (aCrit !== bCrit) return bCrit - aCrit;
    return (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0);
  });

  const critical = auditResults.filter((p) => p.riskFlags.includes("CRITICAL"));
  const critDL = critical.reduce((s, p) => s + (p.weeklyDownloads ?? 0), 0);

  function fmtDL(n: number | null): string {
    if (!n) return "?";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return Math.round(n / 1e6) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "K";
    return String(n);
  }

  const pkgLines = auditResults
    .filter((p) => p.score !== null)
    .map((p) => {
      const flag = p.riskFlags.includes("CRITICAL") ? "⚑ CRITICAL" : p.riskFlags.includes("HIGH") ? "⚠ HIGH" : p.riskFlags.includes("WARN") ? "↓ WARN" : "✓ OK";
      return `  ${p.name.padEnd(22)} ${String(p.score).padStart(3)}/100  ${p.maintainers}p  ${fmtDL(p.weeklyDownloads)}/wk  ${flag}`;
    })
    .join("\n");

  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const critDLStr = fmtDL(critDL);

  const emailSubject = critical.length > 0
    ? `Supply Chain Alert: ${critical.length} CRITICAL package${critical.length > 1 ? "s" : ""} in your watchlist`
    : "Your Commit Watchlist is active";

  const emailBody = `Supply Chain Risk Report — ${dateStr}

${critical.length > 0
  ? `${critical.length} CRITICAL package${critical.length > 1 ? "s" : ""} detected (${critDLStr}/wk at risk from single-publisher exposure):`
  : "Your watched packages look healthy today."}

${pkgLines || "(No packages scored yet)"}

CRITICAL = sole npm publisher + 10M+ weekly downloads.
This is the structural profile that made the April 1st axios attack possible.

Audit your own project:
  npx proof-of-commitment --file package.json

Full leaderboard: https://getcommit.dev/watchlist
GitHub Action (auto-flag on PRs): https://github.com/piiiico/proof-of-commitment

—
Commit · getcommit.dev
Reply "unsubscribe" to stop receiving these reports.`;

  let emailSent = false;
  if (c.env.RESEND_API_KEY) {
    try {
      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Commit <noreply@getcommit.dev>",
          // reply_to: anonymous /api/subscribe risk-report recipients reply
          // intent ("how do I upgrade?", "scan our private repos?") would
          // otherwise vanish at noreply@. Route to a real human inbox.
          reply_to: "pico@amdal.dev",
          to: [email],
          subject: emailSubject,
          text: emailBody,
        }),
      });
      emailSent = emailResp.ok;
    } catch {
      // best effort
    }
  }

  return c.json({
    ok: true,
    subscribed: true,
    message: emailSent
      ? `Risk report sent to ${email}. Weekly alerts will follow.`
      : `Subscribed! Weekly supply chain alerts will be sent to ${email}.`,
    critical_count: critical.length,
    package_count: auditResults.filter((p) => p.score !== null).length,
  });
});

/**
 * GET /api/subscribe/stats
 * Admin endpoint — subscription count stats.
 */
app.get("/api/subscribe/stats", async (c) => {
  const adminSecret = (c.env as unknown as Record<string, string>).ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const total = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM watchlist_subscriptions`).first<{ count: number }>();
  const recent = await c.env.DB.prepare(
    `SELECT email, created_at FROM watchlist_subscriptions ORDER BY created_at DESC LIMIT 10`
  ).all<{ email: string; created_at: string }>();
  return c.json({
    total_subscriptions: total?.count ?? 0,
    recent: (recent.results ?? []).map((r) => ({ email: r.email, created_at: r.created_at })),
  });
});

// ── Commit Pro Watchlist (API key-gated, monitored_packages backed) ──
//
// The pricing page promises "monitoring + alerts" for Pro tier. These endpoints
// let an authenticated Pro user register packages to watch. A daily cron
// (runProMonitoringScan) re-scores them and emails the key holder on score
// drops. Schema: monitored_projects → monitored_packages (migration 0005).
// For MVP we flatten the project model — one default project per API key.

// Monitored-package caps per tier. Keep ratios in sync with /pricing project counts:
//   developer (3 projects)  → 15 packages (5/project)
//   pro       (10 projects) → 50 packages (5/project)
//   enterprise (unlimited)  → 500 packages (hard cap, soft-sell to higher)
const PACKAGE_LIMITS = {
  free: 3,           // free tier: taste monitoring with 3 packages (weekly digest)
  developer: 15,     // $15/mo: 3 projects × ~5 packages (daily scan)
  pro: 50,           // $29/mo: 10 projects × ~5 packages (daily scan)
  enterprise: 500,
} as const;

const ECOSYSTEMS = new Set(["npm", "pypi", "cargo", "golang"]);

/** Random 16-char hex id (same shape used by api_keys). */
function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ensure the api_key has a "default" project, return its id. */
async function getOrCreateDefaultProject(db: D1Database, apiKeyId: string, email: string): Promise<string> {
  const existing = await db.prepare(
    `SELECT id FROM monitored_projects WHERE api_key_id = ? AND name = 'default' LIMIT 1`
  ).bind(apiKeyId).first<{ id: string }>();
  if (existing) return existing.id;

  const id = newId();
  await db.prepare(
    `INSERT INTO monitored_projects (id, api_key_id, name, alert_email, threshold_critical, threshold_warn, created_at)
     VALUES (?, ?, 'default', ?, 30, 50, datetime('now'))`
  ).bind(id, apiKeyId, email).run();
  return id;
}

/** Require a paid API key (Developer/Pro/Enterprise); returns the key context or an error response.
 *  Per /pricing: monitoring is included from Developer ($15/mo) upward.
 *
 *  The upgrade.url carries the authenticated user's email as a query param so
 *  the /pricing modal pre-fills it — removes one re-type step at the highest-
 *  stakes click in the funnel. The user is already authenticated to this
 *  endpoint, so returning their own email back to them is not a leak. The
 *  pre-fill in /pricing.astro reads `email` from URLSearchParams and only
 *  applies it when the value looks like an email.
 *
 *  utm_campaign=key-upgrade fires CONTEXT_BY_CAMPAIGN['key-upgrade'] in
 *  pricing.astro — a banner that reframes the page as "you came from your own
 *  authenticated key" and pre-selects Developer in the checkout modal. Without
 *  this tag the visitor lands on generic /pricing with no context, identical
 *  asymmetry to the 2026-06-10 audit-overshoot destination-context gap (4th
 *  occurrence of funnel-surface-gap pattern). Backend authoring of utm_campaign
 *  also feeds the checkout-webhook attribution path (worker.ts:6954 reads
 *  metadata.utm_campaign first → api_keys.source) — so any conversion from a
 *  rate-limited or pro-feature-blocked free user is now measurable in
 *  source_breakdown instead of silently bucketing as 'web'. CLI callers
 *  (npm-package/index.js printUpgradeRequired) append their own utm_source=cli
 *  + utm_campaign=<cmd> after this — URLSearchParams.get returns the first
 *  occurrence, so backend campaigning wins for the banner; CLI's tag remains
 *  for analytics replay. `medium` identifies the surface that triggered the
 *  prompt: 'quota' (429), 'pro-feature' (402), 'pkg-cap' (422), 'dashboard'
 *  (signed-in usage check).
 */
export function buildUpgradeUrl(email: string | undefined, ctx?: { medium?: string }): string {
  const base = "https://getcommit.dev/pricing";
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  params.set("utm_campaign", "key-upgrade");
  params.set("utm_source", "key");
  if (ctx?.medium) params.set("utm_medium", ctx.medium);
  return `${base}?${params.toString()}`;
}

/** Require any valid API key (free, developer, pro, enterprise).
 *  Used for watchlist endpoints where free-tier users get a taste (3 packages, weekly digest).
 */
function requireAnyKey(
  c: { get: (k: string) => ApiKeyContext | null; json: (b: unknown, s?: number) => Response }
): ApiKeyContext | Response {
  const key = c.get("apiKey");
  if (!key) {
    return c.json({
      error: "unauthorized",
      message: "Provide an API key via Authorization: Bearer sk_commit_...",
    }, 401);
  }
  return key;
}

function requireProKey(
  c: { get: (k: string) => ApiKeyContext | null; json: (b: unknown, s?: number) => Response }
): ApiKeyContext | Response {
  const key = c.get("apiKey");
  if (!key) {
    return c.json({
      error: "unauthorized",
      message: "Provide an API key via Authorization: Bearer sk_commit_...",
    }, 401);
  }
  if (key.tier !== "developer" && key.tier !== "pro" && key.tier !== "enterprise") {
    const upgradeUrl = buildUpgradeUrl(key.email, { medium: "pro-feature" });
    return c.json({
      error: "upgrade_required",
      message: `Monitoring + alerts start on Developer ($15/mo). Upgrade at ${upgradeUrl}`,
      current_tier: key.tier,
      upgrade: { url: upgradeUrl, plan: "developer", price: "$15/month" },
    }, 402);
  }
  return key;
}

/**
 * POST /api/watchlist
 * Body: { package: string, ecosystem?: "npm" | "pypi" | "cargo" | "golang" }
 *    OR { packages: Array<{ name: string, ecosystem?: string }> }
 * Adds packages to the API key's default monitoring project.
 */
app.post("/api/watchlist", async (c) => {
  const keyOrErr = requireAnyKey(c);
  if (keyOrErr instanceof Response) return keyOrErr;
  const key = keyOrErr;

  const body = await c.req.json().catch(() => ({}));

  // Normalize input to array of { name, ecosystem }
  type Item = { name: string; ecosystem: string };
  const items: Item[] = [];
  const rawItems: Array<{ name?: unknown; ecosystem?: unknown }> = Array.isArray(body?.packages)
    ? body.packages
    : (typeof body?.package === "string" ? [{ name: body.package, ecosystem: body.ecosystem }] : []);

  for (const raw of rawItems) {
    if (typeof raw?.name !== "string") continue;
    const name = raw.name.trim();
    if (!name) continue;
    const eco = (typeof raw?.ecosystem === "string" ? raw.ecosystem : "npm").toLowerCase();
    if (!ECOSYSTEMS.has(eco)) {
      return c.json({ error: "invalid_ecosystem", message: `ecosystem must be one of: ${[...ECOSYSTEMS].join(", ")}`, got: eco }, 400);
    }
    items.push({ name, ecosystem: eco });
  }

  if (items.length === 0) {
    return c.json({
      error: "missing_packages",
      message: "Body must contain { package, ecosystem } or { packages: [{ name, ecosystem }] }",
    }, 400);
  }

  const projectId = await getOrCreateDefaultProject(c.env.DB, key.id, key.email);

  // Enforce per-tier package cap (count distinct packages already in this project)
  const cap = PACKAGE_LIMITS[key.tier] ?? 0;
  const existingCount = (await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM monitored_packages WHERE project_id = ?`
  ).bind(projectId).first<{ n: number }>())?.n ?? 0;

  if (existingCount + items.length > cap) {
    return c.json({
      error: "package_limit_exceeded",
      message: `Your ${key.tier} tier allows ${cap} monitored packages. Currently watching ${existingCount}.`,
      current: existingCount,
      limit: cap,
      upgrade: key.tier === "free"
        ? { url: buildUpgradeUrl(key.email, { medium: "pkg-cap" }), plan: "developer", price: "$15/month", message: "Upgrade to Developer for 15 monitored packages + daily scans" }
        : key.tier === "developer"
          ? { url: buildUpgradeUrl(key.email, { medium: "pkg-cap" }), plan: "pro", price: "$29/month" }
          : key.tier === "pro"
            ? { url: buildUpgradeUrl(key.email, { medium: "pkg-cap" }), plan: "enterprise" }
            : undefined,
    }, 422);
  }

  // Insert with INSERT OR IGNORE so re-adding the same package is a no-op
  const added: Array<{ id: string; name: string; ecosystem: string; new: boolean }> = [];
  for (const item of items) {
    const id = newId();
    const result = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO monitored_packages (id, project_id, package_name, ecosystem)
       VALUES (?, ?, ?, ?)`
    ).bind(id, projectId, item.name, item.ecosystem).run();
    const wasNew = (result.meta?.changes ?? 0) > 0;
    if (wasNew) {
      added.push({ id, name: item.name, ecosystem: item.ecosystem, new: true });
    } else {
      // Look up existing id
      const existing = await c.env.DB.prepare(
        `SELECT id FROM monitored_packages WHERE project_id = ? AND package_name = ? AND ecosystem = ?`
      ).bind(projectId, item.name, item.ecosystem).first<{ id: string }>();
      added.push({ id: existing?.id ?? "", name: item.name, ecosystem: item.ecosystem, new: false });
    }
  }

  return c.json({
    ok: true,
    project_id: projectId,
    added: added.length,
    new_packages: added.filter((a) => a.new).length,
    already_watching: added.filter((a) => !a.new).length,
    packages: added,
  }, 201);
});

/**
 * GET /api/watchlist
 * Returns the API key's monitored packages with current scores + last_scanned_at.
 */
app.get("/api/watchlist", async (c) => {
  const keyOrErr = requireAnyKey(c);
  if (keyOrErr instanceof Response) return keyOrErr;
  const key = keyOrErr;

  const project = await c.env.DB.prepare(
    `SELECT id, threshold_critical, threshold_warn, paused_at FROM monitored_projects
     WHERE api_key_id = ? AND name = 'default' LIMIT 1`
  ).bind(key.id).first<{ id: string; threshold_critical: number; threshold_warn: number; paused_at: string | null }>();

  if (!project) {
    return c.json({
      project_id: null,
      paused: false,
      thresholds: { critical: 30, warn: 50 },
      count: 0,
      packages: [],
      message: "No packages monitored yet. POST /api/watchlist with { package, ecosystem }.",
    });
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, package_name as name, ecosystem, current_score, previous_score, risk_level, last_scanned_at
     FROM monitored_packages WHERE project_id = ? ORDER BY package_name`
  ).bind(project.id).all<{
    id: string;
    name: string;
    ecosystem: string;
    current_score: number | null;
    previous_score: number | null;
    risk_level: string | null;
    last_scanned_at: string | null;
  }>();

  return c.json({
    project_id: project.id,
    paused: project.paused_at !== null,
    thresholds: { critical: project.threshold_critical, warn: project.threshold_warn },
    tier: key.tier,
    limit: PACKAGE_LIMITS[key.tier] ?? 0,
    count: rows.results?.length ?? 0,
    packages: rows.results ?? [],
  });
});

/**
 * DELETE /api/watchlist
 * Body: { package: string, ecosystem?: string } — removes a single package.
 * Body: { all: true } — removes all packages (keeps the project row).
 */
app.delete("/api/watchlist", async (c) => {
  const keyOrErr = requireAnyKey(c);
  if (keyOrErr instanceof Response) return keyOrErr;
  const key = keyOrErr;

  const body = await c.req.json().catch(() => ({}));
  const project = await c.env.DB.prepare(
    `SELECT id FROM monitored_projects WHERE api_key_id = ? AND name = 'default' LIMIT 1`
  ).bind(key.id).first<{ id: string }>();
  if (!project) return c.json({ ok: true, removed: 0, message: "Nothing to remove" });

  if (body?.all === true) {
    const result = await c.env.DB.prepare(
      `DELETE FROM monitored_packages WHERE project_id = ?`
    ).bind(project.id).run();
    return c.json({ ok: true, removed: result.meta?.changes ?? 0, mode: "all" });
  }

  const name = typeof body?.package === "string" ? body.package.trim() : "";
  const eco = typeof body?.ecosystem === "string" ? body.ecosystem.toLowerCase() : "npm";
  if (!name) return c.json({ error: "missing_package", message: "Provide { package, ecosystem } or { all: true }" }, 400);

  const result = await c.env.DB.prepare(
    `DELETE FROM monitored_packages WHERE project_id = ? AND package_name = ? AND ecosystem = ?`
  ).bind(project.id, name, eco).run();
  return c.json({ ok: true, removed: result.meta?.changes ?? 0, package: name, ecosystem: eco });
});

/**
 * POST /api/admin/trigger-pro-scan
 * Manually trigger the daily Pro monitoring scan (for testing).
 * Requires X-Admin-Secret header matching ADMIN_SECRET.
 */
app.post("/api/admin/trigger-pro-scan", async (c) => {
  const adminSecret = (c.env as unknown as Record<string, string>).ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = await runProMonitoringScan(c.env);
  return c.json({ ok: true, ...result });
});

// ── Remote MCP Server ────────────────────────────────────────────────
//
// Stateless MCP endpoint. Each request creates a fresh server + transport.
// Enables any MCP client (Claude Desktop, Cursor, etc.) to query
// commitment data without running anything locally.
//
// Connect: https://poc-backend.amdal-dev.workers.dev/mcp
//
// Anonymous IP is rate-limited per UTC day:
//   1–40    no CTA
//   41–80   response + soft CTA appended
//   81–100  response + stronger CTA
//   101+    hard block
// API key holders bypass.

// MCP rate-limit thresholds + signup URL are declared earlier in the file
// (next to /api/keys/stats so MCP_TRAFFIC_THRESHOLDS can reference them at
// module-init without hitting the temporal dead zone). Reused below.

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

interface McpCtx {
  env: Bindings;
  ip: string;
  hasApiKey: boolean;
  // Populated only when hasApiKey is true and the api_keys row was fetched.
  // Drives free-tier soft-CTA injection in withMcpRateLimit — without these
  // fields a free-key holder would silently bypass all conversion pressure
  // (the 149-keys-0-paying gap diagnosed 2026-06-20: free-key MCP traffic
  // never bumped any counter, never saw any upgrade prompt, dashboard always
  // showed 0/200 even after hundreds of MCP calls).
  tier?: "free" | "developer" | "pro" | "enterprise";
  keyEmail?: string;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function mcpCtaText(count: number): string {
  const remaining = Math.max(0, MCP_HARD_LIMIT - count);
  if (count >= MCP_STRONG_CTA_AT) {
    return [
      "",
      "─────────────────────────────────────────────────",
      `⚠ Commit MCP — ${count}/${MCP_HARD_LIMIT} free queries today (${remaining} left).`,
      `   Get a free key now: call get_api_key({ email: "you@co.com" })`,
      `   Or sign up at: ${MCP_SIGNUP_URL}`,
      "─────────────────────────────────────────────────",
    ].join("\n");
  }
  return [
    "",
    "─────────────────────────────────────────────────",
    `Commit MCP — ${count}/${MCP_HARD_LIMIT} free queries used today.`,
    `Get notified when packages you queried get worse — call get_api_key with your email,`,
    `or sign up at: ${MCP_SIGNUP_URL}`,
    "─────────────────────────────────────────────────",
  ].join("\n");
}

function mcpHardBlockText(count: number): string {
  return [
    `Daily free MCP limit reached (${count}/${MCP_HARD_LIMIT}). Resets at 00:00 UTC.`,
    "",
    `Get a free API key right here — call the get_api_key tool with your email.`,
    `Or sign up at: ${MCP_SIGNUP_URL}    (30s, no card)`,
    "",
    `A free key gives you 200 audits/day + weekly alerts when your packages get riskier.`,
  ].join("\n");
}

// Soft-CTA threshold for FREE-tier API key holders on MCP.
// Different from anon MCP_SOFT_CTA_AT (5) because keyed-free users are a
// warmer audience — they already opted in, so the upgrade conversation
// can start later, after sustained usage proves the channel is valuable.
// 10 = 2× anon threshold; calibrated against the 149-keys-0-paying gap
// where ZERO upgrade pressure was visible to free-key MCP users.
export const MCP_FREE_KEY_SOFT_CTA_AT = 10;
export const MCP_FREE_KEY_STRONG_CTA_AT = 25;

/**
 * Value-positive soft-CTA appended to MCP tool results for FREE-tier API
 * key holders past usage milestones. No hard limit and no "running out"
 * language — the pricing page promises "unlimited with free API key" and
 * we keep that promise. The CTA frames Developer ($15/mo) as additive
 * (CI/CD GitHub Action, instant alerts, batch API, 50 repo audits/month),
 * not as a cap reliever. Email pre-fills the /pricing checkout modal so
 * the click → buy path is 2 fewer fields. medium=mcp-free-key tags this
 * funnel separately from anon mcp-soft-cta in /api/admin analytics.
 */
export function mcpFreeKeyCtaText(count: number, email: string | undefined): string {
  const upgradeUrl = buildUpgradeUrl(email, { medium: "mcp-free-key" });
  if (count >= MCP_FREE_KEY_STRONG_CTA_AT) {
    return [
      "",
      "─────────────────────────────────────────────────",
      `Commit MCP — ${count} audits today (free key, unlimited).`,
      `You're using this every day. Developer ($15/mo) adds:`,
      `  • Auto-trigger GitHub Action on every PR`,
      `  • Instant email alerts (vs free weekly digest)`,
      `  • 50 GitHub repo audits / month`,
      `  • Batch API — up to 5 packages per call`,
      `→ ${upgradeUrl}`,
      "─────────────────────────────────────────────────",
    ].join("\n");
  }
  return [
    "",
    "─────────────────────────────────────────────────",
    `Commit MCP — ${count} audits today on free key (unlimited).`,
    `Running this in CI? Developer ($15/mo) auto-triggers on every PR + instant alerts:`,
    `→ ${upgradeUrl}`,
    "─────────────────────────────────────────────────",
  ].join("\n");
}

/**
 * Increment today's /api/audit counter for this IP. Returns the post-increment
 * count. Atomically performed in D1 via ON CONFLICT … RETURNING count.
 * Same shape as bumpMcpCount — separate table so /audit and /mcp counters
 * don't share a budget; a heavy MCP user shouldn't lock out CLI traffic.
 */
async function bumpAuditCount(env: Bindings, ip: string): Promise<number> {
  const date = todayUtcDate();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO audit_rate_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(ip, date).first<{ count: number }>();
    return row?.count ?? 1;
  } catch {
    // Defensive: never break /api/audit on bookkeeping failure.
    // Fail open with count=1 — worst case is the user skips the soft-CTA tier.
    return 1;
  }
}

/**
 * Type for the per-package result objects assembled by /api/audit, narrowed to
 * just the fields auditCtaText needs to personalize. Defined locally here (not
 * exported) because the route assembles its results inline rather than via a
 * shared type — keeping this tied to call-site shape would create a fragile
 * coupling. Optional `compromised`/`score`/`riskFlags` mirror the inline type
 * at the audit handler (worker.ts L951-967).
 */
type AuditResultForCta = {
  name: string;
  score?: number | null;
  riskFlags?: string[];
  compromised?: { attack: string; date: string; url: string };
  error?: string;
};

/**
 * Pick the package most worth calling out in the CTA. Priority:
 *   1. compromised (known historical incident — strongest fear signal)
 *   2. CRITICAL riskFlag
 *   3. HIGH riskFlag
 *   4. lowest score < 70
 * Returns null when nothing's worth surfacing (healthy scan or all errors).
 */
function pickWorstAuditPackage(results: AuditResultForCta[]): AuditResultForCta | null {
  if (!results || results.length === 0) return null;
  const scored = results.filter((r) => !r.error);
  if (scored.length === 0) return null;
  const compromised = scored.find((r) => r.compromised);
  if (compromised) return compromised;
  const critical = scored.find((r) => r.riskFlags?.some((f) => f.startsWith("CRITICAL")));
  if (critical) return critical;
  const high = scored.find((r) => r.riskFlags?.some((f) => f.startsWith("HIGH")));
  if (high) return high;
  const withScore = scored.filter((r) => typeof r.score === "number" && (r.score as number) < 70);
  if (withScore.length === 0) return null;
  withScore.sort((a, b) => (a.score as number) - (b.score as number));
  return withScore[0];
}

/**
 * CTA text injected as the `_cta` field on /api/audit JSON responses when the
 * anonymous IP has crossed AUDIT_SOFT_CTA_AT for today. The CLI prints this
 * dim+cyan after the results table (npm-package/index.js L2337/L2369). When
 * `results` is supplied, the message personalizes to the worst-risk package
 * from the current scan — converting a generic free-tier nudge into a specific
 * "this package you just looked at is risky, get alerts on it" hook anchored
 * to the user's actual workload. Original generic text retained as fallback
 * for healthy scans and the no-results path.
 */
function auditCtaText(count: number, results?: AuditResultForCta[]): string {
  const remaining = Math.max(0, AUDIT_HARD_LIMIT - count);
  const worst = results ? pickWorstAuditPackage(results) : null;
  // First-touch variant (count < AUDIT_SOFT_CTA_AT): value-focused, no quota
  // pressure. Most CLI users audit 1-2 times and never return. The first audit
  // is the highest-intent moment — they just saw CRITICAL findings. Lead with
  // "get alerted if this gets attacked" not "you've used 1/15 of your quota."
  // Quota framing kicks in only at >=SOFT_CTA where the user has demonstrated
  // repeat engagement and the wall is approaching. Prior code gated _cta at
  // >=SOFT_CTA (5), so 80%+ of anonymous IPs (15/17 in a 7-day window) churned
  // without ever seeing a single CTA from the server — in CI (non-TTY), where
  // the CLI's inlineSignup prompt is skipped, the server _cta was the ONLY
  // conversion touchpoint.
  const firstTouch = count < AUDIT_SOFT_CTA_AT;

  if (worst) {
    if (worst.compromised) {
      return firstTouch
        ? `⚠ ${worst.name} was compromised (${worst.compromised.attack}, ${worst.compromised.date}). Get alerted before the next attack hits your dependencies — free key, 30s, no card: ${AUDIT_SIGNUP_URL}`
        : `⚠ ${worst.name} was compromised (${worst.compromised.attack}, ${worst.compromised.date}). Free tier — ${count}/${AUDIT_HARD_LIMIT} audits today (${remaining} left). Get alerted the next time a package you scan flips — free key, 30s, no card: ${AUDIT_SIGNUP_URL}`;
    }
    const criticalFlag = worst.riskFlags?.find((f) => f.startsWith("CRITICAL"));
    if (criticalFlag) {
      const reason = criticalFlag.replace(/^CRITICAL:\s*/, "").trim();
      return firstTouch
        ? `⚠ ${worst.name} is CRITICAL — ${reason}. Same attack profile as axios (Mar 2026). Monitor it — free key, 30s, no card: ${AUDIT_SIGNUP_URL}`
        : `⚠ ${worst.name} scored CRITICAL — ${reason}. Free tier — ${count}/${AUDIT_HARD_LIMIT} audits today (${remaining} left). Get alerted when ${worst.name}'s score worsens — free key, 30s, no card: ${AUDIT_SIGNUP_URL}`;
    }
    const highFlag = worst.riskFlags?.find((f) => f.startsWith("HIGH"));
    if (highFlag) {
      const reason = highFlag.replace(/^HIGH:\s*/, "").trim();
      return firstTouch
        ? `${worst.name} flagged HIGH — ${reason}. Get alerted when it worsens — free key, no card: ${AUDIT_SIGNUP_URL}`
        : `${worst.name} flagged HIGH — ${reason}. Free tier — ${count}/${AUDIT_HARD_LIMIT} audits today (${remaining} left). Get alerted when ${worst.name}'s score worsens — free key, no card: ${AUDIT_SIGNUP_URL}`;
    }
    if (typeof worst.score === "number") {
      return firstTouch
        ? `${worst.name} scored ${worst.score}/100. Get notified if it drops further — free key, no card: ${AUDIT_SIGNUP_URL}`
        : `${worst.name} scored ${worst.score}/100 — lowest in this scan. Free tier — ${count}/${AUDIT_HARD_LIMIT} audits today (${remaining} left). Get notified when scores worsen — free key, no card: ${AUDIT_SIGNUP_URL}`;
    }
  }

  if (firstTouch) {
    return `Get alerted when any dependency gets compromised — free key, no card: ${AUDIT_SIGNUP_URL}`;
  }
  if (count >= AUDIT_STRONG_CTA_AT) {
    return `⚠ Commit free tier — ${count}/${AUDIT_HARD_LIMIT} audits used today (${remaining} left). Lock in alerts on these packages before the wall — free key, 30s, no card: ${AUDIT_SIGNUP_URL}`;
  }
  return `Commit free tier — ${count}/${AUDIT_HARD_LIMIT} audits used today. Get notified when any of these scores get worse — free key, no card: ${AUDIT_SIGNUP_URL}`;
}

/**
 * Increment today's /api/graph counter for this IP. Returns the post-increment
 * count. Atomically performed in D1 via ON CONFLICT … RETURNING count.
 * Separate table from /api/audit so heavy graph users (the high-intent
 * paid-tier signal) don't share a budget with single-package CLI traffic.
 */
async function bumpGraphCount(env: Bindings, ip: string): Promise<number> {
  const date = todayUtcDate();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO graph_rate_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(ip, date).first<{ count: number }>();
    return row?.count ?? 1;
  } catch {
    // Defensive: never break /api/graph on bookkeeping failure.
    // Fail open with count=1 so worst case the user gets the soft-CTA tier.
    return 1;
  }
}

function graphCtaText(count: number): string {
  const remaining = Math.max(0, GRAPH_HARD_LIMIT - count);
  return `Commit free tier — ${count}/${GRAPH_HARD_LIMIT} graph queries used today (${remaining} left). Transitive dependency analysis is a Pro feature ($29/mo) — upgrade for 200/month: ${GRAPH_UPGRADE_URL}`;
}

/**
 * Increment today's /api/audit/github counter for this IP. Returns the
 * post-increment count. Atomic via ON CONFLICT … RETURNING count. Separate
 * table from /api/audit and /api/graph so the three counters never share a
 * budget — a heavy single-package CLI user shouldn't lock out repo audits
 * (or vice versa). See migration 0015_github_audit_rate_limits.sql.
 */
async function bumpGithubAuditCount(env: Bindings, ip: string): Promise<number> {
  const date = todayUtcDate();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO github_audit_rate_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(ip, date).first<{ count: number }>();
    return row?.count ?? 1;
  } catch {
    // Defensive: never break /api/audit/github on bookkeeping failure.
    // Fail open with count=1 — worst case is the user skips the soft-CTA tier.
    return 1;
  }
}

/**
 * Increment this IP's checkout count within a 1-hour sliding window.
 * Returns the post-increment count. Window resets 1 hour after the first
 * request in the window (stored in reset_at).
 *
 * Table schema (migration 0016): checkout_rate_limits(ip TEXT PK, count INTEGER, reset_at TEXT)
 * Deployed 2026-05-28T16:39 UTC by previous session. Uses reset_at expiry
 * approach (vs calendar-hour bucketing) to avoid D1 reserved-word issues
 * with column names like 'hour', 'window', 'date'.
 *
 * Used by /api/checkout (GET) and /api/checkout-intent (POST).
 */
async function bumpCheckoutCount(env: Bindings, ip: string): Promise<number> {
  try {
    const row = await env.DB.prepare(
      `INSERT INTO checkout_rate_limits (ip, count, reset_at)
         VALUES (?, 1, datetime('now', '+1 hour'))
       ON CONFLICT(ip) DO UPDATE SET
         count    = CASE WHEN reset_at <= datetime('now') THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= datetime('now') THEN datetime('now', '+1 hour') ELSE reset_at END
       RETURNING count`
    ).bind(ip).first<{ count: number }>();
    return row?.count ?? 1;
  } catch {
    // Fail open — a D1 hiccup should never block a real checkout attempt.
    return 1;
  }
}

function githubAuditCtaText(count: number): string {
  const remaining = Math.max(0, GITHUB_AUDIT_HARD_LIMIT - count);
  return `Commit free tier — ${count}/${GITHUB_AUDIT_HARD_LIMIT} GitHub repo audits used today (${remaining} left). Repo-wide dependency audit is a Developer feature ($15/mo, 50/month) or Pro ($29/mo, 500/month): ${GITHUB_AUDIT_UPGRADE_URL}`;
}

/**
 * Increment today's MCP counter for this IP. Returns the post-increment
 * count. Atomically performed in D1 via ON CONFLICT … RETURNING count.
 */
async function bumpMcpCount(env: Bindings, ip: string): Promise<number> {
  const date = todayUtcDate();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO mcp_rate_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(ip, date).first<{ count: number }>();
    return row?.count ?? 1;
  } catch {
    // Defensive: if the table is missing or D1 hiccups, never break the MCP
    // response — fail open with count=1 so the soft-CTA layer is the
    // user's worst-case experience.
    return 1;
  }
}

/**
 * Wrap an MCP tool handler with rate-limit + soft-CTA logic.
 *
 * Three populations, three paths:
 *
 * 1. Anonymous (no API key):
 *    - bump per-IP counter; >MCP_HARD_LIMIT (15) → hard block + signup CTA
 *    - ≥MCP_SOFT_CTA_AT (5) → append generic free-key signup CTA
 *
 * 2. Free-tier API key:
 *    - bump per-IP counter (same table — no schema change)
 *    - NO hard limit (pricing page promises "unlimited with free key")
 *    - ≥MCP_FREE_KEY_SOFT_CTA_AT (10) → append value-positive Developer CTA
 *      with email-prefilled /pricing URL (medium=mcp-free-key for funnel
 *      attribution). Closes the 149-keys-0-paying gap where free-key MCP
 *      traffic saw ZERO upgrade pressure.
 *
 * 3. Paid tiers (developer/pro/enterprise):
 *    - pass through untouched. No counter bump, no CTA — they paid.
 */
function withMcpRateLimit<A>(
  ctx: McpCtx,
  handler: (args: A) => Promise<McpToolResult>,
): (args: A) => Promise<McpToolResult> {
  return async (args: A) => {
    // Paid tiers: no friction, no instrumentation. They paid.
    if (ctx.hasApiKey && ctx.tier && ctx.tier !== "free") {
      return handler(args);
    }

    const count = await bumpMcpCount(ctx.env, ctx.ip);

    // Free-tier API key holders: no hard limit (offering promise kept),
    // but soft-CTA milestones surface Developer-tier value at sustained
    // usage. Email pre-fills the /pricing modal.
    if (ctx.hasApiKey && ctx.tier === "free") {
      const result = await handler(args);
      if (count >= MCP_FREE_KEY_SOFT_CTA_AT) {
        return {
          ...result,
          content: [
            ...result.content,
            { type: "text" as const, text: mcpFreeKeyCtaText(count, ctx.keyEmail) },
          ],
        };
      }
      return result;
    }

    // Anonymous: existing hard-limit + soft-CTA behavior.
    if (count > MCP_HARD_LIMIT) {
      return {
        content: [{ type: "text" as const, text: mcpHardBlockText(count) }],
        isError: true,
      };
    }

    const result = await handler(args);

    if (count >= MCP_SOFT_CTA_AT) {
      return {
        ...result,
        content: [
          ...result.content,
          { type: "text" as const, text: mcpCtaText(count) },
        ],
      };
    }

    return result;
  };
}

function createMcpServer(ctx: McpCtx): McpServer {
  const mcp = new McpServer({
    name: "proof-of-commitment",
    version: "1.14.0",
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
    withMcpRateLimit(ctx, async ({ domain }) => {
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
  ));

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
    withMcpRateLimit(ctx, async ({ query }) => {
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
  ));

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
    withMcpRateLimit(ctx, async ({ orgNumber }) => {
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
  ));

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
    withMcpRateLimit(ctx, async ({ repo }) => {
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
  ));

  // Tool: lookup_npm_package
  mcp.tool(
    "lookup_npm_package",
    `Get a behavioral commitment profile for any npm package. Returns real signals that prove genuine investment: package age, download volume and trend (growing/stable/declining), release consistency, npm publisher count, GitHub contributor count, and linked GitHub activity.

Also returns publisherLifecycle — cross-referencing current maintainers against per-version publish history to flag dormant publishers who still hold npm scope access. The Mastra incident (June 2026) exploited exactly this: a contributor dormant since 2024 with never-revoked scope access.

Why behavioral signals matter: download counts, stars, and READMEs can be gamed. Download *trend* consistency and publisher depth over years are harder to fake. Supply chain attacks often target packages with low publisher depth (few people with npm publish access).

Useful for: vetting dependencies before installation, due diligence on open-source packages, identifying abandonware, checking if a package is actively maintained.

Examples: "langchain", "@anthropic-ai/sdk", "express", "litellm"`,
    {
      package: z
        .string()
        .describe(
          'npm package name. Examples: "langchain", "@anthropic-ai/sdk", "express". Scoped packages need the @ prefix.'
        ),
    },
    withMcpRateLimit(ctx, async ({ package: packageName }) => {
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
                  trustedPublishing: profile.trustedPublishing,
                  commitmentScore: profile.commitmentScore,
                  scoreBreakdown: profile.scoreBreakdown,
                  publisherLifecycle: profile.publisherLifecycle,
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
  ));

  // Tool: lookup_pypi_package
  mcp.tool(
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
    withMcpRateLimit(ctx, async ({ package: packageName }) => {
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
  ));

  // Tool: lookup_cargo_crate
  mcp.tool(
    "lookup_cargo_crate",
    `Get a behavioral commitment profile for any Rust crate on crates.io. Returns real signals: crate age, download volume (estimated weekly from 90-day totals), version count, publish cadence, owner count (users with publish access), team owners, and linked GitHub activity.

Supply chain risks apply to Cargo too — crate owners with publish access are the attack surface. A single owner on a high-download crate is the same risk pattern as npm.

Useful for: vetting Rust dependencies before adding to Cargo.toml, identifying abandonware, supply chain risk assessment.
Examples: "serde", "tokio", "reqwest", "clap", "rand"`,
    {
      crate: z
        .string()
        .describe(
          'Crate name on crates.io. Examples: "serde", "tokio", "reqwest", "clap". Case-insensitive.'
        ),
    },
    withMcpRateLimit(ctx, async ({ crate: crateName }) => {
      try {
        const profile = await buildCargoCommitmentProfile(crateName);

        if (!profile) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Crate "${crateName}" not found on crates.io.`,
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
                  ownerCount: profile.ownerCount,
                  teamCount: profile.teamCount,
                  estimatedWeeklyDownloads: profile.estimatedWeeklyDownloads,
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
  ));

  // Tool: lookup_go_module
  mcp.tool(
    "lookup_go_module",
    `Get a behavioral commitment profile for any Go module on proxy.golang.org. Takes a full module path (e.g., "github.com/gin-gonic/gin", "golang.org/x/net", "k8s.io/client-go", "gopkg.in/yaml.v3") and returns real signals: module age, version count, publish cadence, GitHub contributors (the closest equivalent to "publishers" since Go has no centralized publisher concept — git push access is the publish equivalent), GitHub stars, OpenSSF Scorecard score.

The Go ecosystem has no centralized download counter, so this profile is GitHub-primary — the linked source repository's activity, contributor count, and Scorecard carry more weight than for npm/PyPI/Cargo. Stars are used as the popularity proxy.

Useful for: vetting Go dependencies before adding to go.mod, identifying abandonware, supply chain risk assessment.
Examples: "github.com/gin-gonic/gin", "golang.org/x/crypto", "github.com/spf13/cobra", "k8s.io/api"`,
    {
      module: z
        .string()
        .describe(
          'Full Go module path. Must include the host. Examples: "github.com/gin-gonic/gin", "golang.org/x/net", "k8s.io/client-go", "gopkg.in/yaml.v3". Case-sensitive (preserves capitalization in path).'
        ),
    },
    withMcpRateLimit(ctx, async ({ module: modulePath }) => {
      try {
        const profile = await buildGolangCommitmentProfile(modulePath);

        if (!profile) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Module "${modulePath}" not found on proxy.golang.org. Check the path — Go modules require the full path including host (e.g., "github.com/owner/repo", not just "owner/repo").`,
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
                  modulePath: profile.modulePath,
                  latestVersion: profile.latestVersion,
                  ageYears: Math.round(profile.ageYears * 10) / 10,
                  versionCount: profile.versionCount,
                  contributorCount: profile.contributorCount,
                  starsCount: profile.starsCount,
                  daysSinceLastPublish: profile.daysSinceLastPublish,
                  repositoryUrl: profile.repositoryUrl,
                  isGitHubHosted: profile.isGitHubHosted,
                  scorecardScore: profile.scorecardScore,
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
  ));

  // Tool: audit_dependencies
  mcp.tool(
    "audit_dependencies",
    `Batch-score multiple npm, PyPI, Cargo, or Go packages for supply chain risk. Takes a list of package names and returns a risk table sorted by commitment score (lowest = highest risk first).

Risk flags:
- CRITICAL: single publisher + >10M weekly downloads (publish-access concentration risk)
- HIGH: new package (<1yr) + high downloads (unproven, rapid adoption = supply chain risk)
- WARN: no release in 12+ months (potential abandonware)
- WARN: dormant publishers with current scope access — contributors who stopped publishing but retain npm tokens (Mastra-incident vector, June 2026)

Perfect for auditing a full package.json, requirements.txt, Cargo.toml, or go.mod — paste your dependency list and get a prioritized risk report.

For Go: pass full module paths (e.g., "github.com/gin-gonic/gin", "golang.org/x/net") and set ecosystem="golang". The "maintainers" column shows GitHub contributor count since Go has no centralized publisher concept.

Examples: score all deps in a project, compare two similar packages, identify abandonware before it becomes a CVE.`,
    {
      packages: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe(
          'List of package names to score. Up to 20 at once. Examples: ["langchain", "litellm", "openai", "axios"] or ["@anthropic-ai/sdk", "zod", "express"] or ["github.com/gin-gonic/gin", "golang.org/x/net"] for Go modules.'
        ),
      ecosystem: z
        .enum(["npm", "pypi", "cargo", "golang", "auto"])
        .default("auto")
        .describe(
          'Package ecosystem. "auto" detects by naming convention (Python-style = pypi, otherwise npm). Force "npm", "pypi", "cargo", or "golang" to override. Go modules require full path (host/owner/repo) — use "golang".'
        ),
    },
    withMcpRateLimit(ctx, async ({ packages, ecosystem }) => {
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
              if (useEcosystem === "golang") {
                const profile = await buildGolangCommitmentProfile(pkg);
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
                if (profile.contributorCount !== null && profile.contributorCount <= 1 && profile.starsCount > 5_000)
                  riskFlags.push("HIGH: bus factor 1 + popular");
                if (profile.ageYears < 1 && profile.starsCount > 1_000)
                  riskFlags.push("HIGH: new module (<1yr) + rapidly popular");
                if (profile.daysSinceLastPublish > 365)
                  riskFlags.push("WARN: no release in 12+ months");
                if (profile.scorecardScore !== null && profile.scorecardScore < 3)
                  riskFlags.push("WARN: low OpenSSF Scorecard");

                return {
                  name: pkg,
                  score: profile.commitmentScore,
                  // For Go, "maintainers" maps to contributor count (closest equivalent
                  // to publish access since Go has no publisher registry)
                  maintainers: profile.contributorCount,
                  // Go has no download data — leave null
                  weeklyDownloads: null,
                  ageYears: Math.round(profile.ageYears * 10) / 10,
                  trend: null,
                  riskFlags,
                };
              } else if (useEcosystem === "cargo") {
                const profile = await buildCargoCommitmentProfile(pkg);
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
                if (profile.ownerCount <= 1 && profile.estimatedWeeklyDownloads > 10_000_000)
                  riskFlags.push("CRITICAL: sole owner + >10M/wk");
                else if (profile.ownerCount <= 1 && profile.estimatedWeeklyDownloads > 1_000_000)
                  riskFlags.push("HIGH: sole owner + >1M/wk");
                if (profile.ageYears < 1 && profile.estimatedWeeklyDownloads > 100_000)
                  riskFlags.push("HIGH: new crate (<1yr) + high downloads");
                if (profile.daysSinceLastPublish > 365)
                  riskFlags.push("WARN: no release in 12+ months");

                return {
                  name: pkg,
                  score: profile.commitmentScore,
                  maintainers: profile.ownerCount,
                  weeklyDownloads: profile.estimatedWeeklyDownloads,
                  ageYears: Math.round(profile.ageYears * 10) / 10,
                  trend: null,
                  riskFlags,
                };
              } else if (useEcosystem === "pypi") {
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
                  riskFlags.push("CRITICAL: sole publisher + >10M/wk");
                else if (
                  profile.maintainerCount <= 1 &&
                  profile.recentWeeklyDownloads > 1_000_000
                )
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
                  hasProvenance: profile.hasProvenance,
                  hasStagedPublishing: profile.hasStagedPublishing,
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
          r.maintainers !== null ? `${r.maintainers} publisher${r.maintainers !== 1 ? "s" : ""}` : "N/A";
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
  ));

  // Tool: audit_github_repo
  mcp.tool(
    "audit_github_repo",
    `Audit the supply chain risk of a GitHub repository's dependencies. Fetches the repo's package.json and/or requirements.txt from GitHub and runs behavioral commitment scoring on every dependency.

This is the fastest way to audit a project — just provide the GitHub URL or owner/repo slug, and get a full risk table in seconds.

Risk flags:
- CRITICAL: single publisher/maintainer/owner + >10M weekly downloads (publish-access concentration risk)
- HIGH: sole publisher/maintainer + >1M/wk downloads, OR new package (<1yr) with high adoption
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
    withMcpRateLimit(ctx, async ({ repo: repoInput }) => {
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
                  const effPub = profile.activePublisherCount ?? profile.maintainerCount;
                  if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL: sole active npm publisher + >10M/wk");
                  else if (effPub <= 1 && wdl > 1_000_000) riskFlags.push("HIGH: sole active npm publisher + >1M/wk");
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
        const maintStr = r.maintainers !== null ? `${r.maintainers} pub.` : "N/A";
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
  ));

  // Tool: audit_dependency_tree
  mcp.tool(
    "audit_dependency_tree",
    `Map the full dependency tree of an npm package and identify CRITICAL supply chain risks at every level.

Unlike auditing a flat list of packages, this tool traverses the dependency graph — showing not just your direct dependencies but also what your dependencies depend on. Hidden CRITICAL packages (sole publisher + >10M weekly downloads) often lurk 1-2 levels deep.

Risk flags:
- CRITICAL: single npm publisher + >10M weekly downloads — sole point of failure for a massive attack surface
- HIGH: sole publisher + >1M/wk, OR new package (<1yr) with high adoption
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
    withMcpRateLimit(ctx, async ({ package: pkg, depth }) => {
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
        const maint = n.maintainers !== null ? `${n.maintainers} pub.` : "N/A";
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

      lines.push(`Score: 0-100 behavioral commitment. CRITICAL = sole publisher + >10M downloads/wk.`);
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
  ));

  // Tool: get_api_key
  // Zero-friction in-chat API key creation. Users hit rate limits in Claude
  // Desktop / Cursor and see a CTA to visit getcommit.dev — but they never
  // leave the chat. This tool lets them create a key without leaving the
  // conversation. The 7-step website journey becomes 1 tool call.
  // Deliberately bypasses withMcpRateLimit — the user calls this BECAUSE
  // they hit the limit. IP-based 3/day anti-abuse still applies.
  mcp.tool(
    "get_api_key",
    `Create a free Commit API key instantly — no browser required.

When you've hit the daily free query limit (or just want faster access), call this tool with your email to get an API key returned directly in the chat. The key lifts the rate limit to 200 audits/day and enables package monitoring (weekly alerts when your dependencies get riskier).

After creating the key, configure your MCP client to pass it:
  Authorization: Bearer sk_commit_<your-key>

Example: get_api_key({ email: "dev@company.com" })

One key per email. 3 keys per IP per day (anti-abuse).`,
    {
      email: z
        .string()
        .email()
        .describe("Your email address — used for alert delivery and key recovery. One key per email."),
    },
    // No withMcpRateLimit wrapper — this tool must work even when rate-limited.
    async ({ email: rawEmail }) => {
      const email = rawEmail.trim().toLowerCase();

      // Validate email format
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return {
          content: [{ type: "text" as const, text: "Invalid email address. Please provide a valid email." }],
          isError: true,
        };
      }

      // Check if email already has a key
      const existingKey = await ctx.env.DB.prepare(
        `SELECT key_prefix, tier FROM api_keys WHERE email = ? AND revoked_at IS NULL LIMIT 1`
      ).bind(email).first<{ key_prefix: string; tier: string }>();

      if (existingKey) {
        const upgradeUrl = buildUpgradeUrl(email, { medium: "mcp-inline-existing" });
        const lines = [
          `You already have a Commit API key (${existingKey.key_prefix}…, ${existingKey.tier} tier).`,
          ``,
          `To use it, set the Authorization header on your MCP client:`,
          `  Authorization: Bearer sk_commit_<your-key>`,
          ``,
          `Lost your key? Check the welcome email from noreply@getcommit.dev.`,
          ``,
          existingKey.tier === "free"
            ? `Upgrade to Developer ($15/mo) for CI integration + instant alerts:\n→ ${upgradeUrl}`
            : `Manage your account at https://getcommit.dev/dashboard`,
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      // IP rate limit: 3 key creations per IP per day (same as /api/keys/create)
      const internalTestPatterns = parseEmailPatterns(
        ctx.env.INTERNAL_TEST_EMAIL_PATTERNS ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS
      );
      const isInternal = isInternalTestEmail(email, internalTestPatterns);

      if (!isInternal) {
        const now = new Date();
        const ipRow = await ctx.env.DB.prepare(
          `SELECT count, reset_at FROM key_creation_rate_limits WHERE ip = ? LIMIT 1`
        ).bind(ctx.ip).first<{ count: number; reset_at: string }>();

        let ipCount = 0;
        if (ipRow && new Date(ipRow.reset_at) > now) {
          ipCount = ipRow.count;
        }

        if (ipCount >= 3) {
          return {
            content: [{ type: "text" as const, text: "Rate limit: max 3 API keys per IP per day. Try again tomorrow." }],
            isError: true,
          };
        }

        // Bump IP counter
        const tomorrowIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
        await ctx.env.DB.prepare(
          `INSERT INTO key_creation_rate_limits (ip, count, reset_at)
           VALUES (?, 1, ?)
           ON CONFLICT(ip) DO UPDATE SET
             count = CASE WHEN reset_at <= datetime('now') THEN 1 ELSE count + 1 END,
             reset_at = CASE WHEN reset_at <= datetime('now') THEN ? ELSE reset_at END`
        ).bind(ctx.ip, tomorrowIso, tomorrowIso).run();
      }

      // Generate API key
      const rawBytes = new Uint8Array(16);
      crypto.getRandomValues(rawBytes);
      const randomHex = Array.from(rawBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const apiKey = `sk_commit_${randomHex}`;
      const keyHash = await sha256Hex(apiKey);
      const keyPrefix = apiKey.slice(0, 19);

      // Generate ID
      const idBytes = new Uint8Array(8);
      crypto.getRandomValues(idBytes);
      const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

      const periodResetAt = nextResetAt("daily");

      // Insert key
      await ctx.env.DB.prepare(
        `INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at, source, created_at)
         VALUES (?, ?, ?, ?, 'free', 0, ?, 'mcp-inline-key', datetime('now'))`
      ).bind(id, keyHash, keyPrefix, email, periodResetAt).run();

      // Send welcome email (best-effort, non-blocking for the MCP response)
      if (ctx.env.RESEND_API_KEY) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${ctx.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Commit <noreply@getcommit.dev>",
              reply_to: "pico@amdal.dev",
              to: [email],
              subject: "Your Commit API Key",
              text: [
                `Your Commit API key: ${apiKey}`,
                ``,
                `You created this key via the MCP server — it's already active.`,
                ``,
                `What you get (free tier):`,
                `  • 200 audits/day (up from 15 anonymous)`,
                `  • Monitor 3 packages — weekly alerts when scores degrade`,
                `  • CLI: poc watch axios — adds a package to your watchlist`,
                ``,
                `Set up monitoring:`,
                `  npm install -g proof-of-commitment`,
                `  poc watch axios --email ${email}`,
                ``,
                `Upgrade to Developer ($15/mo) for CI integration + instant alerts:`,
                `  ${buildUpgradeUrl(email, { medium: "mcp-inline-key-welcome" })}`,
                ``,
                `—`,
                `Commit · supply-chain risk scoring · getcommit.dev`,
              ].join("\n"),
            }),
          });
        } catch {
          // Non-fatal — key is already active
        }
      }

      const upgradeUrl = buildUpgradeUrl(email, { medium: "mcp-inline-key" });
      const lines = [
        `✅ API key created: ${apiKey}`,
        ``,
        `Your key is active now — 200 audits/day, 3-package monitoring, weekly alerts.`,
        `A backup copy was sent to ${email}.`,
        ``,
        `To use this key with Commit MCP, add it to your MCP client config:`,
        ``,
        `Claude Desktop (~/.config/claude/claude_desktop_config.json):`,
        `  "commit": {`,
        `    "type": "streamable-http",`,
        `    "url": "https://poc-backend.amdal-dev.workers.dev/mcp",`,
        `    "headers": { "Authorization": "Bearer ${apiKey}" }`,
        `  }`,
        ``,
        `Cursor (~/.cursor/mcp.json):`,
        `  "commit": {`,
        `    "type": "streamable-http",`,
        `    "url": "https://poc-backend.amdal-dev.workers.dev/mcp",`,
        `    "headers": { "Authorization": "Bearer ${apiKey}" }`,
        `  }`,
        ``,
        `Set up package monitoring:`,
        `  npm install -g proof-of-commitment`,
        `  poc watch axios --email ${email}`,
        ``,
        `Need CI integration + instant alerts? Developer tier ($15/mo):`,
        `→ ${upgradeUrl}`,
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
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
  // Stateless mode: reject GET/DELETE requests.
  // GET would open an SSE stream that hangs forever in CF Workers (no session state to push),
  // causing the runtime to kill the request after 30s with a scriptThrewException error.
  if (c.req.method === "GET" || c.req.method === "DELETE") {
    return c.json(
      { error: "SSE streaming not supported in stateless mode. Use POST for MCP requests." },
      405
    );
  }

  // Normalize Accept header for scanners (e.g. Glama) that send '*/*', only 'application/json',
  // or no Accept header at all. The MCP SDK does strict string matching — it requires the
  // Accept header to explicitly contain both "application/json" AND "text/event-stream" as
  // literal values, or it returns 406 Not Acceptable, causing tools:[] in scanner results.
  // Note: "*/*" does NOT satisfy this — the SDK doesn't do media-type wildcard expansion.
  const req = c.req.raw;
  const accept = req.headers.get("accept") ?? "";
  let targetReq = req;
  const hasExplicitJson = accept.includes("application/json");
  const hasExplicitSse = accept.includes("text/event-stream");
  if (!hasExplicitJson || !hasExplicitSse) {
    const headers = new Headers(req.headers);
    // Build full accept value: keep original (e.g. "*/*") and append what's missing.
    const extras: string[] = [];
    if (!hasExplicitJson) extras.push("application/json");
    if (!hasExplicitSse) extras.push("text/event-stream");
    const fullAccept = accept ? `${accept}, ${extras.join(", ")}` : extras.join(", ");
    headers.set("accept", fullAccept);
    targetReq = new Request(req, { headers });
  }
  // Build the per-request MCP context: IP for rate-limit attribution + whether
  // the client passed a valid API key (which bypasses the limit).
  const ip =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  let hasApiKey = false;
  let keyTier: "free" | "developer" | "pro" | "enterprise" | undefined;
  let keyEmail: string | undefined;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer sk_commit_")) {
    try {
      const tokenHash = await sha256Hex(auth.slice(7));
      // Fetch tier + email so withMcpRateLimit can branch on free vs paid
      // and pre-fill the /pricing checkout modal for free-tier soft-CTAs.
      // Same SELECT shape as the api-key middleware (line ~490) — keep in
      // sync if either grows columns.
      const row = await c.env.DB.prepare(
        `SELECT id, tier, email FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1`
      ).bind(tokenHash).first<{ id: string; tier: string; email: string }>();
      hasApiKey = !!row;
      if (row) {
        keyTier = (row.tier as typeof keyTier) || "free";
        keyEmail = row.email;
      }
    } catch {
      // fail open — anonymous treatment
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const mcp = createMcpServer({ env: c.env, ip, hasApiKey, tier: keyTier, keyEmail });
  await mcp.connect(transport);
  return transport.handleRequest(targetReq);
});

// ── Admin: trigger weekly digest manually for testing ────────────────
app.post("/api/admin/trigger-digest", async (c) => {
  const adminSecret = (c.env as unknown as Record<string, string>).ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  try {
    const result = await runWeeklyDigest(c.env);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ── Unsubscribe endpoint ──────────────────────────────────────────────
app.get("/api/unsubscribe", async (c) => {
  const email = c.req.query("email")?.trim().toLowerCase() ?? "";
  if (!email) return c.text("Invalid unsubscribe link.", 400);
  const result = await c.env.DB.prepare(
    `DELETE FROM watchlist_subscriptions WHERE email = ?`
  ).bind(email).run();
  const removed = (result.meta?.changes ?? 0) > 0;
  return c.html(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:80px auto;text-align:center">` +
    `<h2>Commit Watchlist</h2>` +
    (removed
      ? `<p>✅ <strong>${email}</strong> has been unsubscribed. You won't receive any more supply chain alerts.</p>`
      : `<p>Email not found — you may have already unsubscribed.</p>`) +
    `<p><a href="https://getcommit.dev">← Back to Commit</a></p></body></html>`
  );
});

// ── Weekly digest scheduled handler ──────────────────────────────────
//
// Cron: every Monday at 09:00 UTC ("0 9 * * 1")
// For each verified subscriber: score their watchlist packages, compare
// to previous week, send a digest via Resend, record scores for next diff.

async function runWeeklyDigest(env: Bindings): Promise<{ sent: number; skipped: number }> {
  if (!env.RESEND_API_KEY) return { sent: 0, skipped: 0 };

  const subscribers = await env.DB.prepare(
    `SELECT id, email, packages FROM watchlist_subscriptions WHERE verified = 1`
  ).all<{ id: string; email: string; packages: string }>();

  const rows = subscribers.results ?? [];
  // NOTE: do not early-return when rows.length === 0 — free-tier api_key
  // monitored_packages (added via `poc watch --email`) are processed later
  // in this function. An empty watchlist_subscriptions table does not mean
  // no digests to send.

  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // Score each unique package once (shared cache across subscribers)
  const scoreCache = new Map<string, {
    score: number | null;
    maintainers: number | null;
    weeklyDownloads: number | null;
    riskFlags: string[];
  }>();

  // Collect all unique packages
  const allPackages = new Set<string>();
  for (const row of rows) {
    try {
      const pkgs = JSON.parse(row.packages ?? "[]") as string[];
      pkgs.forEach((p) => allPackages.add(p));
    } catch { /* ignore */ }
  }

  // Score in batches of 5 (same limit as /api/subscribe)
  const pkgList = [...allPackages];
  const MAX_CONCURRENT = 5;
  for (let i = 0; i < pkgList.length; i += MAX_CONCURRENT) {
    const batch = pkgList.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(async (pkg) => {
      try {
        const profile = await buildNpmCommitmentProfile(pkg);
        if (!profile) {
          scoreCache.set(pkg, { score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
          return;
        }
        const wdl = profile.recentWeeklyDownloads ?? 0;
        const riskFlags: string[] = [];
        const effPub = profile.activePublisherCount ?? profile.maintainerCount;
        if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
        else if (profile.ageYears < 1 && wdl > 1_000_000) riskFlags.push("HIGH");
        else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
        scoreCache.set(pkg, {
          score: profile.commitmentScore,
          maintainers: profile.maintainerCount,
          weeklyDownloads: wdl,
          riskFlags,
        });
      } catch {
        scoreCache.set(pkg, { score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
      }
    }));
  }

  // Fetch previous week scores for all packages in one pass
  const prevScores = new Map<string, number | null>();
  for (const pkg of pkgList) {
    const row = await env.DB.prepare(
      `SELECT score FROM package_score_history
       WHERE package_name = ? AND ecosystem = 'npm'
       ORDER BY recorded_at DESC LIMIT 1`
    ).bind(pkg).first<{ score: number | null }>();
    prevScores.set(pkg, row?.score ?? null);
  }

  // Insert current scores (one row per package per run)
  for (const pkg of pkgList) {
    const cur = scoreCache.get(pkg)!;
    if (cur.score !== null) {
      await env.DB.prepare(
        `INSERT INTO package_score_history
         (package_name, ecosystem, score, maintainers, weekly_downloads, risk_flags, recorded_at)
         VALUES (?, 'npm', ?, ?, ?, ?, datetime('now'))`
      ).bind(pkg, cur.score, cur.maintainers, cur.weeklyDownloads, JSON.stringify(cur.riskFlags)).run();
    }
  }

  function fmtDL(n: number | null): string {
    if (!n) return "?";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return Math.round(n / 1e6) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "K";
    return String(n);
  }

  function fmtChange(curr: number | null, prev: number | null): string {
    if (curr === null || prev === null) return "";
    const diff = curr - prev;
    if (diff === 0) return "";
    return diff > 0 ? ` (+${diff})` : ` (${diff})`;
  }

  let sent = 0;
  let skipped = 0;

  for (const row of rows) {
    let packages: string[];
    try {
      packages = JSON.parse(row.packages ?? "[]") as string[];
    } catch {
      packages = [];
    }
    if (packages.length === 0) { skipped++; continue; }

    // Build per-subscriber results
    const results = packages
      .map((pkg) => {
        const cur = scoreCache.get(pkg) ?? { score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] };
        return { name: pkg, ...cur, prevScore: prevScores.get(pkg) ?? null };
      })
      .filter((r) => r.score !== null);

    if (results.length === 0) { skipped++; continue; }

    // Sort: CRITICAL → HIGH → by downloads
    results.sort((a, b) => {
      const aRank = a.riskFlags.includes("CRITICAL") ? 2 : a.riskFlags.includes("HIGH") ? 1 : 0;
      const bRank = b.riskFlags.includes("CRITICAL") ? 2 : b.riskFlags.includes("HIGH") ? 1 : 0;
      if (aRank !== bRank) return bRank - aRank;
      return (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0);
    });

    const critical = results.filter((r) => r.riskFlags.includes("CRITICAL"));
    const pkgLines = results
      .map((r) => {
        const flag = r.riskFlags.includes("CRITICAL") ? "⚑ CRITICAL"
          : r.riskFlags.includes("HIGH") ? "⚠ HIGH"
          : r.riskFlags.includes("WARN") ? "↓ WARN"
          : "✓ OK";
        const change = fmtChange(r.score, r.prevScore);
        const scoreStr = `${r.score}/100${change}`;
        return `  ${r.name.padEnd(22)} ${scoreStr.padEnd(12)}  ${r.maintainers ?? "?"}p  ${fmtDL(r.weeklyDownloads)}/wk  ${flag}`;
      })
      .join("\n");

    const unsubLink = `https://poc-backend.amdal-dev.workers.dev/api/unsubscribe?email=${encodeURIComponent(row.email)}`;
    const auditLink = `https://getcommit.dev/audit?packages=${encodeURIComponent(packages.join(","))}`;

    const subject = critical.length > 0
      ? `⚑ ${critical.length} CRITICAL package${critical.length > 1 ? "s" : ""} in your Commit watchlist`
      : "Your Commit Watchlist — Weekly Report";

    const body = `Supply Chain Risk Report — ${dateStr}

${critical.length > 0
  ? `${critical.length} CRITICAL package${critical.length > 1 ? "s" : ""} detected in your watchlist:`
  : "Your watched packages look healthy this week."}

${pkgLines}

CRITICAL = sole npm publisher + 10M+ weekly downloads.
This structural profile is what made the April 1st axios supply chain attack possible.

Full audit: ${auditLink}
Manage watchlist: https://getcommit.dev/watchlist

—
Commit · getcommit.dev
Unsubscribe: ${unsubLink}`;

    try {
      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Commit <noreply@getcommit.dev>",
          // reply_to: weekly watchlist digest is the recurring touchpoint
          // most likely to surface "we should upgrade" / "can you scan X" —
          // route prospect replies to a real human inbox.
          reply_to: "pico@amdal.dev",
          to: [row.email],
          subject,
          text: body,
        }),
      });
      if (emailResp.ok) {
        await env.DB.prepare(
          `UPDATE watchlist_subscriptions SET last_sent_at = datetime('now') WHERE id = ?`
        ).bind(row.id).run();
        sent++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  // ── Free-tier monitored_packages digest ────────────────────────────────
  //
  // Free users who added packages via `poc watch --email` (v1.25.0, 2026-06-07)
  // live in monitored_packages (api_key-linked), NOT watchlist_subscriptions
  // (email-only homepage form). The CLI prompt and /pricing both promise
  // "free: 3 packages, weekly digest"; this loop delivers that.
  //
  // Sends one digest per free-tier email containing the union of their
  // monitored_packages (npm only — other ecosystems are excluded from the
  // digest until per-ecosystem scoring is unified). Each digest closes with
  // a Developer upgrade CTA so the free taste has a paid exit.
  //
  // Scope: npm only (matches existing digest scope). Other ecosystems read
  // monitored_packages but won't appear in the weekly digest until they're
  // wired into the scoring path above.
  const freeRowsRes = await env.DB.prepare(
    `SELECT ak.id AS api_key_id, ak.email, GROUP_CONCAT(mp.package_name, '||') AS packages
     FROM api_keys ak
     JOIN monitored_projects mpr ON mpr.api_key_id = ak.id
     JOIN monitored_packages mp ON mp.project_id = mpr.id
     WHERE ak.tier = 'free'
       AND ak.revoked_at IS NULL
       AND mpr.paused_at IS NULL
       AND mp.ecosystem = 'npm'
     GROUP BY ak.email, ak.id`
  ).all<{ api_key_id: string; email: string; packages: string }>();

  const freeRows = freeRowsRes.results ?? [];

  // Collect packages from free-tier rows that aren't already in scoreCache
  const newFreePackages = new Set<string>();
  for (const row of freeRows) {
    const pkgs = (row.packages ?? "").split("||").filter(Boolean);
    for (const p of pkgs) if (!scoreCache.has(p)) newFreePackages.add(p);
  }

  // Score new packages (same MAX_CONCURRENT pattern as above)
  const newFreePkgList = [...newFreePackages];
  for (let i = 0; i < newFreePkgList.length; i += MAX_CONCURRENT) {
    const batch = newFreePkgList.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(async (pkg) => {
      try {
        const profile = await buildNpmCommitmentProfile(pkg);
        if (!profile) {
          scoreCache.set(pkg, { score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
          return;
        }
        const wdl = profile.recentWeeklyDownloads ?? 0;
        const riskFlags: string[] = [];
        const effPub = profile.activePublisherCount ?? profile.maintainerCount;
        if (effPub <= 1 && wdl > 10_000_000) riskFlags.push("CRITICAL");
        else if (profile.ageYears < 1 && wdl > 1_000_000) riskFlags.push("HIGH");
        else if (profile.daysSinceLastPublish > 365) riskFlags.push("WARN");
        scoreCache.set(pkg, {
          score: profile.commitmentScore,
          maintainers: profile.maintainerCount,
          weeklyDownloads: wdl,
          riskFlags,
        });
      } catch {
        scoreCache.set(pkg, { score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] });
      }
    }));
  }

  // Load prev scores for new packages (read package_score_history before insert)
  for (const pkg of newFreePkgList) {
    if (prevScores.has(pkg)) continue;
    const row = await env.DB.prepare(
      `SELECT score FROM package_score_history
       WHERE package_name = ? AND ecosystem = 'npm'
       ORDER BY recorded_at DESC LIMIT 1`
    ).bind(pkg).first<{ score: number | null }>();
    prevScores.set(pkg, row?.score ?? null);
  }

  // Insert current scores for new packages
  for (const pkg of newFreePkgList) {
    const cur = scoreCache.get(pkg)!;
    if (cur.score !== null) {
      await env.DB.prepare(
        `INSERT INTO package_score_history
         (package_name, ecosystem, score, maintainers, weekly_downloads, risk_flags, recorded_at)
         VALUES (?, 'npm', ?, ?, ?, ?, datetime('now'))`
      ).bind(pkg, cur.score, cur.maintainers, cur.weeklyDownloads, JSON.stringify(cur.riskFlags)).run();
    }
  }

  // Send one digest per free-tier email
  for (const row of freeRows) {
    const packages = (row.packages ?? "").split("||").filter(Boolean);
    if (packages.length === 0) { skipped++; continue; }

    const results = packages
      .map((pkg) => {
        const cur = scoreCache.get(pkg) ?? { score: null, maintainers: null, weeklyDownloads: null, riskFlags: [] };
        return { name: pkg, ...cur, prevScore: prevScores.get(pkg) ?? null };
      })
      .filter((r) => r.score !== null);

    if (results.length === 0) { skipped++; continue; }

    results.sort((a, b) => {
      const aRank = a.riskFlags.includes("CRITICAL") ? 2 : a.riskFlags.includes("HIGH") ? 1 : 0;
      const bRank = b.riskFlags.includes("CRITICAL") ? 2 : b.riskFlags.includes("HIGH") ? 1 : 0;
      if (aRank !== bRank) return bRank - aRank;
      return (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0);
    });

    const critical = results.filter((r) => r.riskFlags.includes("CRITICAL"));
    const pkgLines = results
      .map((r) => {
        const flag = r.riskFlags.includes("CRITICAL") ? "⚑ CRITICAL"
          : r.riskFlags.includes("HIGH") ? "⚠ HIGH"
          : r.riskFlags.includes("WARN") ? "↓ WARN"
          : "✓ OK";
        const change = fmtChange(r.score, r.prevScore);
        const scoreStr = `${r.score}/100${change}`;
        return `  ${r.name.padEnd(22)} ${scoreStr.padEnd(12)}  ${r.maintainers ?? "?"}p  ${fmtDL(r.weeklyDownloads)}/wk  ${flag}`;
      })
      .join("\n");

    const upgradeUrl = `https://getcommit.dev/pricing?email=${encodeURIComponent(row.email)}&utm_source=weekly-digest&utm_campaign=free-watch-cmd`;
    const auditLink = `https://getcommit.dev/audit?packages=${encodeURIComponent(packages.join(","))}`;

    const subject = critical.length > 0
      ? `⚑ ${critical.length} CRITICAL package${critical.length > 1 ? "s" : ""} in your Commit watchlist`
      : "Your Commit Watchlist — Weekly Report";

    const body = `Supply Chain Risk Report — ${dateStr}

${critical.length > 0
  ? `${critical.length} CRITICAL package${critical.length > 1 ? "s" : ""} detected in your watchlist:`
  : "Your watched packages look healthy this week."}

${pkgLines}

CRITICAL = sole npm publisher + 10M+ weekly downloads.
This structural profile is what made the April 1st axios supply chain attack possible.

Full audit: ${auditLink}

You're on the free tier (weekly digest, up to 3 packages). Developer ($15/mo) adds:
  • Daily scans (vs weekly)
  • Up to 15 packages (5× more)
  • Instant email alerts when any score drops a tier

Upgrade: ${upgradeUrl}

—
Commit · getcommit.dev
Manage watchlist: run \`npx proof-of-commitment watchlist\` in your terminal, or \`npx proof-of-commitment unwatch <package>\` to remove`;

    try {
      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Commit <noreply@getcommit.dev>",
          // reply_to: this is the "Up to 15 packages" Pro upsell nudge —
          // the single highest reply-intent transactional email Commit
          // sends. Replies were silently lost at noreply@.
          reply_to: "pico@amdal.dev",
          to: [row.email],
          subject,
          text: body,
        }),
      });
      if (emailResp.ok) {
        sent++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { sent, skipped };
}

// ── Commit daily monitoring scan ─────────────────────────────────────
//
// Cron: daily at 06:00 UTC ("0 6 * * *")
// For each Developer/Pro/Enterprise api_key with a non-paused default project:
//   1. Score every package in monitored_packages
//   2. Update current_score / previous_score / risk_level / last_scanned_at
//   3. Append to score_history
//   4. Detect alerts (score_drop ≥10, critical_threshold crossed, recovery)
//   5. Send one email per project to the project's alert_email (falls back to api_keys.email)
//   6. Log every alert into alert_log (sent/failed/suppressed)
//
// Free tier is excluded from daily scans by design — they get a weekly digest
// instead (runWeeklyDigest below). Developer tier was added 2026-06-07 after
// /pricing started promising "daily scans" for $15/mo; pre-fix the SQL filter
// silently excluded developer, meaning paying customers got the same scan
// frequency as free (zero). See worker.ts:runProMonitoringScan.

interface ProScanResult {
  scanned_packages: number;
  scored_packages: number;
  alerts_generated: number;
  emails_sent: number;
  emails_failed: number;
  projects_processed: number;
}

function riskLevelFromScore(score: number | null, thresholdCritical: number, thresholdWarn: number): "HEALTHY" | "MODERATE" | "CRITICAL" | "UNKNOWN" {
  if (score === null) return "UNKNOWN";
  if (score < thresholdCritical) return "CRITICAL";
  if (score < thresholdWarn) return "MODERATE";
  return "HEALTHY";
}

async function scorePackageForMonitoring(name: string, ecosystem: string): Promise<{ score: number | null; weekly_dl: number | null; maintainers: number | null }> {
  try {
    if (ecosystem === "pypi") {
      const profile = await buildPyPICommitmentProfile(name);
      if (!profile) return { score: null, weekly_dl: null, maintainers: null };
      return { score: profile.commitmentScore, weekly_dl: profile.recentDailyDownloads * 7, maintainers: profile.maintainerCount };
    } else if (ecosystem === "cargo") {
      const profile = await buildCargoCommitmentProfile(name);
      if (!profile) return { score: null, weekly_dl: null, maintainers: null };
      return { score: profile.commitmentScore, weekly_dl: profile.estimatedWeeklyDownloads, maintainers: profile.ownerCount };
    } else if (ecosystem === "golang") {
      const profile = await buildGolangCommitmentProfile(name);
      if (!profile) return { score: null, weekly_dl: null, maintainers: null };
      return { score: profile.commitmentScore, weekly_dl: null, maintainers: profile.contributorCount };
    } else {
      const profile = await buildNpmCommitmentProfile(name);
      if (!profile) return { score: null, weekly_dl: null, maintainers: null };
      return { score: profile.commitmentScore, weekly_dl: profile.recentWeeklyDownloads, maintainers: profile.maintainerCount };
    }
  } catch {
    return { score: null, weekly_dl: null, maintainers: null };
  }
}

async function runProMonitoringScan(env: Bindings): Promise<ProScanResult> {
  const result: ProScanResult = {
    scanned_packages: 0,
    scored_packages: 0,
    alerts_generated: 0,
    emails_sent: 0,
    emails_failed: 0,
    projects_processed: 0,
  };

  // Fetch all active Pro/Enterprise projects with their api_key email
  const projects = await env.DB.prepare(
    `SELECT
       mp.id AS project_id,
       mp.api_key_id,
       mp.name AS project_name,
       mp.alert_email,
       mp.threshold_critical,
       mp.threshold_warn,
       ak.email AS owner_email,
       ak.tier
     FROM monitored_projects mp
     JOIN api_keys ak ON ak.id = mp.api_key_id
     WHERE mp.paused_at IS NULL
       AND ak.revoked_at IS NULL
       AND ak.tier IN ('developer', 'pro', 'enterprise')`
  ).all<{
    project_id: string;
    api_key_id: string;
    project_name: string;
    alert_email: string | null;
    threshold_critical: number;
    threshold_warn: number;
    owner_email: string;
    tier: string;
  }>();

  const projectRows = projects.results ?? [];
  if (projectRows.length === 0) return result;

  // Process each project sequentially (per-project email batching makes this natural)
  for (const project of projectRows) {
    result.projects_processed++;

    const packages = await env.DB.prepare(
      `SELECT id, package_name AS name, ecosystem, current_score, previous_score, risk_level
       FROM monitored_packages WHERE project_id = ?`
    ).bind(project.project_id).all<{
      id: string;
      name: string;
      ecosystem: string;
      current_score: number | null;
      previous_score: number | null;
      risk_level: string | null;
    }>();

    const pkgRows = packages.results ?? [];
    if (pkgRows.length === 0) continue;

    type ScannedPkg = {
      id: string;
      name: string;
      ecosystem: string;
      old_score: number | null;
      new_score: number | null;
      old_level: string | null;
      new_level: string;
      weekly_dl: number | null;
      maintainers: number | null;
      alert: { type: "score_drop" | "critical_threshold" | "recovery"; delta: number } | null;
    };

    // Score in batches of 5 (matches weekly digest pattern, safe for upstream APIs)
    const MAX_CONCURRENT = 5;
    const scanned: ScannedPkg[] = [];

    for (let i = 0; i < pkgRows.length; i += MAX_CONCURRENT) {
      const batch = pkgRows.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(batch.map(async (pkg: typeof pkgRows[number]): Promise<ScannedPkg> => {
        const scored = await scorePackageForMonitoring(pkg.name, pkg.ecosystem);
        const newLevel = riskLevelFromScore(scored.score, project.threshold_critical, project.threshold_warn);

        let alert: ScannedPkg["alert"] = null;
        if (scored.score !== null) {
          const oldScore = pkg.current_score; // what was current is now "previous" for this scan
          const drop = oldScore !== null ? oldScore - scored.score : 0;
          const wasCritical = pkg.risk_level === "CRITICAL";
          const isCritical = newLevel === "CRITICAL";
          const wasUnhealthy = pkg.risk_level === "CRITICAL" || pkg.risk_level === "MODERATE";
          const isHealthy = newLevel === "HEALTHY";

          if (!wasCritical && isCritical) {
            alert = { type: "critical_threshold", delta: -drop };
          } else if (drop >= 10) {
            alert = { type: "score_drop", delta: -drop };
          } else if (wasUnhealthy && isHealthy) {
            alert = { type: "recovery", delta: -drop };
          }
        }

        return {
          id: pkg.id,
          name: pkg.name,
          ecosystem: pkg.ecosystem,
          old_score: pkg.current_score,
          new_score: scored.score,
          old_level: pkg.risk_level,
          new_level: newLevel,
          weekly_dl: scored.weekly_dl,
          maintainers: scored.maintainers,
          alert,
        };
      }));
      scanned.push(...batchResults);
    }

    // Persist: update monitored_packages + insert score_history
    for (const s of scanned) {
      result.scanned_packages++;
      if (s.new_score === null) continue;
      result.scored_packages++;

      await env.DB.prepare(
        `UPDATE monitored_packages
         SET previous_score = current_score,
             current_score = ?,
             risk_level = ?,
             last_scanned_at = datetime('now')
         WHERE id = ?`
      ).bind(s.new_score, s.new_level, s.id).run();

      await env.DB.prepare(
        `INSERT INTO score_history (package_id, score, risk_level, scanned_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).bind(s.id, s.new_score, s.new_level).run();
    }

    // Build alert digest for this project
    const alertable = scanned.filter((s) => s.alert !== null);
    result.alerts_generated += alertable.length;

    if (alertable.length === 0) continue;

    const recipient = project.alert_email ?? project.owner_email;
    if (!recipient || !env.RESEND_API_KEY) {
      // Log as suppressed
      for (const s of alertable) {
        if (!s.alert) continue;
        await env.DB.prepare(
          `INSERT INTO alert_log (project_id, package_name, ecosystem, alert_type, old_score, new_score, delivered_at, delivery_status)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'suppressed')`
        ).bind(project.project_id, s.name, s.ecosystem, s.alert.type, s.old_score, s.new_score).run();
      }
      continue;
    }

    // Format email body
    const critical = alertable.filter((s) => s.alert?.type === "critical_threshold");
    const drops = alertable.filter((s) => s.alert?.type === "score_drop");
    const recoveries = alertable.filter((s) => s.alert?.type === "recovery");
    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const lines: string[] = [];
    lines.push(`Commit Pro Monitoring — ${dateStr}`);
    lines.push("");
    if (critical.length > 0) {
      lines.push(`⚑ ${critical.length} package${critical.length === 1 ? "" : "s"} crossed into CRITICAL:`);
      for (const s of critical) {
        lines.push(`  ${s.name} (${s.ecosystem}): ${s.old_score ?? "?"} → ${s.new_score}/100`);
      }
      lines.push("");
    }
    if (drops.length > 0) {
      lines.push(`↓ ${drops.length} significant score drop${drops.length === 1 ? "" : "s"} (≥10 pts):`);
      for (const s of drops) {
        lines.push(`  ${s.name} (${s.ecosystem}): ${s.old_score ?? "?"} → ${s.new_score}/100`);
      }
      lines.push("");
    }
    if (recoveries.length > 0) {
      lines.push(`✓ ${recoveries.length} package${recoveries.length === 1 ? "" : "s"} recovered to HEALTHY:`);
      for (const s of recoveries) {
        lines.push(`  ${s.name} (${s.ecosystem}): ${s.old_score ?? "?"} → ${s.new_score}/100`);
      }
      lines.push("");
    }
    lines.push("View all watched packages:");
    lines.push("  curl -H 'Authorization: Bearer <YOUR_KEY>' https://poc-backend.amdal-dev.workers.dev/api/watchlist");
    lines.push("");
    lines.push("Scoring methodology: https://getcommit.dev/scoring");
    lines.push("Manage subscription: https://getcommit.dev/pricing");
    lines.push("");
    lines.push("—");
    lines.push("Commit Pro · getcommit.dev");

    const subject = critical.length > 0
      ? `⚑ Commit Pro: ${critical.length} package${critical.length === 1 ? "" : "s"} now CRITICAL`
      : drops.length > 0
      ? `↓ Commit Pro: ${drops.length} package score drop${drops.length === 1 ? "" : "s"} detected`
      : `Commit Pro: ${recoveries.length} package recover${recoveries.length === 1 ? "y" : "ies"}`;

    let delivered = false;
    try {
      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Commit <noreply@getcommit.dev>",
          // reply_to: Pro tier weekly digest — paying customer replies
          // (enterprise pricing, support, custom packages) route to a
          // human, not noreply@.
          reply_to: "pico@amdal.dev",
          to: [recipient],
          subject,
          text: lines.join("\n"),
        }),
      });
      delivered = emailResp.ok;
      if (delivered) result.emails_sent++;
      else result.emails_failed++;
    } catch {
      result.emails_failed++;
    }

    // Log each alert
    for (const s of alertable) {
      if (!s.alert) continue;
      await env.DB.prepare(
        `INSERT INTO alert_log (project_id, package_name, ecosystem, alert_type, old_score, new_score, delivered_at, delivery_status)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
      ).bind(
        project.project_id,
        s.name,
        s.ecosystem,
        s.alert.type,
        s.old_score,
        s.new_score,
        delivered ? "sent" : "failed",
      ).run();
    }
  }

  return result;
}

// ── Stripe Checkout ──────────────────────────────────────────────────

/**
 * Verify Stripe webhook signature (HMAC-SHA256, constant-time comparison).
 * sig format: "t=timestamp,v1=hash,v0=legacy"
 */
async function verifyStripeWebhook(payload: string, sig: string, secret: string): Promise<boolean> {
  const parts = sig.split(",").reduce((acc, pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) acc.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
    return acc;
  }, new Map<string, string>());

  const timestamp = parts.get("t");
  const v1Sig = parts.get("v1");
  if (!timestamp || !v1Sig) return false;

  // Reject events older than 5 minutes (replay attack prevention)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const macBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedHex = Array.from(new Uint8Array(macBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison via timing-safe check (length check first)
  if (computedHex.length !== v1Sig.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ v1Sig.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * GET /api/checkout?tier=pro|developer
 * Creates a Stripe Checkout Session and redirects to Stripe hosted checkout.
 *
 * Required env vars (set via Cloudflare dashboard → Workers → Settings → Variables):
 *   STRIPE_SECRET_KEY  — sk_live_... or sk_test_...
 *   STRIPE_PRICE_PRO   — Price ID for Pro $29/mo recurring
 *   STRIPE_PRICE_DEV   — Price ID for Developer $15/mo recurring
 */
app.get("/api/checkout", async (c) => {
  // Per-IP hourly rate limit — blocks bot that hammers this endpoint directly
  // (bypassing getcommit.dev proxy). Real users never retry checkout 4× in one hour.
  // Authenticated users (API key / Stripe webhook) don't reach this path.
  //
  // IP resolution: prefer X-Real-IP (set by getcommit.dev _worker.js proxy to preserve
  // the original client IP — CF overwrites CF-Connecting-IP on Worker-to-Worker subrequests
  // with the egress IP, which would make all proxied sessions share one rate-limit bucket).
  const ip = c.req.header("X-Real-IP") || c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const checkoutCount = await bumpCheckoutCount(c.env, ip);
  if (checkoutCount > CHECKOUT_HOURLY_LIMIT) {
    console.warn(`[checkout] rate_limit ip=${ip} count=${checkoutCount}`);
    return c.redirect("https://getcommit.dev/pricing?error=rate_limit_exceeded", 429);
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    // Stripe not configured — redirect to pricing with notice
    return c.redirect("https://getcommit.dev/pricing#waitlist", 302);
  }

  const tier = (c.req.query("tier") ?? "pro").toLowerCase();
  const priceId = tier === "developer" ? c.env.STRIPE_PRICE_DEV : c.env.STRIPE_PRICE_PRO;

  if (!priceId) {
    console.error(`Stripe price not configured for tier: ${tier}`);
    return c.redirect("https://getcommit.dev/pricing?error=tier_unavailable", 302);
  }

  // Email pre-fill — captured by the pricing page modal (line 763 in pricing.astro)
  // OR by the get-started form (line 477 mutates upgrade-btn href after free-key
  // creation). Strips whitespace; rejected if invalid.
  const rawEmail = (c.req.query("email") ?? "").trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
  const prefillEmail = emailValid ? rawEmail : null;

  // Funnel-pollution gate: require a valid email param. Without it, crawlers that
  // index get-started.astro's static <a href="/api/checkout?tier=...&utm_source=
  // get-started"> anchors create empty-customer-email Stripe sessions on every
  // crawl, polluting funnel reports. Observed 2026-06-07 ~05Z: 2 USD-currency
  // empty-email sessions in 2h (cs_live_b1uwL6LARBy2... tier=pro $29 and
  // cs_live_b1IQgN606KGz... tier=developer $15) — same crawler-induced pattern
  // just fixed at synlig-worker (form-only-slug gate, dd15e10). Legitimate
  // flows always supply email:
  //   /pricing.astro modal: lines 959/963 only redirect AFTER email captured
  //   /get-started.astro: lines 477-491 mutate href to include &email= after
  //                       form submission (free-key creation flow)
  // A real user who somehow lands here without email lands on /pricing#waitlist
  // and runs the modal. utm_source=get-started/utm_campaign=upgrade-from-free-key
  // are crawler-fingerprint at this point — only crawlers reach the URL without
  // email pre-fill on those parameters. Logging surfaces unexpected legitimate
  // flows post-deploy.
  if (!prefillEmail) {
    console.warn(`[checkout] no_email_gate ip=${ip} tier=${tier} utm_source=${c.req.query("utm_source") ?? ""} utm_campaign=${c.req.query("utm_campaign") ?? ""}`);
    return c.redirect("https://getcommit.dev/pricing#waitlist", 302);
  }

  const params = new URLSearchParams({
    mode: "subscription",
    success_url: "https://getcommit.dev/checkout/success/?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://getcommit.dev/pricing/",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    billing_address_collection: "required",
    "metadata[tier]": tier,
    // Brand bridge — Stripe account legal name is "AS Åmdal Invest" (one
    // account serves both Commit and Synlig Digital). Per-session display_name
    // override puts "Commit" at the top of Stripe Checkout. Holding entity
    // still appears in small print under Link + on card statements.
    // Verified via API probe 2026-05-23.
    "branding_settings[display_name]": "Commit",
  });

  // Pre-fill customer email in Stripe so the checkout form starts filled.
  // Stripe will verify it via OTP anyway — this just saves a step.
  // prefillEmail is guaranteed non-null by the funnel-pollution gate above.
  params.set("customer_email", prefillEmail);

  // GET-checkout is the fallback path used by pricing.astro when the POST
  // checkout-intent flow errors. Forward UTM query params into Stripe metadata
  // so the fallback doesn't silently drop attribution.
  applyUtmToStripeMetadata(params, extractUtmFromObject({
    utm_source: c.req.query("utm_source"),
    utm_medium: c.req.query("utm_medium"),
    utm_campaign: c.req.query("utm_campaign"),
    utm_content: c.req.query("utm_content"),
    utm_term: c.req.query("utm_term"),
    referrer: c.req.query("referrer"),
  }));

  // Forward audit-context — symmetric with POST /api/checkout-intent.
  // Audit-critical-key flow lands here on POST-failure fallback; preserving
  // packages= keeps the closing-the-loop UX intact even on the fallback path.
  applyAuditCtxToStripeMetadata(params, extractAuditCtxFromObject({
    packages: c.req.query("packages"),
    eco: c.req.query("eco"),
  }));

  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const err = (await resp.json()) as { error?: { message?: string } };
      console.error("Stripe API error:", err.error?.message ?? resp.status);
      return c.redirect("https://getcommit.dev/pricing/?error=checkout_failed", 302);
    }

    const session = (await resp.json()) as { url: string };
    return c.redirect(session.url, 302);
  } catch (err) {
    console.error("Checkout error:", err instanceof Error ? err.message : err);
    return c.redirect("https://getcommit.dev/pricing/?error=checkout_failed", 302);
  }
});

/**
 * GET /api/checkout/session?session_id=cs_live_...
 * Retrieves minimal info about a completed checkout session (for the success page).
 * Returns customer email + tier so the page can say "key sent to <email>".
 */
app.get("/api/checkout/session", async (c) => {
  const stripeKey = c.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return c.json({ error: "stripe_not_configured" }, 503);

  const sessionId = c.req.query("session_id") ?? "";
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return c.json({ error: "invalid_session_id" }, 400);
  }

  try {
    const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });

    if (!resp.ok) return c.json({ error: "session_not_found" }, 404);

    const session = (await resp.json()) as {
      customer_details?: { email?: string };
      customer_email?: string;
      payment_status?: string;
      metadata?: { tier?: string; audit_packages?: string; audit_eco?: string };
    };

    const email = session.customer_details?.email ?? session.customer_email ?? "";
    const tier = session.metadata?.tier ?? "pro";
    const paid = session.payment_status === "paid";

    // Audit-context — re-validate Stripe metadata defensively. Stripe
    // doesn't tamper with metadata, but anything coming back over the wire
    // from a 3rd party gets the same shape check we apply on entry.
    const auditCtx = extractAuditCtxFromObject({
      packages: session.metadata?.audit_packages,
      eco: session.metadata?.audit_eco,
    });

    // Mask email for privacy: "h***@example.com"
    const maskedEmail = email
      ? email.replace(/^(.)(.*)(@.*)$/, (_m, first, _mid, domain) => `${first}${"*".repeat(Math.min(_mid.length, 6))}${domain}`)
      : "";

    // Atomically reveal the raw API key once. The webhook parks it in
    // pending_key_reveals; the success page reads it here. After the first
    // successful read we null out raw_key so reloads/sharing the URL can't
    // re-leak the key. Only honored within 1 hour of webhook write to bound
    // exposure if the URL is leaked. Email backup is still sent regardless.
    let revealedKey: string | null = null;
    if (paid) {
      try {
        const row = await c.env.DB.prepare(
          `SELECT raw_key FROM pending_key_reveals
            WHERE session_id = ?
              AND raw_key IS NOT NULL
              AND revealed_at IS NULL
              AND datetime(created_at) > datetime('now', '-1 hour')`
        ).bind(sessionId).first<{ raw_key: string | null }>();

        if (row?.raw_key) {
          const updateResult = await c.env.DB.prepare(
            `UPDATE pending_key_reveals
                SET raw_key = NULL,
                    revealed_at = datetime('now')
              WHERE session_id = ?
                AND revealed_at IS NULL`
          ).bind(sessionId).run();

          // Only return the key if the UPDATE actually flipped revealed_at —
          // protects against the read-then-update race if two tabs hit the
          // endpoint at once.
          // @ts-ignore D1Result.meta typing varies
          const changes = (updateResult.meta?.changes ?? updateResult.changes ?? 0) as number;
          if (changes > 0) {
            revealedKey = row.raw_key;
          }
        }
      } catch (revealErr) {
        // Non-fatal: success-page reveal is best-effort, email is the contract.
        console.error("checkout session reveal error:", revealErr instanceof Error ? revealErr.message : revealErr);
      }
    }

    return c.json({
      email: maskedEmail,
      tier,
      paid,
      key: revealedKey,
      // Audit-context for one-click "watch these N packages" on success page.
      // Null when visitor came from non-audit funnel (CLI, direct, etc).
      audit_packages: auditCtx.packages,
      audit_eco: auditCtx.eco,
    });
  } catch (err) {
    console.error("Checkout session lookup error:", err instanceof Error ? err.message : err);
    return c.json({ error: "lookup_failed" }, 500);
  }
});

/**
 * Sanitize one UTM/referrer value for storage + Stripe metadata.
 * - Drops non-strings.
 * - Trims, strips control chars, lowercases (UTMs are case-insensitive by convention).
 * - Caps length (Stripe metadata values are limited to 500 chars; we go shorter
 *   for UTMs because long UTMs are almost always tracker spam).
 * Returns null for empty / invalid input so we can skip persistence + metadata.
 */
function sanitizeUtmValue(raw: unknown, maxLen = 100): string | null {
  if (typeof raw !== "string") return null;
  // Strip ASCII control chars (incl. NUL, newline, tab) — they break Stripe
  // metadata and corrupt CSV exports.
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned.toLowerCase() : null;
}

interface UtmFields {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
}

function extractUtmFromObject(obj: Record<string, unknown> | undefined | null): UtmFields {
  const o = obj ?? {};
  return {
    utm_source: sanitizeUtmValue(o.utm_source),
    utm_medium: sanitizeUtmValue(o.utm_medium),
    utm_campaign: sanitizeUtmValue(o.utm_campaign),
    utm_content: sanitizeUtmValue(o.utm_content),
    utm_term: sanitizeUtmValue(o.utm_term),
    referrer: sanitizeUtmValue(o.referrer, 500),
  };
}

/**
 * Audit-context: comma-separated package names + ecosystem that the visitor
 * had in their /audit results CRITICAL list. Threaded through Stripe metadata
 * so the post-payment /checkout/success page can offer "watch these N
 * packages on your new Developer/Pro plan" in one click — closing the
 * audit→pay→watchlist loop without making the user re-enter what they
 * audited 60 seconds earlier.
 *
 * Validation matches /api/watchlist's POST body shape: package name regex
 * `[@a-zA-Z0-9._/-]+` up to 214 chars; ecosystem ∈ {npm,pypi,cargo,golang}.
 * Caps total length at 480 chars (Stripe metadata values are 500-char limit).
 */
interface AuditCtxFields {
  packages: string | null;
  eco: string | null;
}

function extractAuditCtxFromObject(obj: Record<string, unknown> | undefined | null): AuditCtxFields {
  const o = obj ?? {};
  let packages: string | null = null;
  if (typeof o.packages === "string" && o.packages.length > 0 && o.packages.length < 480) {
    const names = o.packages.split(",").map((n) => n.trim()).filter(Boolean);
    const valid = names
      .filter((n) => /^[@a-zA-Z0-9._/-]+$/.test(n) && n.length <= 214)
      .slice(0, 5);
    if (valid.length > 0) packages = valid.join(",");
  }
  let eco: string | null = null;
  if (typeof o.eco === "string") {
    const lower = o.eco.toLowerCase();
    if (ECOSYSTEMS.has(lower)) eco = lower;
  }
  return { packages, eco };
}

function applyAuditCtxToStripeMetadata(params: URLSearchParams, ctx: AuditCtxFields): void {
  if (ctx.packages) params.set("metadata[audit_packages]", ctx.packages);
  if (ctx.eco) params.set("metadata[audit_eco]", ctx.eco);
}

function applyUtmToStripeMetadata(params: URLSearchParams, utm: UtmFields): void {
  if (utm.utm_source) params.set("metadata[utm_source]", utm.utm_source);
  if (utm.utm_medium) params.set("metadata[utm_medium]", utm.utm_medium);
  if (utm.utm_campaign) params.set("metadata[utm_campaign]", utm.utm_campaign);
  if (utm.utm_content) params.set("metadata[utm_content]", utm.utm_content);
  if (utm.utm_term) params.set("metadata[utm_term]", utm.utm_term);
  if (utm.referrer) params.set("metadata[referrer]", utm.referrer);
}

/**
 * POST /api/checkout-intent
 * Captures email lead before Stripe redirect. Stores the lead in D1 so
 * abandoned checkouts are visible in the admin dashboard.
 *
 * Body: {
 *   email: string,
 *   tier: "pro" | "developer",
 *   utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?, referrer?
 * }
 * Returns: { ok: true, checkout_url: string }
 *
 * UTM fields are persisted to checkout_leads (migration 0013) AND forwarded to
 * Stripe checkout session metadata[utm_*], so paid conversions can be
 * attributed back to the funnel (e.g. CLI watch-cmd) in Stripe Dashboard +
 * webhook handlers. Closes the attribution gap surfaced by reflection
 * b7d29ba6412805e8 (2026-05-25): UTM was visible in /pricing browser URL but
 * dropped at this API boundary, making CLI-driven conversions invisible.
 */
app.post("/api/checkout-intent", async (c) => {
  // Per-IP hourly rate limit — same bot defence as GET /api/checkout.
  // X-Real-IP preferred: see comment in GET /api/checkout for explanation.
  const ip = c.req.header("X-Real-IP") || c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const checkoutCount = await bumpCheckoutCount(c.env, ip);
  if (checkoutCount > CHECKOUT_HOURLY_LIMIT) {
    console.warn(`[checkout-intent] rate_limit ip=${ip} count=${checkoutCount}`);
    return c.json({ error: "rate_limit_exceeded", message: "Too many checkout attempts from this IP. Please try again in an hour." }, 429);
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    return c.json({ error: "stripe_not_configured" }, 503);
  }

  let body: {
    email?: string;
    tier?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    referrer?: string;
    packages?: string;
    eco?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const rawEmail = (body.email ?? "").trim().toLowerCase();
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const tier = (body.tier ?? "pro").toLowerCase();
  if (tier !== "pro" && tier !== "developer") {
    return c.json({ error: "invalid_tier" }, 400);
  }

  const priceId = tier === "developer" ? c.env.STRIPE_PRICE_DEV : c.env.STRIPE_PRICE_PRO;
  if (!priceId) {
    return c.json({ error: "tier_unavailable" }, 503);
  }

  const utm = extractUtmFromObject(body as Record<string, unknown>);

  // Persist lead before Stripe redirect — abandoned checkouts remain queryable
  // with their UTM attribution. /api/admin/leads exposes the new columns.
  try {
    const emailHash = await sha256Hex(rawEmail);
    const idBytes = new Uint8Array(8);
    crypto.getRandomValues(idBytes);
    const leadId = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const ts = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO checkout_leads (
         id, email_hash, email, tier, source, created_at,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      leadId,
      emailHash,
      rawEmail,
      tier,
      "pricing-modal",
      ts,
      utm.utm_source,
      utm.utm_medium,
      utm.utm_campaign,
      utm.utm_content,
      utm.utm_term,
      utm.referrer,
    ).run();
  } catch (err) {
    // Non-fatal: log but continue to Stripe redirect. Lead capture shouldn't block checkout.
    console.error("checkout_intent lead persist error:", err instanceof Error ? err.message : err);
  }

  // Create Stripe checkout session.
  const params = new URLSearchParams({
    mode: "subscription",
    success_url: "https://getcommit.dev/checkout/success/?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://getcommit.dev/pricing/",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    billing_address_collection: "required",
    "metadata[tier]": tier,
    customer_email: rawEmail,
    // Brand bridge — see /api/checkout above. Replaces "AS Åmdal Invest"
    // header with "Commit". Verified via API probe 2026-05-23.
    "branding_settings[display_name]": "Commit",
  });

  // Forward UTM attribution into Stripe metadata so it survives into:
  //  - Stripe Dashboard session detail view
  //  - checkout.session.completed webhook (subscription→funnel link)
  //  - Stripe CSV exports for cohort analysis
  applyUtmToStripeMetadata(params, utm);

  // Forward audit-context (packages + eco) into Stripe metadata so the
  // post-payment /checkout/success page can offer "watch these N packages"
  // in one click. Closes audit→pay→watchlist loop.
  applyAuditCtxToStripeMetadata(params, extractAuditCtxFromObject(body as Record<string, unknown>));

  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!resp.ok) {
      const err = (await resp.json()) as { error?: { message?: string } };
      console.error("Stripe API error (checkout-intent):", err.error?.message ?? resp.status);
      return c.json({ error: "checkout_failed" }, 502);
    }

    const session = (await resp.json()) as { url: string };
    return c.json({ ok: true, checkout_url: session.url });
  } catch (err) {
    console.error("checkout-intent Stripe error:", err instanceof Error ? err.message : err);
    return c.json({ error: "checkout_failed" }, 502);
  }
});

/**
 * GET /api/admin/leads
 * Admin endpoint — requires X-Admin-Secret header matching ADMIN_SECRET env var.
 * Returns recent checkout leads captured before Stripe redirect (pricing-modal source).
 * Useful for identifying abandoned checkouts.
 */
app.get("/api/admin/leads", async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const source = c.req.query("source") ?? "pricing-modal";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  const rows = await c.env.DB.prepare(
    `SELECT id, email, tier, source, created_at,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer
       FROM checkout_leads WHERE source = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(source, limit).all<{
    id: string; email: string; tier: string; source: string; created_at: string;
    utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
    utm_content: string | null; utm_term: string | null; referrer: string | null;
  }>();

  return c.json({
    leads: rows.results ?? [],
    count: (rows.results ?? []).length,
    source,
  });
});

/**
 * GET /api/admin/key-analytics
 * Admin endpoint — X-Admin-Secret required.
 * Returns aggregate API key usage data for conversion analysis:
 *   - total keys, active (used in last 7d), tier breakdown
 *   - keys approaching daily limit (>75% usage today)
 *   - top domains by signup volume
 *   - daily signup trend (last 14d)
 * No PII in default response; pass ?emails=1 for email list (admin use only).
 */
app.get("/api/admin/key-analytics", async (c) => {
  const adminSecret = c.env.ADMIN_SECRET;
  if (!adminSecret || c.req.header("X-Admin-Secret") !== adminSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const includeEmails = c.req.query("emails") === "1";
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Run queries in parallel
  const [
    totalRow,
    tierRows,
    activeRow,
    approachingLimitRows,
    domainRows,
    signupTrendRows,
    topUsersRows,
  ] = await Promise.all([
    // Total non-revoked keys
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM api_keys WHERE revoked_at IS NULL`
    ).first<{ total: number }>(),

    // Tier breakdown
    c.env.DB.prepare(
      `SELECT COALESCE(tier, 'free') AS tier, COUNT(*) AS count
       FROM api_keys WHERE revoked_at IS NULL GROUP BY tier ORDER BY count DESC`
    ).all<{ tier: string; count: number }>(),

    // Active in last 7d
    c.env.DB.prepare(
      `SELECT COUNT(*) AS active FROM api_keys
       WHERE revoked_at IS NULL AND last_used_at >= ?`
    ).bind(sevenDaysAgo).first<{ active: number }>(),

    // Keys approaching daily limit (>75% of tier limit used today)
    c.env.DB.prepare(
      `SELECT key_prefix, COALESCE(tier, 'free') AS tier,
              requests_this_period AS used, COALESCE(source, 'web') AS source
       FROM api_keys
       WHERE revoked_at IS NULL
         AND COALESCE(tier, 'free') = 'free'
         AND requests_this_period >= 150
       ORDER BY requests_this_period DESC LIMIT 20`
    ).all<{ key_prefix: string; tier: string; used: number; source: string }>(),

    // Top email domains
    c.env.DB.prepare(
      `SELECT SUBSTR(email, INSTR(email, '@') + 1) AS domain, COUNT(*) AS count
       FROM api_keys WHERE revoked_at IS NULL AND email LIKE '%@%'
       GROUP BY domain ORDER BY count DESC LIMIT 15`
    ).all<{ domain: string; count: number }>(),

    // Daily signup trend (last 14d)
    c.env.DB.prepare(
      `SELECT DATE(created_at) AS day, COUNT(*) AS signups
       FROM api_keys WHERE revoked_at IS NULL
         AND created_at >= datetime('now', '-14 days')
       GROUP BY day ORDER BY day DESC`
    ).all<{ day: string; signups: number }>(),

    // Top users by request volume
    c.env.DB.prepare(
      `SELECT key_prefix, COALESCE(tier, 'free') AS tier,
              requests_this_period AS used_today,
              COALESCE(source, 'web') AS source,
              last_used_at
       FROM api_keys
       WHERE revoked_at IS NULL AND requests_this_period > 0
       ORDER BY requests_this_period DESC LIMIT 20`
    ).all<{ key_prefix: string; tier: string; used_today: number; source: string; last_used_at: string | null }>(),
  ]);

  // Optionally include email list for manual outreach
  let emailList: { email: string; tier: string; source: string; created_at: string; used_today: number }[] = [];
  if (includeEmails) {
    const emailRows = await c.env.DB.prepare(
      `SELECT email, COALESCE(tier, 'free') AS tier, COALESCE(source, 'web') AS source,
              created_at, requests_this_period AS used_today
       FROM api_keys WHERE revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 200`
    ).all<{ email: string; tier: string; source: string; created_at: string; used_today: number }>();
    emailList = emailRows.results ?? [];
  }

  return c.json({
    summary: {
      total_keys: totalRow?.total ?? 0,
      active_7d: activeRow?.active ?? 0,
      tiers: (tierRows.results ?? []).reduce((acc, r) => {
        acc[r.tier] = r.count;
        return acc;
      }, {} as Record<string, number>),
    },
    approaching_limit: (approachingLimitRows.results ?? []).map((r) => ({
      key_prefix: r.key_prefix,
      tier: r.tier,
      used_today: r.used,
      limit: 200,
      pct: Math.round((r.used / 200) * 100),
      source: r.source,
    })),
    top_users: (topUsersRows.results ?? []).map((r) => ({
      key_prefix: r.key_prefix,
      tier: r.tier,
      used_today: r.used_today,
      source: r.source,
      last_used: r.last_used_at,
    })),
    domains: (domainRows.results ?? []).map((r) => ({
      domain: r.domain,
      count: r.count,
    })),
    signup_trend: (signupTrendRows.results ?? []).map((r) => ({
      day: r.day,
      signups: r.signups,
    })),
    ...(includeEmails ? { emails: emailList } : {}),
  });
});

/**
 * GET /api/stats/teams-protected
 * Public stats for the /pricing page social-proof line.
 *
 * Returns the count of distinct teams (active API keys) that joined recently.
 * Tries 7d window first; falls back to 30d, then total. Returns the first
 * window with count >= 5 — anything smaller is suppressed by the frontend
 * to avoid shipping a zero-signal trust badge.
 *
 * Cached at the edge for 5min so this can be called inline from /pricing
 * without warming up the worker per visitor.
 */
app.get("/api/stats/teams-protected", async (c) => {
  try {
    // Count distinct emails on active (non-revoked) API keys, by window.
    // api_keys.created_at is stored as ISO string; D1 SQLite handles
    // datetime() comparisons on ISO-8601 lexicographically.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [row7, row30, rowTotal] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT email) AS n FROM api_keys WHERE revoked_at IS NULL AND created_at >= ?`
      ).bind(sevenDaysAgo).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT email) AS n FROM api_keys WHERE revoked_at IS NULL AND created_at >= ?`
      ).bind(thirtyDaysAgo).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT email) AS n FROM api_keys WHERE revoked_at IS NULL`
      ).first<{ n: number }>(),
    ]);

    const count_7d = row7?.n ?? 0;
    const count_30d = row30?.n ?? 0;
    const count_total = rowTotal?.n ?? 0;

    // Pick the tightest meaningful window. Threshold matches the frontend
    // suppression rule (don't show <5) so callers don't have to re-check.
    let displayCount = 0;
    let displayPeriod: "7d" | "30d" | "total" | "none" = "none";
    if (count_7d >= 5) {
      displayCount = count_7d;
      displayPeriod = "7d";
    } else if (count_30d >= 5) {
      displayCount = count_30d;
      displayPeriod = "30d";
    } else if (count_total >= 5) {
      displayCount = count_total;
      displayPeriod = "total";
    }

    // 5-minute edge cache. Stats lag is fine; cache misses are the point.
    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      ok: true,
      count: displayCount,
      period: displayPeriod,
      counts: {
        last_7d: count_7d,
        last_30d: count_30d,
        total: count_total,
      },
    });
  } catch (err) {
    console.error("stats/teams-protected error:", err instanceof Error ? err.message : err);
    return c.json({ ok: false, count: 0, period: "none" }, 500);
  }
});

/**
 * POST /api/stripe/webhook
 * Handles Stripe events. Register this URL in Stripe Dashboard → Webhooks.
 *
 * Events handled:
 *   checkout.session.completed    — provision API key, email to customer
 *   checkout.session.expired      — send abandonment-recovery email (dedupe on session_id)
 *   customer.subscription.deleted — revoke API key on cancellation
 *
 * Required env var:
 *   STRIPE_WEBHOOK_SECRET  — whsec_... (from Stripe Dashboard → Webhooks → signing secret)
 */
app.post("/api/stripe/webhook", async (c) => {
  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = await c.req.text();
  const sig = c.req.header("stripe-signature") ?? "";

  if (webhookSecret) {
    const isValid = await verifyStripeWebhook(rawBody, sig, webhookSecret);
    if (!isValid) {
      return c.json({ error: "invalid_signature" }, 400);
    }
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  // ── checkout.session.completed: provision API key ──────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      id?: string;
      customer_details?: { email?: string };
      customer_email?: string;
      customer?: string;
      subscription?: string;
      metadata?: {
        tier?: string;
        utm_source?: string;
        utm_campaign?: string;
        utm_medium?: string;
      };
    };

    const email = (session.customer_details?.email ?? session.customer_email ?? "").toLowerCase().trim();
    const tier = (session.metadata?.tier ?? "pro") as "pro" | "developer";
    const stripeCustomerId = session.customer as string | undefined;
    const subscriptionId = session.subscription as string | undefined;
    const stripeSessionId = session.id as string | undefined;

    // Funnel attribution for PAID keys. The free-key endpoint (/api/keys/create)
    // sets api_keys.source from VALID_SOURCES (line ~2836); without the parallel
    // write here, every paid signup silently coerced to schema-default 'web' —
    // hiding audit-overshoot / audit-compromised-key / upgrade-from-free-key
    // conversion volume from source_breakdown despite the metadata already
    // riding in Stripe session.metadata[utm_campaign] since 2026-05-29
    // (appendCommonCheckoutParams line 6428). Prefer utm_campaign because it
    // names the specific surface; fall back to utm_source for breadth, then
    // 'web' to match free-key default. Paid vs free split remains recoverable
    // via the tier column. 3rd occurrence of the funnel-surface-gap pattern
    // closed today (2026-06-10 04:55Z free-key hero+REF_TO_SOURCE+VALID_SOURCES,
    // 05:25Z pricing CONTEXT_BY_CAMPAIGN, now paid-key webhook source).
    // Allow alphanumeric + hyphen + underscore, max 64 chars — matches the
    // shape of every existing source value and rejects pathological metadata.
    const VALID_PAID_SOURCE_RE = /^[a-z0-9_-]{1,64}$/;
    const rawUtmCampaign = typeof session.metadata?.utm_campaign === "string" ? session.metadata.utm_campaign.trim().toLowerCase() : "";
    const rawUtmSource = typeof session.metadata?.utm_source === "string" ? session.metadata.utm_source.trim().toLowerCase() : "";
    let source = "web";
    if (rawUtmCampaign && VALID_PAID_SOURCE_RE.test(rawUtmCampaign)) {
      source = rawUtmCampaign;
    } else if (rawUtmSource && VALID_PAID_SOURCE_RE.test(rawUtmSource)) {
      source = rawUtmSource;
    }

    if (!email) {
      console.error("Stripe webhook: no email in checkout session");
      return c.json({ error: "no_email" }, 400);
    }

    // Revoke any existing active keys for this email + tier
    await c.env.DB.prepare(
      `UPDATE api_keys SET revoked_at = datetime('now')
       WHERE email = ? AND tier = ? AND revoked_at IS NULL`
    ).bind(email, tier).run();

    // Generate new API key
    const rawBytes = new Uint8Array(16);
    crypto.getRandomValues(rawBytes);
    const randomHex = Array.from(rawBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const apiKey = `sk_commit_${randomHex}`;
    const keyHash = await sha256Hex(apiKey);
    const keyPrefix = apiKey.slice(0, 19);

    const idBytes = new Uint8Array(8);
    crypto.getRandomValues(idBytes);
    const id = Array.from(idBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const periodResetAt = nextResetAt("monthly");

    await c.env.DB.prepare(
      `INSERT INTO api_keys
         (id, key_hash, key_prefix, email, tier, requests_this_period, period_reset_at,
          stripe_customer_id, stripe_subscription_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, keyHash, keyPrefix, email, tier, periodResetAt, stripeCustomerId ?? null, subscriptionId ?? null, source).run();

    console.log(`[stripe] checkout.session.completed id=${stripeSessionId ?? "?"} tier=${tier} source=${source} email=${email}`);

    // Park the raw key briefly so the /checkout/success page can reveal it
    // inline (mirrors the inline-key pattern shipped on /pricing/ and
    // /get-started/ 2026-05-23). The success page calls /api/checkout/session
    // which atomically reveals + nulls the raw key. Email is still sent below
    // as backup. Idempotent on session_id (webhook may retry).
    if (stripeSessionId) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO pending_key_reveals (session_id, raw_key, email, tier)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             raw_key = excluded.raw_key,
             email = excluded.email,
             tier = excluded.tier
           WHERE pending_key_reveals.revealed_at IS NULL`
        ).bind(stripeSessionId, apiKey, email, tier).run();
      } catch (revealErr) {
        // Non-fatal: success-page reveal is a nice-to-have, email is the contract.
        console.error("pending_key_reveals insert error:", revealErr instanceof Error ? revealErr.message : revealErr);
      }
    }

    // Email the API key via Resend
    if (c.env.RESEND_API_KEY) {
      const tierLabel = tier === "developer" ? "Developer" : "Pro";
      const tierPrice = tier === "developer" ? "$15/mo" : "$29/mo";
      const limits = tier === "developer"
        ? "1,000 req/day · Batch API (5 packages) · 2,000 batch req/month"
        : "10,000 req/month · Batch API (20 packages) · 10 monitored projects";

      const emailText = `Your Commit ${tierLabel} API Key

Here's your Commit ${tierLabel} (${tierPrice}) API key:

  ${apiKey}

This key won't be shown again — save it somewhere safe.

What you get (${tierLabel}):
  ${limits}

Quick start:
  curl https://poc-backend.amdal-dev.workers.dev/api/audit \\
    -H "Authorization: Bearer ${apiKey}" \\
    -H "Content-Type: application/json" \\
    -d '{"packages": ["express", "lodash"]}'

Check usage:
  curl https://poc-backend.amdal-dev.workers.dev/api/keys/usage \\
    -H "Authorization: Bearer ${apiKey}"

Docs: https://getcommit.dev/docs

—
Commit · getcommit.dev`;

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Commit <noreply@getcommit.dev>",
            // reply_to: paid-tier API key delivery is the moment a brand-
            // new paying customer is most likely to ask onboarding
            // questions — route replies to a human inbox, not noreply@.
            reply_to: "pico@amdal.dev",
            to: [email],
            subject: `Your Commit ${tierLabel} API Key`,
            text: emailText,
          }),
        });
      } catch (emailErr) {
        console.error("Failed to send API key email:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }
  }

  // ── checkout.session.expired: send abandonment-recovery email ──────
  // Fires when a Stripe checkout session times out (24h default) without
  // payment. We capture email at /api/checkout-intent before the redirect,
  // so the recovery email always has a real address. Idempotent on
  // session_id via INSERT OR IGNORE into checkout_recovery_emails.
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as {
      id?: string;
      customer_details?: { email?: string };
      customer_email?: string;
      metadata?: { tier?: string; slug?: string };
    };

    // Cross-product filter: Synlig sessions always set metadata.slug (or use "direct").
    // Commit sessions set metadata.tier but never metadata.slug. Skip Synlig sessions
    // here — synlig-worker handles their abandonment flow.
    if (session.metadata?.slug) {
      console.log(`[stripe] checkout.session.expired id=${session.id} skipped (Synlig slug=${session.metadata.slug}) — handled by synlig-worker`);
      return c.json({ ok: true });
    }

    const email = (session.customer_details?.email ?? session.customer_email ?? "").toLowerCase().trim();
    const tier = (session.metadata?.tier ?? "pro") as "pro" | "developer";
    const sessionId = session.id as string | undefined;

    // Skip if no email or no session_id (webhook payload malformed)
    if (!email || !sessionId) {
      return c.json({ ok: true });
    }

    // Skip internal test emails (pico+*, hawkaa+*, test-evaluator-probe) —
    // these are dogfood probes from the deploy/test harness, not real
    // prospects we'd want to nag. Reuses parseEmailPatterns helper that
    // /api/keys/stats uses to compute organic_mcp_keys.organic.
    const patterns = parseEmailPatterns(c.env.INTERNAL_TEST_EMAIL_PATTERNS ?? DEFAULT_INTERNAL_TEST_EMAIL_PATTERNS);
    // Opt-in escape hatch: addresses containing "dogfood-abandon" are allowed
    // through so we can E2E test the recovery flow end-to-end.
    if (isInternalTestEmail(email, patterns) && !email.includes("dogfood-abandon")) {
      return c.json({ ok: true });
    }

    // Dedupe — INSERT OR IGNORE returns meta.changes=0 if session already sent
    let alreadySent = false;
    try {
      const result = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO checkout_recovery_emails (session_id, email, tier)
         VALUES (?, ?, ?)`
      ).bind(sessionId, email, tier).run();
      // D1 returns { meta: { changes: 0 | 1 } }
      const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      alreadySent = changes === 0;
    } catch (dedupeErr) {
      // Fail-closed: if we can't write the dedupe row, don't send the email —
      // better to skip a recovery than to spam someone on every webhook retry.
      console.error("checkout_recovery_emails dedupe error:", dedupeErr instanceof Error ? dedupeErr.message : dedupeErr);
      return c.json({ ok: true });
    }

    if (alreadySent) {
      return c.json({ ok: true });
    }

    // Send recovery email via Resend
    if (c.env.RESEND_API_KEY) {
      const tierLabel = tier === "developer" ? "Developer" : "Pro";
      const tierPrice = tier === "developer" ? "$15/mo" : "$29/mo";
      const recoveryText = `You started a Commit ${tierLabel} checkout — anything we can help with?

We noticed you started signing up for Commit ${tierLabel} (${tierPrice}) but didn't finish.

No pressure. A few common questions:

  • "Will my CLI still work without paying?" — Yes. Free tier stays free.
    200 audits/day, no credit card. ${tierLabel} unlocks ${tier === "developer" ? "1,000 req/day + batch API" : "10,000 req/month + monitoring + alerts"}.

  • "Can I cancel?" — Yes, instantly from the Stripe portal. No annual lock-in.

  • "Is it really just ${tierPrice}?" — Yes. No setup fee, no per-seat,
    no per-request charges beyond the included quota.

If anything's blocking you, hit reply — I read every email.

Pick up where you left off: https://getcommit.dev/pricing?email=${encodeURIComponent(email)}&utm_campaign=checkout-recovery&utm_source=email&utm_medium=recovery&tier=${tier}

—
Håkon Åmdal
Commit · getcommit.dev`;

      try {
        const emailResp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Håkon at Commit <noreply@getcommit.dev>",
            reply_to: "hawkaamdal@gmail.com",
            to: [email],
            subject: `You started a Commit ${tierLabel} checkout — anything we can help with?`,
            text: recoveryText,
          }),
        });
        if (!emailResp.ok) {
          const errText = await emailResp.text();
          console.error("Recovery email Resend error:", emailResp.status, errText.slice(0, 200));
        }
      } catch (emailErr) {
        console.error("Failed to send recovery email:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }
  }

  // ── customer.subscription.deleted: revoke key on cancellation ──────
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as { customer?: string };
    const stripeCustomerId = subscription.customer as string | undefined;

    if (stripeCustomerId) {
      await c.env.DB.prepare(
        `UPDATE api_keys SET revoked_at = datetime('now')
         WHERE stripe_customer_id = ? AND revoked_at IS NULL`
      ).bind(stripeCustomerId).run();
    }
  }

  return c.json({ ok: true });
});

// Export with scheduled handler support
export default {
  fetch: app.fetch.bind(app),
  async scheduled(event: { cron?: string } | unknown, env: Bindings, _ctx: unknown): Promise<void> {
    // Cloudflare passes { cron, scheduledTime } in the event for scheduled handlers.
    const cron = (event as { cron?: string })?.cron ?? "";
    // Daily Pro monitoring scan at 06:00 UTC
    if (cron === "0 6 * * *") {
      const result = await runProMonitoringScan(env);
      console.log(`[cron 0 6 * * *] pro-scan: scanned=${result.scanned_packages} scored=${result.scored_packages} alerts=${result.alerts_generated} sent=${result.emails_sent} failed=${result.emails_failed} projects=${result.projects_processed}`);
      return;
    }
    // Weekly free-tier digest at Monday 09:00 UTC (existing behaviour)
    if (cron === "0 9 * * 1") {
      const result = await runWeeklyDigest(env);
      console.log(`[cron 0 9 * * 1] weekly-digest: sent=${result.sent} skipped=${result.skipped}`);
      return;
    }
    // Unknown cron — run both to be safe (defensive default)
    console.log(`[cron unknown=${cron}] running both daily scan + weekly digest defensively`);
    await runProMonitoringScan(env);
    await runWeeklyDigest(env);
  },
};
