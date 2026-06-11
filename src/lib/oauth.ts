/**
 * OAuth2 PKCE helpers for PekoHub authentication.
 *
 * Generates code verifiers, code challenges (S256), and state parameters
 * entirely in the frontend so no secret is required.
 */

const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Generate a cryptographically random PKCE code verifier (128 chars). */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(128);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length])
    .join("");
}

/** Generate a random state parameter for CSRF protection. */
export function generateState(length = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length])
    .join("");
}

/** Compute the S256 code challenge from a verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(digest));
}

function base64urlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build the PekoHub OAuth authorize URL. */
export function buildAuthorizeUrl(params: {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL("/oauth/authorize", params.baseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  if (params.scope) {
    url.searchParams.set("scope", params.scope);
  }
  return url.toString();
}
