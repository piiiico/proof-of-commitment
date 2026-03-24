/**
 * Mock World ID OIDC Provider
 *
 * Simulates World ID's identity verification for E2E testing.
 * - Generates RSA key pair at startup
 * - Serves JWKS at /jwks.json
 * - Issues signed JWTs at /authorize (implicit flow)
 * - Verifies "unique person" by generating unique sub per nonce
 *
 * This proves the architecture works without the real World ID portal.
 */

import { Hono } from "hono";
import * as crypto from "node:crypto";

// ── Types ──

interface MockUser {
  sub: string;
  verificationLevel: "orb" | "device";
}

// ── Key generation ──

let rsaKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
let jwkPublic: Record<string, string>;
const KID = "mock-worldid-key-1";

function initKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  rsaKeyPair = {
    publicKey: crypto.createPublicKey(publicKey),
    privateKey: crypto.createPrivateKey(privateKey),
  };

  // Export public key as JWK
  const exported = rsaKeyPair.publicKey.export({ format: "jwk" }) as Record<string, string>;
  jwkPublic = {
    kty: "RSA",
    kid: KID,
    use: "sig",
    alg: "RS256",
    n: exported.n!,
    e: exported.e!,
  };
}

// ── JWT creation ──

function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function createJWT(payload: Record<string, unknown>): string {
  const header = { alg: "RS256", kid: KID, typ: "JWT" };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.sign("sha256", Buffer.from(signingInput), rsaKeyPair.privateKey);
  const signatureB64 = signature.toString("base64url");

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// ── Mock user database ──
// Each "verification" creates a unique person. In real World ID, each human gets one sub per app.
const verifiedUsers = new Map<string, MockUser>();
let userCounter = 0;

export function createMockUser(level: "orb" | "device" = "orb"): MockUser {
  userCounter++;
  const user: MockUser = {
    sub: `mock_user_${userCounter}_${Date.now()}`,
    verificationLevel: level,
  };
  verifiedUsers.set(user.sub, user);
  return user;
}

// ── Server ──

const app = new Hono();

// JWKS endpoint — same as https://id.worldcoin.org/jwks.json
app.get("/jwks.json", (c) => {
  return c.json({ keys: [jwkPublic] });
});

// OpenID Configuration
app.get("/.well-known/openid-configuration", (c) => {
  const baseUrl = `http://localhost:${mockWorldIdPort}`;
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    jwks_uri: `${baseUrl}/jwks.json`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
});

// Authorize endpoint — issues id_tokens directly (simulating implicit flow callback)
// In real World ID, this is a browser redirect. Here we return the token directly.
app.get("/authorize", (c) => {
  const clientId = c.req.query("client_id") ?? "mock_app";
  const nonce = c.req.query("nonce") ?? "test-nonce";
  const state = c.req.query("state") ?? "test-state";
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const userSub = c.req.query("sub"); // Allow specifying which mock user

  const user = userSub
    ? verifiedUsers.get(userSub) ?? createMockUser()
    : createMockUser();

  const now = Math.floor(Date.now() / 1000);
  const baseUrl = `http://localhost:${mockWorldIdPort}`;

  const idToken = createJWT({
    iss: baseUrl,
    sub: user.sub,
    aud: clientId,
    nonce,
    iat: now,
    exp: now + 3600,
    verification_level: user.verificationLevel,
  });

  // If redirect_uri is provided, simulate the redirect with fragment
  if (redirectUri) {
    const fragment = `id_token=${idToken}&state=${state}&token_type=bearer`;
    return c.redirect(`${redirectUri}#${fragment}`);
  }

  // Otherwise return the token directly (for programmatic use)
  return c.json({
    id_token: idToken,
    user,
    token_type: "bearer",
  });
});

// POST /token — programmatic token issuance for E2E tests
app.post("/token", async (c) => {
  const body = await c.req.json();
  const user = body.sub
    ? verifiedUsers.get(body.sub) ?? createMockUser(body.verification_level ?? "orb")
    : createMockUser(body.verification_level ?? "orb");

  const now = Math.floor(Date.now() / 1000);
  const baseUrl = `http://localhost:${mockWorldIdPort}`;

  const idToken = createJWT({
    iss: baseUrl,
    sub: user.sub,
    aud: body.client_id ?? "mock_app",
    nonce: body.nonce ?? `nonce_${Date.now()}`,
    iat: now,
    exp: now + 3600,
    verification_level: user.verificationLevel,
  });

  return c.json({
    id_token: idToken,
    user,
  });
});

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "mock-worldid", users: verifiedUsers.size }));

// ── Export ──

let mockWorldIdPort = 3100;

export function setPort(port: number) {
  mockWorldIdPort = port;
}

export function getPort(): number {
  return mockWorldIdPort;
}

export function startMockWorldId(port = 3100) {
  mockWorldIdPort = port;
  initKeys();
  console.log(`[Mock World ID] OIDC provider starting on :${port}`);
  return {
    port,
    fetch: app.fetch,
    getJwksUrl: () => `http://localhost:${port}/jwks.json`,
    getIssuer: () => `http://localhost:${port}`,
    createUser: createMockUser,
  };
}

// Allow standalone execution
if (import.meta.main) {
  const port = Number(process.env.PORT) || 3100;
  const server = startMockWorldId(port);
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  console.log(`[Mock World ID] Running standalone on :${port}`);
  console.log(`  JWKS: ${server.getJwksUrl()}`);
  console.log(`  Issuer: ${server.getIssuer()}`);
}
