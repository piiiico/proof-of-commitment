#!/usr/bin/env bun
/**
 * Deploy poc-backend worker to Cloudflare via REST API.
 * Bypasses wrangler's silent-failure issue in non-interactive environments.
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

// Read the built worker
const workerJs = await Bun.file("dist/worker.js").text();

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
