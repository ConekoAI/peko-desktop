import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  runtimeList,
  runtimeAdd,
  runtimeRemove,
  runtimeReconnect,
  runtimeRename,
  oauthTokenExchange,
  oauthTokenRefresh,
  pekohubListRuntimes,
  credentialSetRaw,
  credentialGetRaw,
  pekohubLogout,
  type StoredTokenBundle,
  type OAuthTokenResponse,
} from "../lib/api";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizeUrl,
} from "../lib/oauth";
import { openUrl } from "@tauri-apps/plugin-opener";

export function useRuntimes() {
  return useQuery({
    queryKey: ["runtimes"],
    queryFn: runtimeList,
    refetchInterval: 30000,
  });
}

export function useAddRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string; pekohubUrl?: string }) =>
      runtimeAdd(payload.id, payload.name, payload.pekohubUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

export function useRemoveRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runtimeRemove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

export function useReconnectRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runtimeReconnect(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

export function useRenameRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; name: string }) =>
      runtimeRename(payload.id, payload.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimes"] }),
  });
}

// ─── OAuth2 PKCE Flow ───────────────────────────────────────

/**
 * In-flight OAuth flow state (verifier + state + endpoints).
 *
 * Persisted to `sessionStorage` so that an accidental page reload
 * between `startOAuthConnect` and `exchangeOAuthCode` doesn't drop
 * the PKCE verifier — the user would otherwise have to restart the
 * whole flow. `sessionStorage` is scoped to the current tab and is
 * cleared when the tab closes, which matches the OAuth flow's
 * natural lifetime: a flow that survives a tab close is suspect
 * anyway (the browser redirect went somewhere unexpected).
 *
 * Implementation note (D3): the original code held this in a
 * module-level `let`. Module state is reset on Vite HMR and lost on
 * reload. sessionStorage is reload-survivable without a new
 * dependency — adding zustand for one piece of state would be
 * over-engineering.
 */
const OAUTH_FLOW_KEY = "peko:oauth-flow";

interface OAuthFlowState {
  verifier: string;
  state: string;
  redirectUri: string;
  baseUrl: string;
}

export function readActiveFlow(): OAuthFlowState | null {
  try {
    const raw = sessionStorage.getItem(OAUTH_FLOW_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OAuthFlowState;
  } catch {
    return null;
  }
}

export function writeActiveFlow(flow: OAuthFlowState | null): void {
  try {
    if (flow === null) {
      sessionStorage.removeItem(OAUTH_FLOW_KEY);
    } else {
      sessionStorage.setItem(OAUTH_FLOW_KEY, JSON.stringify(flow));
    }
  } catch {
    // sessionStorage may throw in private mode or when quota is
    // exhausted — fall back to the previous in-memory behaviour by
    // silently dropping persistence. The flow still works within the
    // current page.
  }
}

export interface OAuthConnectInput {
  /** PekoHub base URL (e.g. https://pekohub.org) */
  baseUrl: string;
  /** OAuth client ID (default: peko-desktop) */
  clientId?: string;
  /** Redirect URI shown to the user (e.g. http://localhost:0/callback) */
  redirectUri?: string;
  /** Optional scopes */
  scope?: string;
}

export interface OAuthConnectResult {
  added: number;
  runtimes: { id: string; name: string }[];
}

/**
 * Initiate the OAuth2 PKCE flow by opening the system browser.
 * Returns the authorize URL and stores the verifier/state locally.
 * The caller is responsible for collecting the authorization code
 * (via manual paste, local HTTP server, or custom protocol) and
 * passing it to `exchangeOAuthCode`.
 */
export async function startOAuthConnect(
  input: OAuthConnectInput,
): Promise<string> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const clientId = input.clientId ?? "peko-desktop";
  const redirectUri = input.redirectUri ?? "http://localhost:0/callback";

  const verifier = generateCodeVerifier();
  const state = generateState();
  const challenge = await generateCodeChallenge(verifier);

  writeActiveFlow({ verifier, state, redirectUri, baseUrl });

  const authorizeUrl = buildAuthorizeUrl({
    baseUrl,
    clientId,
    redirectUri,
    codeChallenge: challenge,
    state,
    scope: input.scope,
  });

  await openUrl(authorizeUrl);
  return authorizeUrl;
}

/**
 * Build a token bundle for storage, computing expiry if expires_in is provided.
 */
function buildTokenBundle(resp: OAuthTokenResponse): StoredTokenBundle {
  const bundle: StoredTokenBundle = {
    access_token: resp.access_token,
  };
  if (resp.refresh_token) {
    bundle.refresh_token = resp.refresh_token;
  }
  if (resp.expires_in) {
    const expiresAt = new Date(Date.now() + resp.expires_in * 1000);
    bundle.expires_at = expiresAt.toISOString();
  }
  return bundle;
}

/**
 * Store the OAuth token bundle in the OS keychain as JSON.
 */
async function storeOAuthBundle(bundle: StoredTokenBundle): Promise<void> {
  await credentialSetRaw("pekohub", JSON.stringify(bundle));
}

/**
 * Load the OAuth token bundle from the OS keychain.
 * Returns null if no credential is stored or parsing fails.
 */
export async function loadOAuthBundle(): Promise<StoredTokenBundle | null> {
  const raw = await credentialGetRaw("pekohub");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokenBundle;
    if (!parsed.access_token) return null;
    return parsed;
  } catch {
    // Legacy: raw token stored before bundle format
    return { access_token: raw };
  }
}

/**
 * Check if the stored access token is expired (with 60s clock skew buffer).
 */
export function isTokenExpired(bundle: StoredTokenBundle): boolean {
  if (!bundle.expires_at) return false;
  const expiry = new Date(bundle.expires_at).getTime();
  return Date.now() >= expiry - 60_000;
}

/**
 * Refresh the stored access token if a refresh_token is available.
 * Updates the stored bundle on success.
 */
export async function refreshStoredToken(
  baseUrl: string,
  clientId = "peko-desktop",
): Promise<StoredTokenBundle | null> {
  const bundle = await loadOAuthBundle();
  if (!bundle?.refresh_token) return null;

  const resp = await oauthTokenRefresh({
    baseUrl,
    clientId,
    refreshToken: bundle.refresh_token,
  });

  const newBundle = buildTokenBundle(resp);
  await storeOAuthBundle(newBundle);
  return newBundle;
}

/**
 * Exchange an authorization code for tokens, store the token bundle
 * securely, discover runtimes on PekoHub, and add them locally.
 */
export async function exchangeOAuthCode(
  code: string,
  returnedState: string,
  clientId = "peko-desktop",
): Promise<OAuthConnectResult> {
  const activeFlow = readActiveFlow();
  if (!activeFlow) {
    throw new Error("No active OAuth flow. Start the flow first.");
  }
  const { verifier, state, redirectUri, baseUrl } = activeFlow;

  if (returnedState !== state) {
    throw new Error("OAuth state mismatch. Possible CSRF attack.");
  }

  const tokenResp = await oauthTokenExchange({
    baseUrl,
    clientId,
    code,
    redirectUri,
    codeVerifier: verifier,
  });

  const accessToken = tokenResp.access_token;
  if (!accessToken) {
    throw new Error("No access_token received from token endpoint");
  }

  // Store full token bundle (access + refresh + expiry) in OS keychain
  const bundle = buildTokenBundle(tokenResp);
  await storeOAuthBundle(bundle);

  // Discover runtimes
  const runtimes = await pekohubListRuntimes(baseUrl, accessToken);

  // Add each discovered runtime
  const added: { id: string; name: string }[] = [];
  for (const rt of runtimes) {
    if (!rt.id || !rt.name) continue;
    try {
      await runtimeAdd(rt.id, rt.name, rt.url ?? baseUrl);
      added.push({ id: rt.id, name: rt.name });
    } catch {
      // Skip runtimes that fail to add (e.g. already exists)
    }
  }

  // Clear the persisted flow now that we've successfully exchanged.
  // Leaving it would let a stale verifier be replayed against a
  // future OAuth flow (low impact, but unnecessary surface).
  writeActiveFlow(null);
  return { added: added.length, runtimes: added };
}

/** TanStack Query mutation wrapper for the full OAuth exchange. */
export function useOAuthConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      code,
      state,
    }: {
      code: string;
      state: string;
    }) => exchangeOAuthCode(code, state),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runtimes"] });
      qc.invalidateQueries({ queryKey: ["credentials", "pekohub"] });
      qc.invalidateQueries({ queryKey: ["pekohub-bundle"] });
    },
  });
}

/**
 * Forget the PekoHub OAuth bundle + clear the in-flight PKCE flow.
 *
 * Server-side (`pekohub_logout` Tauri command) deletes the
 * `provider:pekohub/default` credential. The runtime's
 * `RuntimeConnection` rows with `connectionType === "pekohub"` are
 * the user's discovered-runtimes list and are NOT touched by the
 * server — the SPA simply invalidates the `runtimes` query so the
 * user re-lists from a clean slate on the next "Sign in with
 * PekoHub" click. Cached `pekohub` credential entries are also
 * invalidated so the UI re-fetches and reflects the empty state.
 *
 * Also clears any in-flight PKCE flow state from sessionStorage — a
 * stale verifier from a prior aborted sign-in is dead state.
 */
export function usePekohubLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => pekohubLogout(),
    onSuccess: () => {
      writeActiveFlow(null);
      qc.invalidateQueries({ queryKey: ["runtimes"] });
      qc.invalidateQueries({ queryKey: ["credentials", "pekohub"] });
      qc.invalidateQueries({ queryKey: ["pekohub-bundle"] });
    },
  });
}

/**
 * Reactive check: is a PekoHub OAuth bundle currently stored?
 *
 * Used by the Settings UI to decide whether to render the
 * "Sign out of PekoHub" affordance — without it, the button would
 * either lie ("you're signed out!") or no-op silently. The query
 * mirrors the `credentials/pekohub` cache key the OAuth flow
 * invalidates on success, so signing in flips the result live.
 */
export function usePekohubBundle() {
  return useQuery({
    queryKey: ["pekohub-bundle"],
    queryFn: () => loadOAuthBundle(),
    staleTime: 30_000,
  });
}
