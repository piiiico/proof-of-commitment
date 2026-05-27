#!/usr/bin/env bun
/**
 * Deploy poc-backend worker to Cloudflare via REST API.
 * Bypasses wrangler's silent-failure issue in non-interactive environments.
 *
 * Pre-deploy guard: detects tokens present in the deployed worker but absent from
 * the local build, indicating a production-only patch that wasn't committed to source.
 * Warns loudly and requests confirmation before overwriting.
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const EMAIL = process.env.CLOUDFLARE_EMAIL!;
const API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY!;
const WORKER_NAME = "poc-backend";
const D1_DATABASE_ID = "6ef7b6a9-1d09-4a0f-9ddd-c869a0582460";

if (!ACCOUNT_ID || !EMAIL || !API_KEY) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL, or CLOUDFLARE_GLOBAL_API_KEY");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// PRE-DEPLOY GUARD: local branch staleness check
// ---------------------------------------------------------------------------
//
// Catches the case where a long-running container has a checkout that's behind
// origin/main. Without this, wrangler will happily build the stale source and
// the deploy will wipe out commits that landed on main while the container was
// asleep. (2026-05-22 incident: a session container deployed a worker.ts that
// was 4 commits behind origin/main, regressing the shared-IP 429 rescue and
// SSR bypass for ~5 minutes before re-deploy fixed it.)
//
// Override: DEPLOY_FORCE_STALE=1.
{
  const { $ } = await import("bun");
  const fetchResult = await $`git fetch origin main`.quiet().nothrow();
  if (fetchResult.exitCode === 0) {
    const behindResult = await $`git rev-list --count HEAD..origin/main`.quiet().nothrow();
    const behind = parseInt(behindResult.stdout.toString().trim(), 10);
    if (Number.isFinite(behind) && behind > 0) {
      console.error(`⛔ Pre-deploy guard: local HEAD is ${behind} commit(s) behind origin/main.`);
      console.error("   Deploying now would wipe those commits from production.");
      console.error("   Run: git pull --rebase origin main");
      if (process.env.DEPLOY_FORCE_STALE !== "1") {
        console.error("   Override: DEPLOY_FORCE_STALE=1 bun deploy.ts");
        process.exit(1);
      }
      console.warn("   DEPLOY_FORCE_STALE=1 — proceeding despite staleness.\n");
    }
  } else {
    console.warn("⚠️  Pre-deploy guard: git fetch failed — skipping staleness check");
  }
}

// ---------------------------------------------------------------------------
// PRE-DEPLOY GUARD: source/production divergence detection
// ---------------------------------------------------------------------------

/**
 * Fetch the currently-deployed worker script from Cloudflare.
 * The API returns a multipart/form-data response; we extract the worker.js part.
 * Returns null if the worker doesn't exist yet or can't be fetched.
 */
async function fetchDeployedWorker(): Promise<string | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`,
    {
      headers: {
        "X-Auth-Email": EMAIL,
        "X-Auth-Key": API_KEY,
      },
    }
  );

  if (res.status === 404) return null; // First deploy — nothing to compare
  if (!res.ok) {
    console.warn(`⚠️  Pre-deploy guard: could not fetch deployed worker (HTTP ${res.status}) — skipping check`);
    return null;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();

  if (!contentType.includes("multipart")) {
    // Unlikely single-part response — use as-is
    return body;
  }

  // Parse multipart boundary
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    console.warn("⚠️  Pre-deploy guard: could not parse multipart boundary — skipping check");
    return null;
  }
  const boundary = boundaryMatch[1];

  // Split on boundary lines and find the worker.js part
  const parts = body.split(new RegExp(`--${boundary}(?:--)?`));
  for (const part of parts) {
    if (part.includes('name="worker.js"') || part.includes("name=worker.js")) {
      // Content follows the blank line after headers
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd !== -1) return part.slice(headerEnd + 4).trimEnd();
      const headerEndLf = part.indexOf("\n\n");
      if (headerEndLf !== -1) return part.slice(headerEndLf + 2).trimEnd();
    }
  }

  console.warn("⚠️  Pre-deploy guard: could not locate worker.js in multipart response — skipping check");
  return null;
}

// Common JS/TS keywords and built-ins — excluded from identifier comparison
// to keep the signal-to-noise ratio high.
const SKIP_IDENTIFIERS = new Set([
  "abstract","arguments","async","await","boolean","break","byte","case","catch",
  "char","class","const","continue","debugger","default","delete","do","double",
  "else","enum","eval","export","extends","false","final","finally","float","for",
  "function","goto","if","implements","import","in","instanceof","int","interface",
  "let","long","native","new","null","package","private","protected","public",
  "return","short","static","super","switch","this","throw","throws","true","try",
  "typeof","undefined","var","void","while","with","yield","from","of","get","set",
  "Object","Array","String","Number","Boolean","Symbol","Map","Set","Promise",
  "Error","Math","JSON","console","process","module","require","exports","global",
  "fetch","Response","Request","Headers","FormData","Blob","URL","Date","RegExp",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent",
  "toString","valueOf","prototype","constructor","length","name","message","stack",
  "then","catch","finally","resolve","reject","status","headers","body","text",
  "json","ok","method","url","type","data","error","result","success","value",
  "index","count","items","list","keys","values","entries","push","pop","shift",
  "unshift","splice","slice","join","split","map","filter","reduce","find","some",
  "every","forEach","includes","indexOf","hasOwnProperty","assign","create","keys",
  "entries","values","freeze","seal","defineProperty","getOwnPropertyNames",
  "stringify","parse","log","warn","info","debug","error","trace","group","groupEnd",
  "env","exit","argv","cwd","stdout","stderr","stdin",
]);

/**
 * Extract application-specific tokens from JS/TS source for divergence detection.
 *
 * Only captures tokens likely to indicate real application-level divergence:
 *  1. Route strings — paths starting with /api/, /mcp, /badge, etc.
 *  2. URL strings — full https:// URLs
 *  3. Custom identifiers matching our naming patterns (build*, lookup*, audit*, etc.)
 *
 * Deliberately ignores library-internal code (Hono router, Zod validators, etc.)
 * which differs between bundlers (bun build vs wrangler/esbuild) and produces
 * thousands of false positives. (2026-05-27: reduced from 8594 false positives to 0.)
 */
function extractMeaningfulTokens(source: string): Set<string> {
  const tokens = new Set<string>();

  // Route-like strings: /api/..., /mcp/..., /badge/..., /npm/..., etc.
  // Require at least one path segment after the prefix to avoid bare /api (Hono internal).
  const routeRe = /["'](\/(?:api|mcp|badge|npm|pypi|cargo|go|audit|pricing|get-started|checkout|webhook)\/[^\s"']*?)["']/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(source)) !== null) {
    tokens.add(`route:${m[1]}`);
  }

  // URL strings (https://...) — exclude well-known library URLs
  const LIBRARY_URL_PATTERNS = [
    /json-schema\.org/,
    /example\.com/,
    /ajv-validator/,
    /schemas\.openapis\.org/,
  ];
  const urlRe = /["'](https?:\/\/[^\s"']+)["']/g;
  while ((m = urlRe.exec(source)) !== null) {
    const url = m[1];
    if (!LIBRARY_URL_PATTERNS.some((p) => p.test(url))) {
      tokens.add(`url:${url}`);
    }
  }

  // Application-specific identifiers (our naming patterns)
  const appIdentRe = /\b(build(?:Npm|PyPI|Cargo|Golang|GitHub)\w+|lookup\w+Package|audit\w+|runWeekly\w+|runPro\w+|bumpAudit\w+|withMcpRate\w+|generateBadge\w*|generatePackageOg\w*)\b/g;
  while ((m = appIdentRe.exec(source)) !== null) {
    tokens.add(`fn:${m[1]}`);
  }

  return tokens;
}

// Read ALL source files that get bundled into the worker (worker.ts imports
// npm.ts, github.ts, golang.ts, etc.) — comparing just worker.ts misses URLs
// and identifiers defined in those modules.
import { readdir } from "node:fs/promises";
const srcFiles = await readdir("src/backend", { recursive: true });
const tsFiles = srcFiles.filter((f) => f.endsWith(".ts"));
const workerTsParts: string[] = [];
for (const f of tsFiles) {
  workerTsParts.push(await Bun.file(`src/backend/${f}`).text());
}
const workerTs = workerTsParts.join("\n");

// Run pre-deploy divergence check
console.log("🔍 Pre-deploy guard: comparing source vs deployed worker...");
const deployedWorkerJs = await fetchDeployedWorker();

if (deployedWorkerJs !== null) {
  const localTokens = extractMeaningfulTokens(workerTs);
  const deployedTokens = extractMeaningfulTokens(deployedWorkerJs);

  // Find tokens present in production but absent from local build
  const productionOnly: string[] = [];
  for (const token of deployedTokens) {
    if (!localTokens.has(token)) productionOnly.push(token);
  }

  if (productionOnly.length > 0) {
    // Sort for readability: strings first, then identifiers
    productionOnly.sort((a, b) => {
      const aStr = a.startsWith('"');
      const bStr = b.startsWith('"');
      if (aStr !== bStr) return aStr ? -1 : 1;
      return a.localeCompare(b);
    });

    console.log("");
    console.log("┌─────────────────────────────────────────────────────────────────┐");
    console.log("│  ⚠️  PRODUCTION DIVERGENCE DETECTED                              │");
    console.log("│  The deployed worker has tokens NOT in your local build.         │");
    console.log("│  This may indicate a production-only patch that was never        │");
    console.log("│  committed to source. Deploying will OVERWRITE these changes.    │");
    console.log("└─────────────────────────────────────────────────────────────────┘");
    console.log("");
    console.log(`  Production-only tokens (${productionOnly.length}):`);
    for (const t of productionOnly.slice(0, 40)) {
      console.log(`    - ${t}`);
    }
    if (productionOnly.length > 40) {
      console.log(`    ... and ${productionOnly.length - 40} more`);
    }
    console.log("");

    const forceEnv = process.env.DEPLOY_FORCE === "1";
    const isTTY = process.stdin.isTTY;

    if (forceEnv) {
      console.log("  DEPLOY_FORCE=1 — proceeding despite divergence.\n");
    } else if (isTTY) {
      process.stdout.write("  Type CONFIRM to proceed anyway, or anything else to abort: ");
      const answer = await new Promise<string>((resolve) => {
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.once("data", (chunk) => {
          buf += chunk;
          resolve(buf.trim());
        });
        process.stdin.resume();
      });
      if (answer !== "CONFIRM") {
        console.log("\n  Aborted. Commit the missing source changes before deploying.");
        process.exit(1);
      }
      console.log("");
    } else {
      console.error(
        "  Non-interactive mode: set DEPLOY_FORCE=1 to override divergence check."
      );
      process.exit(1);
    }
  } else {
    console.log("✅ Pre-deploy guard: no production-only tokens found — source is in sync.\n");
  }
} else {
  console.log("   (skipped — no existing deployment to compare)\n");
}

// ── Deploy via wrangler ──────────────────────────────────────────────────────
// wrangler handles WASM module bindings (declared in wrangler.toml) natively.
// The REST API approach (wasm_module binding) is not supported for ES module workers.
console.log(`Deploying ${WORKER_NAME} via wrangler...`);

const { $ } = await import("bun");

const deployResult = await $`bunx wrangler deploy`
  .env({
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_KEY: API_KEY,
    CLOUDFLARE_EMAIL: EMAIL,
  })
  .nothrow();

if (deployResult.exitCode !== 0) {
  console.error("❌ Deploy failed with exit code", deployResult.exitCode);
  process.exit(deployResult.exitCode);
}

console.log(`\n✅ Deployed! URL: https://${WORKER_NAME}.amdal-dev.workers.dev`);
