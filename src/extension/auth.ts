/**
 * World ID OIDC authentication for Proof of Commitment extension.
 *
 * Uses the implicit flow via chrome.identity.launchWebAuthFlow.
 * World ID returns a signed JWT (id_token) which we verify and store.
 *
 * SETUP REQUIRED:
 * 1. Register app at https://developer.worldcoin.org
 * 2. Set redirect URI to the value of chrome.identity.getRedirectURL('/callback')
 * 3. Replace WORLD_ID_APP_ID below with your app_id
 */

// ── Config ──────────────────────────────────────────────────────────
const WORLD_ID_APP_ID = "app_a2868bad17534bb7e8bc82de8df73773";
const WORLD_ID_AUTHORIZE_URL = "https://id.worldcoin.org/authorize";
const WORLD_ID_JWKS_URL = "https://id.worldcoin.org/jwks.json";
const WORLD_ID_ISSUER = "https://id.worldcoin.org";

// ── Types ───────────────────────────────────────────────────────────
export interface AuthCredential {
  /** World ID subject identifier (unique per user per app) */
  sub: string;
  /** Verification level: "orb" | "device" */
  verificationLevel: string;
  /** When the credential was obtained */
  authenticatedAt: number;
  /** Raw id_token for potential backend verification */
  idToken: string;
}

interface JWTHeader {
  alg: string;
  kid: string;
  typ: string;
}

interface JWTPayload {
  iss: string;
  sub: string;
  aud: string;
  nonce: string;
  iat: number;
  exp: number;
  verification_level?: string;
  [key: string]: unknown;
}

interface JWK {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

// ── Storage keys ────────────────────────────────────────────────────
const STORAGE_KEY_AUTH = "auth:credential";

// ── Helpers ─────────────────────────────────────────────────────────

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decode a base64url-encoded string
 */
function base64urlDecode(str: string): string {
  // Replace base64url chars with base64 chars
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad with = to make length a multiple of 4
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atob(base64);
}

/**
 * Parse a JWT without verification (for extracting header and payload)
 */
function parseJWT(token: string): { header: JWTHeader; payload: JWTPayload } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const header = JSON.parse(base64urlDecode(parts[0]!)) as JWTHeader;
  const payload = JSON.parse(base64urlDecode(parts[1]!)) as JWTPayload;
  return { header, payload };
}

/**
 * Import a JWK as a CryptoKey for verification
 */
async function importJWK(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg,
      use: jwk.use,
    },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

/**
 * Verify a JWT signature using Web Crypto API
 */
async function verifyJWTSignature(
  token: string,
  key: CryptoKey
): Promise<boolean> {
  const parts = token.split(".");
  const signedContent = new TextEncoder().encode(`${parts[0]!}.${parts[1]!}`);

  // Decode the signature from base64url
  const signatureStr = parts[2]!
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const paddedSig =
    signatureStr + "=".repeat((4 - (signatureStr.length % 4)) % 4);
  const signatureBytes = Uint8Array.from(atob(paddedSig), (c) =>
    c.charCodeAt(0)
  );

  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes,
    signedContent
  );
}

/**
 * Fetch JWKS from World ID and find the key matching the token's kid
 */
async function fetchSigningKey(kid: string): Promise<CryptoKey> {
  const response = await fetch(WORLD_ID_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  const jwks = (await response.json()) as { keys: JWK[] };
  const key = jwks.keys.find((k) => k.kid === kid);
  if (!key) {
    throw new Error(`No matching key found for kid: ${kid}`);
  }
  return importJWK(key);
}

/**
 * Verify and decode a World ID id_token
 */
async function verifyIdToken(
  idToken: string,
  expectedNonce: string
): Promise<JWTPayload> {
  const { header, payload } = parseJWT(idToken);

  // 1. Verify issuer
  if (payload.iss !== WORLD_ID_ISSUER) {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  // 2. Verify audience (must be our app_id)
  if (payload.aud !== WORLD_ID_APP_ID) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  // 3. Verify nonce
  if (payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch");
  }

  // 4. Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("Token expired");
  }

  // 5. Verify signature
  const signingKey = await fetchSigningKey(header.kid);
  const valid = await verifyJWTSignature(idToken, signingKey);
  if (!valid) {
    throw new Error("Invalid token signature");
  }

  return payload;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get the redirect URL for this extension.
 * Must be registered in the World ID Developer Portal.
 */
export function getRedirectURL(): string {
  return chrome.identity.getRedirectURL("/callback");
}

/**
 * Start the World ID sign-in flow.
 * Opens World ID's authorize page via chrome.identity.launchWebAuthFlow.
 * Returns the verified credential on success.
 */
export async function signIn(): Promise<AuthCredential> {
  const nonce = generateNonce();
  const state = generateState();
  const redirectUri = getRedirectURL();

  const params = new URLSearchParams({
    client_id: WORLD_ID_APP_ID,
    response_type: "id_token",
    redirect_uri: redirectUri,
    scope: "openid",
    state: state,
    nonce: nonce,
    response_mode: "fragment",
  });

  const authUrl = `${WORLD_ID_AUTHORIZE_URL}?${params.toString()}`;

  // Launch the web auth flow — Chrome opens a popup with the auth page
  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      (callbackUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!callbackUrl) {
          reject(new Error("No callback URL received"));
          return;
        }
        resolve(callbackUrl);
      }
    );
  });

  // Parse the response URL fragment for id_token
  const hashParams = new URLSearchParams(
    responseUrl.split("#")[1] || ""
  );

  // Verify state to prevent CSRF
  const returnedState = hashParams.get("state");
  if (returnedState !== state) {
    throw new Error("State mismatch — possible CSRF attack");
  }

  const idToken = hashParams.get("id_token");
  if (!idToken) {
    const error = hashParams.get("error");
    const errorDesc = hashParams.get("error_description");
    throw new Error(
      `Authentication failed: ${error || "no id_token"} — ${errorDesc || "unknown error"}`
    );
  }

  // Verify the id_token
  const payload = await verifyIdToken(idToken, nonce);

  const credential: AuthCredential = {
    sub: payload.sub,
    verificationLevel: (payload.verification_level as string) || "unknown",
    authenticatedAt: Date.now(),
    idToken: idToken,
  };

  // Store credential
  await chrome.storage.local.set({ [STORAGE_KEY_AUTH]: credential });

  return credential;
}

/**
 * Sign out — remove stored credential.
 */
export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY_AUTH);
}

/**
 * Get the current auth credential, or null if not authenticated.
 */
export async function getCredential(): Promise<AuthCredential | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY_AUTH);
  return (result[STORAGE_KEY_AUTH] as AuthCredential) || null;
}

/**
 * Check if the user is currently authenticated.
 */
export async function isAuthenticated(): Promise<boolean> {
  const credential = await getCredential();
  return credential !== null;
}
