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
  AuthStatus,
  BundleItem,
  CapabilityList,
  CronJob,
  CredentialDetail,
  DaemonStatus,
  ExtensionSummary,
  LogResponse,
  ModelAddArgs,
  ModelPresetInfo,
  ModelSummary,
  ModelTestResult,
  ModelUpdateArgs,
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
  preferredModelId?: string;
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
 * Model-first migration: every new Principal must be pinned to a
 * configured model. `modelId` is forwarded as `model_id` to the
 * runtime command.
 */
export interface PrincipalCreateRequest {
  name: string;
  description?: string;
  modelId: string;
}

export async function principalCreate(
  req: PrincipalCreateRequest,
): Promise<PrincipalSummary> {
  return invoke<PrincipalSummary>("principal_create", {
    name: req.name,
    description: req.description ?? null,
    modelId: req.modelId,
  });
}

export interface PrincipalUpdateRequest {
  name: string;
  description?: string;
  status?: string;
  exposure?: string;
  preferredModelId?: string;
}

export async function principalUpdate(
  req: PrincipalUpdateRequest,
): Promise<PrincipalSummary> {
  return invoke<PrincipalSummary>("principal_update", {
    name: req.name,
    description: req.description ?? null,
    status: req.status ?? null,
    exposure: req.exposure ?? null,
    preferredModelId: req.preferredModelId ?? null,
  });
}

export async function principalRemove(name: string): Promise<boolean> {
  return invoke<boolean>("principal_remove", { name });
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
 * Result of a streaming send. `requestId` is the runtime correlation
 * id for the in-flight run; the caller holds onto it so a follow-up
 * `principalSendControl({mode: "steer"})` can target the same run.
 * The runtime's `streaming_runs` registry is keyed by this id, so a
 * mismatch silently drops the control packet as `UnknownRun`.
 */
export interface PrincipalSendStreamResult {
  requestId: number;
  content: string;
}

/**
 * Stream event payload from `principalSendStream`. Mirrors the Rust
 * `ChatStreamMsg` enum (tagged `kind: "chunk" | "iteration"`):
 *
 * - `chunk`     — assistant text delta for the current iteration.
 * - `iteration` — content-free boundary marker; emitted at the start
 *                 of every agentic loop iteration. The frontend uses
 *                 it to break chat bubbles between iterations and
 *                 drive the "Thinking…" pill. The counter starts at 1.
 */
export type ChatStreamMsg =
  | { kind: "chunk"; delta: string }
  | { kind: "iteration"; iteration: number };

/**
 * Send a streaming message to a Principal. Each supervisor event
 * (chunk delta or iteration boundary) is pushed to `onEvent` as it
 * arrives; the resolved promise carries the full final answer plus
 * the runtime correlation id.
 *
 * `requestId` is supplied by the caller (see `nextRequestId` in
 * `usePrincipals`) so the JS side can stash it in a ref BEFORE the
 * call — that way a subsequent `principalSendControl({mode: "steer"})`
 * can target the in-flight run. The runtime registers the run keyed
 * by this id; if the JS caller did not mint it themselves the value
 * in the result envelope would only be visible after settle, which
 * is too late to steer.
 */
export async function principalSendStream(
  name: string,
  message: string,
  requestId: number,
  onEvent: (msg: ChatStreamMsg) => void,
): Promise<PrincipalSendStreamResult> {
  const channel = new Channel<ChatStreamMsg>();
  channel.onmessage = onEvent;
  return invoke<PrincipalSendStreamResult>("principal_send_stream", {
    name,
    message,
    requestId,
    onEvent: channel,
  });
}

/**
 * Send a control packet targeting an in-flight streaming send.
 *
 * - `mode: "interrupt"` — soft-cancel: the run aborts at the next
 *   agentic-loop seam and returns the partial assistant text.
 * - `mode: "steer"` — `text` is pushed onto the run's inbox and the
 *   next agentic iteration drains it as new context. Used by the
 *   chat input when a stream is already running and the user wants
 *   to redirect mid-flight.
 *
 * `targetRequestId` must equal the `requestId` returned by the
 * originating `principalSendStream` call. The runtime returns
 * `{status: "applied"}` on success or `{status: "unknown_run"}` if
 * the id has already settled.
 */
export interface PrincipalSendControlArgs {
  targetRequestId: number;
  mode:
    | { mode: "interrupt" }
    | { mode: "steer"; text: string };
}

export async function principalSendControl(
  args: PrincipalSendControlArgs,
): Promise<{ status: string }> {
  return invoke<{ status: string }>("principal_send_control", {
    targetRequestId: args.targetRequestId,
    mode: args.mode,
  });
}

type WireSubject =
  | string
  | { kind?: string; id?: string; did?: string; value?: string };

/** Normalize runtime Subject values to the tagged strings used by the UI. */
function subjectToString(subject: WireSubject): string {
  if (typeof subject === "string") return subject;
  const kind = subject.kind ?? "subject";
  const id = subject.id ?? subject.did ?? subject.value ?? "";
  return id ? `${kind}:${id}` : kind;
}

function normalizePrincipalLog(response: LogResponse): LogResponse {
  return {
    ...response,
    peer: subjectToString(response.peer as WireSubject),
    messages: response.messages.map((message) => ({
      ...message,
      sender: subjectToString(message.sender as WireSubject),
    })),
  };
}

/**
 * Read a peer's conversation thread with a Principal (ADR-042).
 *
 * `peer` is the Subject string (`user:alice`, `principal:<did>`). Pass
 * `undefined` to read the principal's owner-root view. The runtime
 * enforces the privacy contract — see
 * `peko-runtime/docs/architecture/adr/ADR-042-no-external-session-concept.md`.
 *
 * Pass `cursor` (returned as `nextCursor` on a prior call) to walk
 * older messages; combine with `limit` for paging. The runtime
 * caps `limit` at 1000; the desktop reads one page at a time so
 * the chat UI can reconcile streamed replies with persisted history.
 */
export async function principalLog(params: {
  name: string;
  peer?: string;
  limit?: number;
  sinceSecs?: number;
  cursor?: string | null;
}): Promise<LogResponse> {
  return normalizePrincipalLog(
    await invoke<LogResponse>("principal_log", {
      name: params.name,
      peer: params.peer ?? null,
      limit: params.limit ?? null,
      since_secs: params.sinceSecs ?? null,
      cursor: params.cursor ?? null,
    }),
  );
}

// ─── Models (model-first migration) ──────────────────────────────

/**
 * List configured models from the runtime's `ModelCatalog`. The
 * runtime reloads `models.toml` + vault before returning so the
 * desktop always sees the same on-disk reality as the CLI.
 */
export async function modelList(): Promise<ModelSummary[]> {
  return invoke<ModelSummary[]>("model_list");
}

/**
 * List built-in model presets (formerly provider templates). Each
 * preset carries a curated model list and default endpoint metadata.
 */
export async function modelTemplates(): Promise<ModelPresetInfo[]> {
  return invoke<ModelPresetInfo[]>("model_templates");
}

/**
 * Add a configured model. Either a `template` id (binds to one of
 * `model_templates()`) or `custom: true` with the full endpoint shape.
 */
export async function modelAdd(args: ModelAddArgs): Promise<ModelSummary> {
  return invoke<ModelSummary>("model_add", { args });
}

/** Update an existing configured model. */
export async function modelUpdate(args: ModelUpdateArgs): Promise<ModelSummary> {
  return invoke<ModelSummary>("model_update", { args });
}

/** Remove a configured model by id. */
export async function modelRemove(id: string): Promise<boolean> {
  return invoke<boolean>("model_remove", { id });
}

/** Test connectivity for a configured model. */
export async function modelTest(id: string): Promise<ModelTestResult> {
  return invoke<ModelTestResult>("model_test", { id });
}

/**
 * Reload the runtime's model catalog and vault from disk. Returns
 * the counts of configured models and vault credentials.
 */
export async function modelReload(): Promise<{ modelsCount: number; keysCount: number }> {
  return invoke<{ modelsCount: number; keysCount: number }>("model_reload");
}

// ─── System status ───────────────────────────────────────────────

export async function systemStatus(runtimeId?: string): Promise<SystemStatus> {
  return invoke<SystemStatus>("system_status", { runtimeId: runtimeId ?? null });
}

// ─── Extensions ─────────────────────────────────────────────────

export async function extensionList(): Promise<ExtensionSummary[]> {
  return invoke("extension_list");
}

export async function extensionInstall(path: string): Promise<string> {
  return invoke<string>("extension_install", { path });
}

export async function extensionUninstall(id: string): Promise<string> {
  return invoke<string>("extension_uninstall", { id });
}

// ─── Capabilities (per-Principal grants) ─────────────────────────

export async function capabilityList(principal: string): Promise<CapabilityList> {
  return invoke<CapabilityList>("capability_list", { principal });
}

export async function capabilityGrant(
  principal: string,
  capability: string,
): Promise<string> {
  return invoke<string>("capability_grant", { principal, capability });
}

export async function capabilityRevoke(
  principal: string,
  capability: string,
): Promise<string> {
  return invoke<string>("capability_revoke", { principal, capability });
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

// ─── Generic vault credentials ───────────────────────────────────

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

export async function credentialListGeneric(
  namespace?: string,
  kind?: string,
): Promise<CredentialDetail[]> {
  return invoke<CredentialDetail[]>("credential_list_generic", {
    namespace: namespace ?? null,
    kind: kind ?? null,
  });
}

/**
 * Store an arbitrary raw secret in the vault under a namespace/name key.
 * Used by OAuth flows that manage their own serialization format.
 */
export async function credentialSetRaw(
  namespace: string,
  material: string,
  name = "default",
): Promise<string> {
  return invoke<string>("credential_set_raw", {
    namespace,
    name,
    material,
  });
}

/**
 * Retrieve a raw secret from the vault by namespace/name.
 * Returns an empty string when no credential is present.
 */
export async function credentialGetRaw(
  namespace: string,
  name = "default",
): Promise<string | null> {
  return invoke<string | null>("credential_get_raw", {
    namespace,
    name,
  });
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
