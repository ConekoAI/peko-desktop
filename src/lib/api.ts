//! Peko-desktop Tauri IPC client.
//!
//! The desktop talks to the local daemon over Tauri's IPC. The
//! daemon-side surface is documented in
//! `peko-runtime/docs/architecture/adr/ADR-041-principal-as-container.md`
//! (Principal-as-container) and
//! `ADR-042-no-external-session-concept.md` (no external session surface,
//! §5 terminology map). All IPC and wire-type additions in this file must
//! align with the ADR-042 terminology map: `principal_*` is the public
//! actor surface; `session` is internal storage only and must not appear
//! as a user-facing noun.
//!
//! The pre-#125 `agent_*` and `session_*` IPC variants are gone; this
//! file is the canonical entry point and is kept in lockstep with the
//! runtime's `RequestPacket`/`ResponsePacket` enums.

import { invoke, Channel } from "@tauri-apps/api/core";

import type {
  AccessiblePrincipal,
  AuthStatus,
  BindingTestResult,
  BundleItem,
  CronJob,
  Credential,
  CredentialDetail,
  DaemonStatus,
  DoctorReport,
  ExtensionSummary,
  LogResponse,
  ProviderAddArgs,
  ProviderInfo,
  ProviderTemplate,
  RotationBinding,
  RuntimeConnection,
  SearchResult,
  Setting,
  SystemStatus,
} from "../types";

// ─── Runtimes ───────────────────────────────────────────────────

export async function runtimeList(): Promise<RuntimeConnection[]> {
  return invoke("runtime_list");
}

export async function runtimeAdd(
  id: string,
  name: string,
  pekohubUrl?: string,
): Promise<RuntimeConnection> {
  return invoke("runtime_add", { id, name, pekohub_url: pekohubUrl });
}

export async function runtimeRemove(id: string): Promise<void> {
  return invoke("runtime_remove", { id });
}

export async function runtimeReconnect(id: string): Promise<RuntimeConnection> {
  return invoke("runtime_reconnect", { id });
}

export async function runtimeRename(
  id: string,
  name: string,
): Promise<RuntimeConnection> {
  return invoke("runtime_rename", { id, name });
}

// ─── Daemon ─────────────────────────────────────────────────────
//
// Legacy daemon commands. As of ADR-043 the engine lifecycle is
// owned by the sidecar supervisor; these wrappers remain so the
// pre-#127 callers (StatusBar legacy paths, etc.) keep working
// while we migrate UI surfaces to `engine_*`. New code should use
// the wrappers below this section instead.

export async function daemonStart(): Promise<DaemonStatus> {
  return invoke("daemon_start");
}

export async function daemonStop(): Promise<DaemonStatus> {
  return invoke("daemon_stop");
}

export async function daemonRestart(): Promise<DaemonStatus> {
  return invoke("daemon_restart");
}

export async function daemonStatus(): Promise<DaemonStatus> {
  return invoke("daemon_status");
}

// ─── Engine (ADR-043) ────────────────────────────────────────────
//
// Engine commands talk to the sidecar supervisor directly. The
// supervisor is the canonical owner of the bundled `peko` child
// process — its `EngineState` is what the UI should drive the
// header badge and version banners from. The legacy `daemon_*`
// commands above are now thin proxies over this same supervisor.

import type { EngineDiagnostics, EngineState } from "../types";

export async function engineStatus(): Promise<EngineState> {
  return invoke<EngineState>("engine_status");
}

export async function engineDiagnostics(): Promise<EngineDiagnostics> {
  return invoke<EngineDiagnostics>("engine_diagnostics");
}

export async function engineRestart(): Promise<number> {
  return invoke<number>("engine_restart");
}

// ─── Principal (ADR-041) ─────────────────────────────────────────

/**
 * Lightweight summary row for the principal list / sidebar.
 *
 * Mirrors the desktop's `PrincipalSummary` struct in
 * `src-tauri/src/commands/principal.rs` (the desktop projects the
 * runtime's full `PrincipalSummary` down to this six-field shape).
 */
export interface PrincipalSummary {
  name: string;
  exposure: string;
  status: string;
  description?: string;
  owner: string;
  runtimeId: string;
}

export async function principalList(): Promise<PrincipalSummary[]> {
  return invoke<PrincipalSummary[]>("principal_list");
}

/**
 * Look up a single Principal by name. Returns `null` on a miss —
 * the runtime surfaces misses as `{principal: null}` envelopes,
 * never as errors.
 */
export async function principalGet(
  name: string,
): Promise<PrincipalSummary | null> {
  return invoke<PrincipalSummary | null>("principal_get", { name });
}

/**
 * Create a new Principal on the active local runtime. Thin proxy
 * over the runtime's `principal_create` IPC variant (peko-runtime PR
 * #185); the runtime persists the workspace, `agents/primary.md`,
 * `principal.toml`, and registers the principal in the in-memory
 * manager.
 *
 * Optional fields flow as `null` over the wire — the runtime has
 * `#[serde(default)]` on each option so a partial request still
 * round-trips cleanly. Used by the desktop's create modal and the
 * first-run walkthrough's last step.
 */
export interface PrincipalCreateRequest {
  name: string;
  description?: string;
  preferredProviderId?: string;
  preferredModelId?: string;
}

export async function principalCreate(
  req: PrincipalCreateRequest,
): Promise<PrincipalSummary> {
  return invoke<PrincipalSummary>("principal_create", {
    name: req.name,
    description: req.description ?? null,
    preferred_provider_id: req.preferredProviderId ?? null,
    preferred_model_id: req.preferredModelId ?? null,
  });
}

/**
 * Send a non-streaming message to a Principal and return the
 * supervisor's final answer.
 */
export async function principalSend(
  name: string,
  message: string,
): Promise<string> {
  return invoke<string>("principal_send", { name, message });
}

/**
 * Send a streaming message to a Principal. Each supervisor chunk
 * is pushed to `onChunk` as it arrives; the resolved promise carries
 * the full final answer (identical content to the non-streaming
 * `principalSend` would have returned).
 */
export async function principalSendStream(
  name: string,
  message: string,
  onChunk: (delta: string) => void,
): Promise<string> {
  const channel = new Channel<string>();
  channel.onmessage = onChunk;
  return invoke<string>("principal_send_stream", {
    name,
    message,
    onChunk: channel,
  });
}

/**
 * Read a peer's conversation thread with a Principal (ADR-042).
 *
 * `peer` is the Subject string (`user:alice`, `principal:<did>`). Pass
 * `undefined` to read the principal's owner-root view. The runtime
 * enforces the privacy contract — see
 * `peko-runtime/docs/architecture/adr/ADR-042-no-external-session-concept.md`.
 */
export async function principalLog(params: {
  name: string;
  peer?: string;
  limit?: number;
  sinceSecs?: number;
}): Promise<LogResponse> {
  return invoke("principal_log", {
    name: params.name,
    peer: params.peer ?? null,
    limit: params.limit ?? null,
    since_secs: params.sinceSecs ?? null,
  });
}

/**
 * List the runtime's provider catalog. The catalog is referenced by
 * id from `principal.toml`'s `preferred_provider_id` soft hint; the
 * catalog + keychain own all provider wiring.
 */
export async function principalProviderList(): Promise<ProviderInfo[]> {
  return invoke("principal_provider_list");
}

// T-109b: list the runtime's built-in provider templates. The picker
// uses these to seed the "Add Provider" modal — no rounding to
// `ProviderInfo` (the picker needs `baseUrl`, `requiresKey`, and the
// curated `models[]` with context lengths, which `ProviderInfo` does
// not carry).
export async function providerTemplates(): Promise<ProviderTemplate[]> {
  return invoke("provider_templates");
}

// T-109b: add a provider to the runtime catalog. Either a `template`
// string (binds to one of `provider_templates()`) or `custom: true` with
// the full shape (id, apiFormat, baseUrl, model, …). Sending neither
// produces a `ResponsePacket::Error` from the runtime, which the Tauri
// command surfaces as a thrown error.
export async function providerAdd(args: ProviderAddArgs): Promise<ProviderInfo> {
  return invoke("provider_add", { args });
}

// ─── Extensions ─────────────────────────────────────────────────

export async function extensionList(): Promise<ExtensionSummary[]> {
  return invoke("extension_list");
}

export async function extensionInstall(path: string): Promise<ExtensionSummary> {
  return invoke("extension_install", { path });
}

export async function extensionUninstall(name: string): Promise<void> {
  return invoke("extension_uninstall", { name });
}

// ─── Registry ───────────────────────────────────────────────────

export async function registrySearch(
  query: string,
  page: number,
  perPage: number,
): Promise<{ items: SearchResult[]; total: number }> {
  return invoke("registry_search", { query, page, perPage });
}

export async function registryPull(ref: string): Promise<BundleItem> {
  return invoke("registry_pull", { ref });
}

export async function registryAuthStatus(): Promise<AuthStatus> {
  return invoke("registry_auth_status");
}

export async function registryLogin(
  username: string,
  token: string,
): Promise<AuthStatus> {
  return invoke("registry_login", { username, token });
}

export async function registryLogout(): Promise<void> {
  return invoke("registry_logout");
}

// ─── Cron ───────────────────────────────────────────────────────

export async function cronList(): Promise<CronJob[]> {
  return invoke("cron_list");
}

export async function cronAdd(payload: {
  name: string;
  schedule: string;
  command: string;
  enabled?: boolean;
}): Promise<CronJob> {
  return invoke("cron_add", { payload });
}

export async function cronRemove(id: string): Promise<void> {
  return invoke("cron_remove", { id });
}

export async function cronRun(id: string): Promise<void> {
  return invoke("cron_run", { id });
}

// ─── Settings ───────────────────────────────────────────────────

export async function settingsGet(key: string): Promise<string | null> {
  return invoke("settings_get", { key });
}

export async function settingsSet(key: string, value: string): Promise<void> {
  return invoke("settings_set", { key, value });
}

export async function settingsList(): Promise<Setting[]> {
  return invoke("settings_list");
}

// ─── Credentials (keychain) ─────────────────────────────────────

export async function credentialGet(provider: string): Promise<Credential | null> {
  return invoke("credential_get", { provider });
}

export async function credentialSet(
  provider: string,
  apiKey: string,
): Promise<void> {
  // Tauri 2 default-renames command arg names from Rust snake_case
  // to JS camelCase for the invoke payload (see `tauri-macros`
  // `command/wrapper.rs:510`), so the Rust `api_key: String` param
  // surfaces as `apiKey` on the JS side. Sending `api_key` (snake_case
  // in the payload) makes the deserializer reject the request with
  // "missing required key apiKey".
  return invoke("credential_set", { provider, apiKey });
}

/**
 * Raw-string credential accessors used by the OAuth2 PKCE flow
 * (`useRuntimes.ts`) to store/retrieve the JSON-serialized token
 * bundle. They bypass the typed `Credential` shape used by Settings
 * (which never holds the secret).
 */
export async function credentialSetRaw(
  provider: string,
  rawValue: string,
): Promise<void> {
  // Tauri 2 default-renames Rust snake_case arg names to camelCase for
  // the invoke payload, so the Rust `raw_value` param surfaces as
  // `rawValue` on the JS side.
  return invoke("credential_set_raw", { provider, rawValue });
}

export async function credentialGetRaw(provider: string): Promise<string | null> {
  return invoke<string | null>("credential_get_raw", { provider });
}

export async function credentialDelete(provider: string): Promise<void> {
  return invoke("credential_delete", { provider });
}

export type CredentialTestResult = {
  success: boolean;
  message: string;
  latencyMs: number;
  httpStatus: number | null;
  modelUsed: string | null;
};

export async function credentialTest(
  provider: string,
): Promise<CredentialTestResult> {
  return invoke("credential_test", { provider });
}

export async function credentialList(): Promise<Credential[]> {
  return invoke("credential_list");
}

// ─── RP4 Generic vault credentials ────────────────────────────────

export async function credentialGetById(
  id: string,
): Promise<CredentialDetail> {
  return invoke("credential_get_by_id", { id });
}

export async function credentialGetMaterial(
  id: string,
  reason: string,
): Promise<string> {
  return invoke<string>("credential_get_material", { id, reason });
}

export async function credentialSetGeneric(payload: {
  namespace: string;
  name: string;
  kind: import("../types").CredentialKind;
  material: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return invoke<string>("credential_set_generic", payload);
}

export async function credentialDeleteById(id: string): Promise<void> {
  return invoke("credential_delete_by_id", { id });
}

export async function credentialTestById(
  id: string,
): Promise<CredentialTestResult> {
  return invoke("credential_test_by_id", { id });
}

export async function credentialListGeneric(
  namespace?: string,
  kind?: string,
): Promise<CredentialDetail[]> {
  return invoke<CredentialDetail[]>("credential_list_generic", {
    namespace: namespace ?? null,
    kind: kind ?? null,
  });
}

// ─── RP4 Rotation bindings ───────────────────────────────────────

export async function bindingList(): Promise<RotationBinding[]> {
  return invoke<RotationBinding[]>("binding_list");
}

export async function bindingGet(key: string): Promise<RotationBinding | null> {
  return invoke<RotationBinding | null>("binding_get", { key });
}

export async function bindingSet(
  key: string,
  strategy: string,
  order: string[],
): Promise<void> {
  return invoke("binding_set", { key, strategy, order });
}

export async function bindingDelete(key: string): Promise<void> {
  return invoke("binding_delete", { key });
}

export async function bindingTestRotation(
  key: string,
): Promise<BindingTestResult[]> {
  return invoke<BindingTestResult[]>("binding_test_rotation", { key });
}

// ─── System ─────────────────────────────────────────────────────

export async function systemStatus(runtimeId?: string): Promise<SystemStatus> {
  return invoke("system_status", { runtime_id: runtimeId });
}

export async function systemDoctor(runtimeId?: string): Promise<DoctorReport> {
  return invoke("system_doctor", { runtime_id: runtimeId });
}

// ─── Accessible Principals ──────────────────────────────────

export async function accessiblePrincipalsList(): Promise<AccessiblePrincipal[]> {
  return invoke("accessible_principals_list");
}

// ─── OAuth / PekoHub (frontend-side) ────────────────────────────

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** Stored token bundle in the OS keychain (JSON-serialized). */
export interface StoredTokenBundle {
  access_token: string;
  refresh_token?: string;
  /** ISO 8601 expiry timestamp */
  expires_at?: string;
}

export interface PekohubRuntime {
  id: string;
  name: string;
  url?: string;
}

/**
 * Exchange an OAuth authorization code for tokens.
 * This calls the PekoHub token endpoint directly from the frontend.
 */
export async function oauthTokenExchange(params: {
  baseUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const url = new URL("/oauth/token", params.baseUrl);
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: params.clientId,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

/**
 * Refresh an OAuth access token using a refresh token.
 */
export async function oauthTokenRefresh(params: {
  baseUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const url = new URL("/oauth/token", params.baseUrl);
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: params.clientId,
      refresh_token: params.refreshToken,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Token refresh failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

/**
 * List runtimes registered to the authenticated user on PekoHub.
 */
export async function pekohubListRuntimes(
  baseUrl: string,
  accessToken: string,
): Promise<PekohubRuntime[]> {
  const url = new URL("/v1/runtimes", baseUrl);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Failed to list runtimes (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  // The endpoint may return { runtimes: [...] } or just [...]
  const arr = Array.isArray(data) ? data : data.runtimes;
  if (!Array.isArray(arr)) {
    throw new Error("Unexpected response format from PekoHub");
  }
  return arr.map((r: Record<string, unknown>) => ({
    id: String(r.id ?? r.runtime_id ?? ""),
    name: String(r.name ?? r.display_name ?? r.id ?? ""),
    url: r.url ? String(r.url) : undefined,
  }));
}