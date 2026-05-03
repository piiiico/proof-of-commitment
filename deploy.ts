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
 * Extract meaningful tokens from JS source for divergence detection.
 *
 * Focuses on:
 *  1. String literals (quoted) — catches API routes, field names, URLs, messages
 *  2. Identifiers ≥7 chars not in the JS keyword list — catches function/variable names
 *
 * Both are strong signals that a production-only patch introduced new logic.
 */
function extractMeaningfulTokens(source: string): Set<string> {
  const tokens = new Set<string>();

  // String literals (single or double quoted, content ≥3 chars)
  const strRe = /(?:"([^"\\]{3,}(?:\\.[^"\\]*)*)"|'([^'\\]{3,}(?:\\.[^'\\]*)*)')/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(source)) !== null) {
    const inner = m[1] ?? m[2];
    tokens.add(`"${inner}"`);
  }

  // Identifiers ≥7 characters, not in common keyword set
  const identRe = /\b([a-zA-Z_$][a-zA-Z0-9_$]{6,})\b/g;
  while ((m = identRe.exec(source)) !== null) {
    const id = m[1];
    if (!SKIP_IDENTIFIERS.has(id)) tokens.add(id);
  }

  return tokens;
}

// Read the built worker
const workerJs = await Bun.file("dist/worker.js").text();

// Run pre-deploy divergence check
console.log("🔍 Pre-deploy guard: comparing local build vs deployed worker...");
const deployedWorkerJs = await fetchDeployedWorker();

if (deployedWorkerJs !== null) {
  const localTokens = extractMeaningfulTokens(workerJs);
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

// Metadata for the worker upload
const metadata = {
  main_module: "worker.js",
  compatibility_date: "2024-12-01",
  bindings: [
    {
      type: "d1",
      name: "DB",
      id: D1_DATABASE_ID,
    },
    {
      type: "plain_text",
      name: "ENVIRONMENT",
      text: "production",
    },
  ],
};

// Build multipart form data
const formData = new FormData();
formData.append(
  "metadata",
  new Blob([JSON.stringify(metadata)], { type: "application/json" })
);
formData.append(
  "worker.js",
  new Blob([workerJs], { type: "application/javascript+module" }),
  "worker.js"
);

console.log(`Deploying ${WORKER_NAME} to Cloudflare Workers...`);

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`,
  {
    method: "PUT",
    headers: {
      "X-Auth-Email": EMAIL,
      "X-Auth-Key": API_KEY,
    },
    body: formData,
  }
);

const result = await res.json() as any;

if (result.success) {
  console.log(`✅ Worker deployed successfully!`);
  console.log(`   URL: https://${WORKER_NAME}.amdal-dev.workers.dev`);

  // Enable the workers.dev subdomain route
  const subdomainRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/subdomain`,
    {
      method: "POST",
      headers: {
        "X-Auth-Email": EMAIL,
        "X-Auth-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    }
  );
  const subdomainResult = await subdomainRes.json() as any;
  if (subdomainResult.success) {
    console.log(`   Subdomain enabled.`);
  } else {
    console.warn("   Subdomain enable warning:", subdomainResult.errors);
  }
  // Register cron schedules (PUT /schedules replaces all existing schedules)
  const cronRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/schedules`,
    {
      method: "PUT",
      headers: {
        "X-Auth-Email": EMAIL,
        "X-Auth-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ cron: "0 9 * * 1" }]),
    }
  );
  const cronResult = await cronRes.json() as any;
  if (cronResult.success) {
    console.log(`   Cron schedule registered: 0 9 * * 1 (Monday 09:00 UTC)`);
  } else {
    console.warn("   Cron schedule warning:", cronResult.errors);
  }

  // Verify cron registration
  const verifyCronRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/schedules`,
    {
      headers: {
        "X-Auth-Email": EMAIL,
        "X-Auth-Key": API_KEY,
      },
    }
  );
  const verifyCronResult = await verifyCronRes.json() as any;
  if (verifyCronResult.success && verifyCronResult.result?.schedules?.length > 0) {
    console.log(`   Verified schedules: ${verifyCronResult.result.schedules.map((s: any) => s.cron).join(", ")}`);
  } else {
    console.warn("   Could not verify cron schedules:", verifyCronResult);
  }
} else {
  console.error("❌ Deploy failed:", JSON.stringify(result.errors, null, 2));
  process.exit(1);
}
