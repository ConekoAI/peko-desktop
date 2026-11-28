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
import { t } from "../i18n";

import type {
  AccessPerson,
  AccessRule,
  Answers,
  ApprovalRequest,
  SecretRequest,
  TurnChanges,
  UndoResult,
  BoardItem,
  BoardOp,
  BootState,
  ChannelDetail,
  ChannelEvent,
  ChannelInviteResult,
  ChannelLeaveResult,
  ChannelMembers,
  ChannelSummary,
  CredentialDetail,
  DaemonStatus,
  LogResponse,
  ModelAddArgs,
  DiscoveredModel,
  ModelSummary,
  ModelTestResult,
  PlanSignInStarted,
  PlanSignInState,
  ModelUpdateArgs,
  PrincipalExposure,
  PekoRegistration,
  PekoAccess,
  PekoUsage,
  RuntimeConnection,
  Setting,
  SystemStatus,
  UsageLimits,
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
 * runtime's full `PrincipalSummary` down to this lightweight shape).
 */
export interface PrincipalSummary {
  name: string;
  /** The runtime's stable local id (`prin_…`); empty from older runtimes. */
  localId?: string;
  /** An emoji or short monogram, if set. */
  avatar?: string | null;
  /**
   * Its PekoHub ID once it is on PekoHub; null while it is only on this
   * computer, whatever `exposure` says it should be.
   */
  hubId?: string | null;
  exposure: PrincipalExposure;
  status: string;
  description?: string;
  preferredModelId?: string;
  owner: string;
  runtimeId: string;
  /**
   * Genesis pipeline state (peko-runtime ADR-054). Mirrors the Rust
   * `PrincipalSummary.boot_state` field (serde-renamed to camelCase
   * on the wire). Optional: runtimes older than the genesis pipeline
   * omit it — treat an absent value as `organized`.
   */
  bootState?: BootState;
}

/**
 * PR #3: thread `runtimeId` through every principal invoke so the
 * multi-runtime IPC layer can route to the correct transport. The
 * desktop-side default keeps every existing JS caller
 * backward-compatible — `runtimeId` is optional; omitted / undefined
 * / `"local"` all resolve to the local IPC client.
 */
export type RuntimeId = string | null | undefined;

export async function principalList(
  runtimeId?: RuntimeId,
): Promise<PrincipalSummary[]> {
  return invoke<PrincipalSummary[]>("principal_list", {
    runtimeId: runtimeId ?? null,
  });
}

/**
 * Look up a single Principal by name. Returns `null` on a miss —
 * the runtime surfaces misses as `{principal: null}` envelopes,
 * never as errors.
 */
export async function principalGet(
  name: string,
  runtimeId?: RuntimeId,
): Promise<PrincipalSummary | null> {
  return invoke<PrincipalSummary | null>("principal_get", {
    name,
    runtimeId: runtimeId ?? null,
  });
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
 *
 * Genesis (ADR-054): `peko create` now blocks through the genesis
 * boot sequence, so this invoke can take minutes to settle. The returned summary may still carry
 * `bootState: "genesis_pending"` when the runtime returns early —
 * callers should keep polling `principal_get` until `organized`
 * (`usePrincipalCreate` does this automatically).
 */
export interface PrincipalCreateRequest {
  name: string;
  description?: string;
  modelId: string;
  /**
   * A seed's TOML text (ADR-060), e.g. a `.seed.toml` from PekoHub: the
   * peko grows from it with a fresh identity that you own. `modelId` and
   * `description` override the seed's.
   */
  seed?: string;
  /**
   * The person read what the seed brings (`seedContents`: its setup steps
   * and files) and agreed to it. Without it such a seed is refused: it
   * changes this computer.
   */
  acceptSetup?: boolean;
  runtimeId?: RuntimeId;
}

/** One file a seed carries. */
export interface SeedFile {
  path: string;
  /** Bytes of text. */
  size: number;
  /** Its text, when it names something this computer will run. */
  content: string | null;
}

/** What a seed brings beyond a definition. */
export interface SeedContents {
  /** Setup steps the new peko will carry out. */
  steps: string[];
  /** Files written into its folder. */
  files: SeedFile[];
}

/** What a seed will do to this computer; both lists empty when nothing. */
export async function seedContents(seed: string): Promise<SeedContents> {
  return invoke<SeedContents>("seed_contents", { seed });
}

/** One thing a peko did on its first turn. */
export interface SetupStep {
  callId: string;
  tool: string;
  line: string;
  /** `null` while it is still running; `"ok"` when it worked. */
  outcome: string | null;
}

/** One setup step from the peko's seed and how it stands. */
export interface SetupResult {
  step: string;
  status: "ready" | "failed" | "pending" | string;
  /** How it checked, or why it failed and what to do. */
  note: string | null;
}

/** How a peko's first turn and its setup steps are going. */
export interface SetupStatus {
  /** False once the first turn is over (done, or stopped). */
  settingUp: boolean;
  /** Whether there is something to stop right now. */
  running: boolean;
  /** The setup steps its seed listed. */
  setup: string[];
  steps: SetupStep[];
  /** Its own report of how setup went, once written. */
  report: string | null;
  /** `none` | `pending` | `running` | `done`; empty when not known. */
  setupState: string;
  /** Each setup step with its result; empty when not known. */
  results: SetupResult[];
  /** Why its first turn last failed, while nothing will run it again. */
  firstTurnError?: string | null;
  /**
   * The model its turns need and this computer doesn't have: the id it is
   * set to, or `""` when it is set to none. Absent when its model is here,
   * and from engines that don't say.
   */
  missingModel?: string | null;
}

/** `null` for a remote peko, or when nothing can be said about it. */
export async function principalSetupStatus(
  name: string,
  runtimeId?: RuntimeId,
): Promise<SetupStatus | null> {
  return invoke<SetupStatus | null>("principal_setup_status", {
    name,
    runtimeId: runtimeId ?? null,
  });
}

/** Have a peko go through its setup steps again. */
export async function principalSetupRun(name: string, runtimeId?: RuntimeId): Promise<void> {
  return invoke<void>("principal_setup_run", { name, runtimeId: runtimeId ?? null });
}

/**
 * Stop what a peko is doing on its own (its first turn, or scheduled
 * work). Resolves to whether there was something to stop.
 */
export async function principalStopSetup(name: string, runtimeId?: RuntimeId): Promise<boolean> {
  return invoke<boolean>("principal_stop_setup", { name, runtimeId: runtimeId ?? null });
}

export async function principalCreate(
  req: PrincipalCreateRequest,
): Promise<PrincipalSummary> {
  return invoke<PrincipalSummary>("principal_create", {
    name: req.name,
    description: req.description ?? null,
    modelId: req.modelId,
    seed: req.seed ?? null,
    acceptSetup: req.acceptSetup ?? null,
    runtimeId: req.runtimeId ?? null,
  });
}

export interface PrincipalUpdateRequest {
  name: string;
  description?: string;
  status?: string;
  exposure?: string;
  preferredModelId?: string;
  /** An emoji or short monogram; `""` clears it. */
  avatar?: string;
  runtimeId?: RuntimeId;
}

export async function principalUpdate(
  req: PrincipalUpdateRequest,
): Promise<PrincipalSummary> {
  // The Rust command takes one struct argument named `req`, so the
  // fields travel inside it (flat keys fail Tauri's argument check).
  return invoke<PrincipalSummary>("principal_update", {
    req: {
      name: req.name,
      description: req.description ?? null,
      status: req.status ?? null,
      exposure: req.exposure ?? null,
      preferredModelId: req.preferredModelId ?? null,
      avatar: req.avatar ?? null,
      runtimeId: req.runtimeId ?? null,
    },
  });
}

export async function principalRemove(
  name: string,
  runtimeId?: RuntimeId,
): Promise<boolean> {
  return invoke<boolean>("principal_remove", {
    name,
    runtimeId: runtimeId ?? null,
  });
}

// ─── `.peko` package export / import (ADR-056) ───────────────────
//
// A `.peko` package is a full-existence export of a principal —
// workspace, memory, and private keys. Export writes the package to
// `output` (a file path chosen via the save dialog, conventionally
// `<name>.peko`); import wakes a principal from a package at `path`.
// After a local import the runtime requires a `principal_reload` so
// its in-memory manager picks up the restored directory.

/**
 * Export a principal's full existence to a `.peko` package at
 * `output`. The package contains the principal's private keys — the
 * UI surfaces a sensitivity warning before calling this.
 */
export async function principalExport(args: {
  name: string;
  output: string;
}): Promise<unknown> {
  return invoke("principal_export", {
    name: args.name,
    output: args.output,
  });
}

/** One hook or MCP server definition listed by an import preview. */
export interface ImportExecutable {
  id: string;
  path: string;
  definition: string;
}

/** `principal_import_previewed`, passed through (snake_case). */
export interface ImportPreview {
  name: string;
  version: string;
  did: string;
  description: string | null;
  agents: string[];
  inventory: {
    did: string;
    file_count: number;
    hooks: ImportExecutable[];
    mcp_servers: ImportExecutable[];
    skills: string[];
    executable_files: string[];
  };
  manifest_checksum: string;
  validation_errors: string[];
  validation_warnings: string[];
}

/**
 * Read a `.peko` package at `path` without importing it: what it is
 * and everything in it that can run. `rotateKeys` imports it as a new
 * peko with a fresh identity; without it, a package of a peko already
 * hosted here is refused.
 */
export async function principalImportPreview(args: {
  path: string;
  rotateKeys?: boolean;
}): Promise<ImportPreview> {
  return invoke<ImportPreview>("principal_import_preview", {
    filePath: args.path,
    name: null,
    rotateKeys: args.rotateKeys ?? false,
    runtimeId: null,
  });
}

/**
 * Import (wake) a principal from a `.peko` package at `path`, after
 * the user reviewed `principalImportPreview`. `manifestChecksum` is
 * the preview's; the runtime refuses the import if the package
 * changed in between. The Tauri command follows a successful import
 * with `principal_reload` itself, so the peko is live daemon-side when
 * this resolves. Keyless packages reject with the runtime's "ground it
 * with `peko create`" guidance, verbatim.
 */
export async function principalImport(args: {
  path: string;
  manifestChecksum: string;
  rotateKeys?: boolean;
}): Promise<unknown> {
  return invoke("principal_import", {
    filePath: args.path,
    name: null,
    expectedManifestChecksum: args.manifestChecksum,
    rotateKeys: args.rotateKeys ?? false,
    runtimeId: null,
  });
}

/**
 * Reload the runtime's in-memory principal manager from disk.
 * Required by the runtime after any out-of-band change to
 * `~/.peko/principals/` (e.g. a `.peko` import).
 */
export async function principalReload(): Promise<unknown> {
  return invoke("principal_reload");
}

/**
 * Send a non-streaming message to a Principal and return the
 * supervisor's final answer.
 */
export async function principalSend(
  name: string,
  message: string,
  runtimeId?: RuntimeId,
): Promise<string> {
  return invoke<string>("principal_send", {
    name,
    message,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * Result of a streaming send. `requestId` is the runtime correlation
 * id for the run. `content` is empty when the message was queued
 * behind a running turn (see the `queued` stream event).
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
  | { kind: "iteration"; iteration: number }
  /** The peko was busy; the message was queued for its running turn. */
  | { kind: "queued"; message: string }
  /** A tool call started; `input` (owner only) is a short redacted summary. */
  | { kind: "toolStart"; toolId: string; name: string; input: string | null }
  /** A tool call finished; `output` (owner only) is a short redacted excerpt. */
  | {
      kind: "toolEnd";
      toolId: string;
      name: string;
      success: boolean;
      durationMs: number;
      output: string | null;
    }
  /** A thinking (reasoning) delta; owner only. */
  | { kind: "thinking"; delta: string }
  /** Sent once per finished run. */
  | {
      kind: "runSummary";
      iterations: number;
      totalTokens: number | null;
      toolErrors: { toolName: string | null; errorMessage: string }[];
    };

/**
 * Send a streaming message to a Principal. Each supervisor event
 * (chunk delta or iteration boundary) is pushed to `onEvent` as it
 * arrives; the resolved promise carries the full final answer plus
 * the runtime correlation id.
 *
 * `requestId` is supplied by the caller (see `nextRequestId` in
 * `usePrincipals`) so concurrent streams never share an id. Sending
 * while the peko is already working on this thread is how the user
 * steers it: the runtime queues the message for the running turn and
 * this call settles at once with a `queued` event.
 */
export async function principalSendStream(
  name: string,
  message: string,
  requestId: number,
  onEvent: (msg: ChatStreamMsg) => void,
  runtimeId?: RuntimeId,
  overrideModel?: string,
  attachments?: string[],
  answers?: Answers,
  /** The DM message this one replies to, by `msg_id` (runtime ADR-126). */
  replyTo?: string | null,
): Promise<PrincipalSendStreamResult> {
  const channel = new Channel<ChatStreamMsg>();
  channel.onmessage = onEvent;
  return invoke<PrincipalSendStreamResult>("principal_send_stream", {
    name,
    message,
    requestId,
    onEvent: channel,
    runtimeId: runtimeId ?? null,
    // A configured model id for this message only; omitted = the
    // peko's own model. Local runtime only.
    overrideModel: overrideModel ?? null,
    // Absolute paths; the engine copies each file into the peko's
    // workspace (ADR-088). Local runtime only.
    attachments: attachments ?? [],
    // Answers to a message's questions (ADR-114); `message` is their
    // readable text.
    answers: answers ?? null,
    replyTo: replyTo ?? null,
  });
}

/**
 * Put your `emoji` on a message in your DM with a peko, or take it off
 * (runtime ADR-126). `channel` is the DM (`ChatLogPage.channel`).
 */
export async function principalReact(
  name: string,
  runtimeId: RuntimeId | undefined,
  channel: string | null | undefined,
  to: string,
  emoji: string,
  remove = false,
): Promise<void> {
  return invoke<void>("principal_react", {
    name,
    runtimeId: runtimeId ?? null,
    channel: channel ?? null,
    to,
    emoji,
    remove,
  });
}

/** Put your `emoji` on a message in a group or DM, or take it off (runtime ADR-126). */
export async function channelReact(
  channelId: string,
  to: string,
  emoji: string,
  remove = false,
): Promise<void> {
  return invoke<void>("channel_react", { channelId, to, emoji, remove });
}

/** A local peko's usage this cycle (tokens, requests, spend) and limits. */
export async function principalUsage(name: string): Promise<PekoUsage> {
  return invoke<PekoUsage>("principal_usage", { name });
}

/** Replace a local peko's limits; resolves to the usage now in force. */
export async function principalSetLimits(name: string, config: UsageLimits): Promise<PekoUsage> {
  return invoke<PekoUsage>("principal_set_limits", { name, config });
}

/** What a local peko's visitors reach (ADR-113). Owner only. */
export async function principalAccess(name: string): Promise<PekoAccess> {
  return invoke<PekoAccess>("principal_access", { name });
}

/**
 * Replace what a local peko's visitors reach: `visitors` for everyone,
 * `people` as the whole set of per-person rules. Resolves to the rules
 * now in force; rejects with the runtime's reason when refused.
 */
export async function principalSetAccess(
  name: string,
  visitors: AccessRule,
  people: AccessPerson[],
): Promise<PekoAccess> {
  return invoke<PekoAccess>("principal_set_access", {
    name,
    visitors,
    people: people.map(({ address, rule }) => ({ address, rule })),
  });
}

/**
 * Ask for a file or folder to share; resolves to its path relative to
 * `workspace` (a folder ends in `/`), `null` if cancelled, or
 * `"outside"` when it is not inside the peko's folder.
 */
export async function pickSharedPath(
  workspace: string,
  directory: boolean,
): Promise<string | null | "outside"> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory, defaultPath: workspace });
  if (!picked || Array.isArray(picked)) return null;
  return relativeTo(workspace, picked, directory);
}

/** `path` relative to `root`, `"outside"` when it is not inside it. */
export function relativeTo(root: string, path: string, directory: boolean): string | "outside" {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(root);
  const full = norm(path);
  if (!full.startsWith(`${base}/`)) return "outside";
  const rel = full.slice(base.length + 1);
  return directory ? `${rel}/` : rel;
}

/** The request as the engine sends it (snake_case). */
interface WireApproval {
  id: string;
  actor: string;
  actor_name?: string | null;
  trust: string;
  summary: string;
  reason: string;
  created_at: string;
  expires_at: string;
  kind?: string | null;
}

/**
 * The approval requests waiting for a peko's owner, oldest first. A peko on
 * another of your computers (`runtimeId = hub:…`) is asked through its host.
 */
export async function principalApprovals(
  name: string,
  runtimeId = "local",
): Promise<ApprovalRequest[]> {
  const wire = await invoke<WireApproval[]>("principal_approvals", {
    name,
    runtimeId: runtimeId === "local" ? null : runtimeId,
  });
  return wire.map((a) => ({
    id: a.id,
    actor: a.actor,
    actorName: a.actor_name ?? null,
    trust: a.trust,
    summary: a.summary,
    reason: a.reason,
    createdAt: a.created_at,
    expiresAt: a.expires_at,
    kind: a.kind ?? null,
  }));
}

/** Approve (`always`: and remember it) or deny; resolves to what happened. */
export async function principalDecideApproval(params: {
  name: string;
  id: string;
  approve: boolean;
  always?: boolean;
  /** The peko's runtime; a peko elsewhere is decided on its host. */
  runtimeId?: string;
}): Promise<string> {
  const runtimeId = params.runtimeId ?? "local";
  return invoke<string>("principal_decide_approval", {
    name: params.name,
    id: params.id,
    approve: params.approve,
    always: params.always ?? false,
    runtimeId: runtimeId === "local" ? null : runtimeId,
  });
}

/** A turn's changes as the engine sends them (snake_case). */
interface WireTurnChanges {
  turn: string;
  updated_at: string;
  files: { path: string; change: string }[];
  shell: boolean;
  undone_at?: string | null;
}

/**
 * Recent turns in your DM with a peko on this computer that changed files
 * (runtime ADR-117), newest first. A peko elsewhere lists none.
 */
export async function principalTurnChanges(name: string, runtimeId = "local"): Promise<TurnChanges[]> {
  const wire = await invoke<WireTurnChanges[]>("principal_turn_changes", {
    name,
    runtimeId: runtimeId === "local" ? null : runtimeId,
  });
  return wire.map((t) => ({
    turn: t.turn,
    updatedAt: t.updated_at,
    files: t.files.map((f) => ({ path: f.path, change: f.change as TurnChanges["files"][number]["change"] })),
    shell: t.shell,
    undoneAt: t.undone_at ?? null,
  }));
}

/** Undo one turn's file changes; resolves to what was put back and what was left. */
export async function principalUndoTurn(params: { name: string; turn: string }): Promise<UndoResult> {
  return invoke<UndoResult>("principal_undo_turn", { name: params.name, turn: params.turn });
}

/** A secret request as the engine sends it (snake_case). */
interface WireSecretRequest {
  id: string;
  secret: string;
  kind: string;
  why: string;
  created_at: string;
  expires_at: string;
}

/**
 * The secrets a peko on this computer asked you for (runtime ADR-116),
 * oldest first. A peko on another computer lists none: a secret is given
 * only on the computer that runs it.
 */
export async function principalSecretRequests(
  name: string,
  runtimeId = "local",
): Promise<SecretRequest[]> {
  const wire = await invoke<WireSecretRequest[]>("principal_secret_requests", {
    name,
    runtimeId: runtimeId === "local" ? null : runtimeId,
  });
  return wire.map((r) => ({
    id: r.id,
    secret: r.secret,
    kind: r.kind,
    why: r.why,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * One thing you ask of your peko's browser (runtime ADR-119): `state`,
 * `frame`, `control`, `input`, `open`. A peko on another of your
 * computers is asked through its host.
 */
export async function principalBrowser(
  name: string,
  runtimeId: string,
  verb: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return invoke<unknown>("principal_browser", {
    name,
    runtimeId: runtimeId === "local" ? null : runtimeId,
    verb,
    args,
  });
}

/** Save the value for a secret request, or decline it; resolves to what happened. */
export async function principalAnswerSecret(params: {
  name: string;
  id: string;
  value?: string;
  decline?: boolean;
}): Promise<string> {
  return invoke<string>("principal_answer_secret", {
    name: params.name,
    id: params.id,
    value: params.value ?? null,
    decline: params.decline ?? false,
  });
}

/** Ask for files to attach; resolves to their paths (none if cancelled). */
export async function pickAttachments(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: true, directory: false, title: t("common.attachFiles") });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/**
 * Save a pasted file (it has no path on disk) so it can be attached;
 * resolves to the saved file's path.
 */
export async function attachmentStage(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const name = file.name && file.name !== "image.png" ? file.name : `pasted.${extension}`;
  return invoke<string>("attachment_stage", { name, data: btoa(binary) });
}

/** An attached image as a `data:` URL, for its thumbnail. */
export async function attachmentPreview(path: string): Promise<string> {
  return invoke<string>("attachment_preview", { path });
}

/** Open an attached file with the system's default app. */
export async function attachmentOpen(path: string): Promise<void> {
  await invoke("attachment_open", { path });
}

/**
 * Stop the running turn in the caller's thread with `name`. `peer`
 * omitted means the owner's thread. Resolves even when nothing was
 * running (the envelope then has `success: false`).
 */
export async function principalStop(
  name: string,
  peer?: string,
  runtimeId?: RuntimeId,
): Promise<{ success?: boolean; error?: string | null }> {
  return invoke("principal_stop", {
    name,
    peer: peer ?? null,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * Follow the caller's thread with `name` live. `onMessage` receives
 * each new DM row (raw `principal_log` message shape). Returns a
 * function that stops the watch.
 */
export async function principalLogWatch(
  name: string,
  peer: string | undefined,
  sinceCursor: string | null,
  onMessage: (message: unknown) => void,
  runtimeId?: RuntimeId,
): Promise<() => void> {
  const channel = new Channel<unknown>();
  channel.onmessage = onMessage;
  // A remote peko (`hub:…`) is followed through the DM this computer's
  // runtime holds with it (runtime ADR-090).
  const watchId = await invoke<number>("principal_log_watch_start", {
    name,
    peer: peer ?? null,
    sinceCursor,
    onMessage: channel,
    runtimeId: runtimeId ?? null,
  });
  return () => {
    void invoke("principal_log_watch_stop", { watchId });
  };
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

/** The page envelope as the engine sends it (snake_case). */
type WireLogPage = LogResponse & {
  next_cursor?: string | null;
  has_more?: boolean;
  run_failure?: { at: string; kind: string; message: string; next_attempt_at?: string | null };
};

function normalizePrincipalLog(response: LogResponse): LogResponse {
  // The engine names the paging fields `next_cursor` / `has_more`; read
  // as camelCase they were always undefined, so older pages were
  // unreachable.
  const wire = response as WireLogPage;
  return {
    ...response,
    nextCursor: wire.nextCursor ?? wire.next_cursor ?? null,
    hasMore: wire.hasMore ?? wire.has_more ?? false,
    runFailure: wire.run_failure
      ? {
          at: wire.run_failure.at,
          kind: wire.run_failure.kind,
          message: wire.run_failure.message,
          nextAttemptAt: wire.run_failure.next_attempt_at ?? null,
        }
      : null,
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
  runtimeId?: RuntimeId;
}): Promise<LogResponse> {
  return normalizePrincipalLog(
    await invoke<LogResponse>("principal_log", {
      name: params.name,
      peer: params.peer ?? null,
      limit: params.limit ?? null,
      since_secs: params.sinceSecs ?? null,
      cursor: params.cursor ?? null,
      runtimeId: params.runtimeId ?? null,
    }),
  );
}

// ─── PR #3: new status / exposure / permission commands ──────────────────────
//
// These mirror the Rust `principal_set_status` / `principal_register`
// / `principal_grant_permission` / `principal_revoke_permission` /
// `principal_permissions` commands. They are local-only — passing a
// remote runtime_id returns an error from the Rust side.

export async function principalSetStatus(
  args: { name: string; status: string; runtimeId?: RuntimeId },
): Promise<unknown> {
  return invoke("principal_set_status", {
    name: args.name,
    status: args.status,
    runtimeId: args.runtimeId ?? null,
  });
}

/**
 * Set a local peko's PekoHub registration (ADR-081). Rejects with an
 * `[exposure_conflict]`-prefixed message when the hub already has this
 * peko registered from another runtime.
 */
export async function principalRegister(args: {
  name: string;
  registration: PekoRegistration;
  runtimeId?: RuntimeId;
}): Promise<unknown> {
  return invoke("principal_register", {
    name: args.name,
    exposure: args.registration,
    runtimeId: args.runtimeId ?? null,
  });
}

/** A permission a peko's owner can grant (runtime `Permission`). */
export type PekoPermission = "chat" | "view_settings" | "manage_settings" | "trusted";

/**
 * Runtime `PermissionGrant`, passed through unchanged (snake_case);
 * actors are `{kind, id}` ActorRefs.
 */
export interface PermissionGrant {
  subject: { kind: string; id?: string };
  permission: PekoPermission;
  granted_at: string;
  granted_by: { kind: string; id?: string };
}

/**
 * Grant `permission` on peko `name` to `subject`, an actor in Display
 * form: `user:<route>`, `principal:<route>`, `visitor:<route>`, or
 * `public`.
 */
export async function principalGrantPermission(args: {
  name: string;
  subject: string;
  permission: PekoPermission;
  runtimeId?: RuntimeId;
}): Promise<unknown> {
  return invoke("principal_grant_permission", {
    name: args.name,
    subject: args.subject,
    permission: args.permission,
    runtimeId: args.runtimeId ?? null,
  });
}

/** Revoke the grant named by its `(subject, permission)` pair. */
export async function principalRevokePermission(args: {
  name: string;
  subject: string;
  permission: PekoPermission;
  runtimeId?: RuntimeId;
}): Promise<unknown> {
  return invoke("principal_revoke_permission", {
    name: args.name,
    subject: args.subject,
    permission: args.permission,
    runtimeId: args.runtimeId ?? null,
  });
}

export async function principalPermissions(
  args: { name: string; runtimeId?: RuntimeId },
): Promise<{ permissions: PermissionGrant[] }> {
  return invoke<{ permissions: PermissionGrant[] }>("principal_permissions", {
    name: args.name,
    runtimeId: args.runtimeId ?? null,
  });
}

// ─── PR #11: invite-token mint / revoke ──────────────────────────
//
// Owners mint a signed invite link and share it with one friend.
// The runtime caps the TTL at 30 days; passing larger values
// rounds down on the daemon side. The returned `jti` is also
// returned in the response so the desktop can later revoke the
// token without needing to parse the URL.

export interface InviteClaims {
  principalDid: string;
  principalName: string;
  ownerSubject: string;
  scope: string[];
  exp: number; // unix seconds (UTC)
  jti: string;
}

export interface MintedInvite {
  token: string;
  url: string;
  claims: InviteClaims;
}

export async function principalMintInvite(args: {
  name: string;
  scope?: string[];
  ttlSecs?: number;
  runtimeId?: RuntimeId;
}): Promise<MintedInvite> {
  return invoke<MintedInvite>("principal_mint_invite", {
    name: args.name,
    scope: args.scope ?? ["chat"],
    ttlSecs: args.ttlSecs ?? 7 * 24 * 60 * 60,
    runtimeId: args.runtimeId ?? null,
  });
}

export async function principalRevokeInvite(args: {
  name: string;
  jti: string;
  runtimeId?: RuntimeId;
}): Promise<{ jti: string }> {
  return invoke<{ jti: string }>("principal_revoke_invite", {
    name: args.name,
    jti: args.jti,
    runtimeId: args.runtimeId ?? null,
  });
}

// ─── Remote principals (PR #4) ──────────────────────────────────
//
// Shared-link flow: a user pastes `${hubUrl}/peko/${owner}/${name}`
// (with optional `?token=...`; the legacy `${hubUrl}/p/...` form is
// still accepted on input) and the desktop resolves the principal
// via pekohub's anonymous `/v1/public/pekos/:owner/:pekoName`
// endpoint, then persists the verified record to
// `~/.peko/remote-principals.json`. The sidebar renders the table as
// a "Remote" section (PR #3).

export interface RemotePrincipalSummary {
  hubUrl: string;
  owner: string;
  principalName: string;
  displayName: string;
  description?: string | null;
  exposure: PrincipalExposure;
  status: string;
  runtimeId: string;
  addedAtUnixMs: number;
  hasInviteToken: boolean;
  /** Its PekoHub ID: one of your own pekos, or a peko you have a DM with. */
  hubId?: string | null;
  avatar?: string | null;
  localId?: string | null;
  /**
   * One of your own pekos on another computer, saved from your account's
   * list: it follows the account and isn't removed by hand.
   */
  fromAccount?: boolean;
  /** The computer it runs on, as that computer names itself on PekoHub. */
  runtimeName?: string | null;
}

export interface RemotePrincipalResolveResult {
  hubUrl: string;
  owner: string;
  principalName: string;
  displayName: string;
  description?: string | null;
  exposure: PrincipalExposure;
  status: string;
  inviteToken?: string | null;
}

/** A remote peko's live public face, from its hub record. */
export interface RemotePekoProfile {
  status: string;
  avatar: string | null;
  description: string | null;
  localId: string | null;
}

/**
 * Read a saved remote peko's hub record. Goes through the backend: the
 * webview's content security policy allows no outside hosts. `null`
 * when the hub no longer has the peko.
 */
export async function remotePrincipalProfile(
  hubUrl: string,
  owner: string,
  principalName: string,
): Promise<RemotePekoProfile | null> {
  return invoke<RemotePekoProfile | null>("remote_principal_profile", {
    hubUrl,
    owner,
    principalName,
  });
}

export async function remotePrincipalList(): Promise<RemotePrincipalSummary[]> {
  return invoke<RemotePrincipalSummary[]>("remote_principal_list");
}

export async function remotePrincipalResolve(
  shareUrl: string,
): Promise<RemotePrincipalResolveResult> {
  return invoke<RemotePrincipalResolveResult>("remote_principal_resolve", {
    shareUrl,
  });
}

export async function remotePrincipalAdd(
  shareUrl: string,
): Promise<RemotePrincipalSummary> {
  return invoke<RemotePrincipalSummary>("remote_principal_add", {
    req: { shareUrl },
  });
}

/**
 * Save one of your own pekos on another computer, as your account lists
 * it, so it sits in Chats like a peko of this computer. Its DM opens by
 * its Hub ID; nothing is looked up.
 */
export async function remotePrincipalAdopt(
  hubUrl: string,
  peko: AccessiblePrincipal,
): Promise<RemotePrincipalSummary> {
  return invoke<RemotePrincipalSummary>("remote_principal_adopt", {
    req: {
      hubUrl,
      owner: peko.owner,
      principalName: peko.principalName,
      hubId: peko.hubId,
      exposure: peko.exposure,
      status: peko.status,
      avatar: peko.avatar,
      localId: peko.localId,
      description: peko.description,
      fromAccount: true,
      runtimeName: peko.runtimeName ?? null,
    },
  });
}

/**
 * Save the pekos you have DMs with on other computers — including DMs
 * that followed you from your other computers — so each sits in Chats
 * like a peko of this computer. Returns how many were added.
 */
export async function remotePrincipalAdoptDms(hubUrl: string): Promise<number> {
  return invoke<number>("remote_principal_adopt_dms", { hubUrl });
}

export async function remotePrincipalRemove(args: {
  hubUrl: string;
  owner: string;
  principalName: string;
}): Promise<boolean> {
  return invoke<boolean>("remote_principal_remove", {
    hubUrl: args.hubUrl,
    owner: args.owner,
    principalName: args.principalName,
  });
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

/** A model of the computer hosting a remote peko (runtime ADR-097). */
export interface RemotePekoModel {
  id: string;
  displayName: string;
}

/**
 * The models one of your pekos on another computer can answer you with,
 * asked of the computer hosting it (runtime ADR-097). Empty when it
 * offers you none.
 */
export async function remotePekoModels(name: string, runtimeId: string): Promise<RemotePekoModel[]> {
  return invoke<RemotePekoModel[]>("remote_peko_models", { name, runtimeId });
}

/**
 * Add a configured model from its endpoint: base URL, API format, wire
 * model id, and a key or stored credential (ADR-068; no presets).
 */
export async function modelAdd(args: ModelAddArgs): Promise<ModelSummary> {
  return invoke<ModelSummary>("model_add", { args });
}

/**
 * The chat models an endpoint offers, read from the endpoint with `key`
 * (absent for keyless endpoints), with what its list says about each
 * and what models.dev suggests. Nothing is stored.
 */
export async function modelDiscover(
  baseUrl: string,
  apiFormat: string,
  key?: string,
): Promise<DiscoveredModel[]> {
  return invoke<DiscoveredModel[]>("model_discover", { baseUrl, apiFormat, key: key ?? null });
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
 * Start signing in with ChatGPT so OpenAI models bill a ChatGPT plan
 * (runtime ADR-115). The engine runs the sign-in; open `url` in the
 * browser, then follow it with {@link chatgptSignInStatus}.
 */
export async function chatgptSignInStart(): Promise<PlanSignInStarted> {
  return invoke<PlanSignInStarted>("chatgpt_sign_in_start");
}

/**
 * How a ChatGPT sign-in is going. `pastedUrl` hands it the address a
 * browser on another computer ended on.
 */
export async function chatgptSignInStatus(
  flowId: string,
  pastedUrl?: string,
): Promise<PlanSignInState> {
  return invoke<PlanSignInState>("chatgpt_sign_in_status", { flowId, pastedUrl: pastedUrl ?? null });
}

/** Stop waiting for a ChatGPT sign-in. */
export async function chatgptSignInCancel(flowId: string): Promise<void> {
  await invoke("chatgpt_sign_in_cancel", { flowId });
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

// ─── App updates ────────────────────────────────────────────────

/** What the app knows about a newer version of itself. */
export interface UpdateStatus {
  /** The version running now. */
  current: string;
  /** The newer version on offer, or null when this is the newest. */
  available: string | null;
  /** False where the app can't replace itself (a Linux package install). */
  canInstall: boolean;
}

/** Where a person gets Peko Desktop by hand. */
export const DOWNLOAD_PAGE_URL = "https://pekohub.ai/download";

/** Ask whether a newer Peko Desktop exists. Rejects when that can't be read. */
export function updateCheck(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("update_check");
}

/**
 * Download the newer version, install it and start it. On success the
 * app restarts and this never resolves; it rejects when the update
 * didn't go through. Progress arrives as `update-progress` events.
 */
export function updateInstall(): Promise<void> {
  return invoke<void>("update_install");
}

// ─── Settings ───────────────────────────────────────────────────

export async function settingsGet(key: string): Promise<string | null> {
  return invoke("settings_get", { key });
}

export async function settingsSet(key: string, value: string): Promise<void> {
  return invoke("settings_set", { key, value });
}

// ─── A peko using this computer (runtime ADR-123) ──────────────────

/** Whether a peko uses the screen, and on macOS the grants. */
export async function computerStatus(): Promise<unknown> {
  return invoke<unknown>("computer_status");
}

/** **Let it continue**: a peko your hand paused goes on. */
export async function computerResume(): Promise<unknown> {
  return invoke<unknown>("computer_resume");
}

/** **Stop**: the peko using the screen stops. */
export async function computerStop(): Promise<unknown> {
  return invoke<unknown>("computer_stop");
}

/** Ask macOS for Screen Recording and Accessibility. */
export async function computerSetup(): Promise<unknown> {
  return invoke<unknown>("computer_setup");
}

/** The global shortcut that stops every peko using the screen. */
export async function computerStopShortcut(): Promise<string> {
  return invoke<string>("computer_stop_shortcut");
}

/** Relabel the tray menu, so it follows the app's language. */
export async function traySetLabels(labels: {
  open: string;
  quit: string;
}): Promise<void> {
  await invoke("tray_set_labels", { labels });
}

/** The folder the engine keeps pekos, models, and keys in. */
export async function pekoHomeDir(): Promise<string> {
  return invoke<string>("peko_home_dir");
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
  void name;
  // The backend keys raw secrets by provider (`provider:<namespace>/default`).
  await invoke<void>("credential_set_raw", { provider: namespace, rawValue: material });
  return namespace;
}

/**
 * Retrieve a raw secret from the vault by namespace/name.
 * Returns an empty string when no credential is present.
 */
export async function credentialGetRaw(
  namespace: string,
  name = "default",
): Promise<string | null> {
  void name;
  return invoke<string | null>("credential_get_raw", { provider: namespace });
}

/**
 * Forget the PekoHub OAuth bundle.
 *
 * Deletes the `provider:pekohub/default` credential from the OS
 * keychain. Idempotent — returns Ok if no credential is stored.
 * The SPA is responsible for clearing locally-cached
 * `RuntimeConnection` rows with `connectionType === "pekohub"`.
 */
export async function pekohubLogout(): Promise<void> {
  return invoke<void>("pekohub_logout");
}

/** Revoke a refresh token at the hub (sign-out), through the backend. */
export async function hubOAuthRevoke(baseUrl: string, token: string): Promise<void> {
  await invoke("hub_oauth_revoke", { baseUrl, token });
}

/** This computer's runtime DID, as its engine states it. */
export async function runtimeDid(): Promise<string> {
  return invoke<string>("runtime_did");
}

/** This computer's runtime, registered with PekoHub. */
export interface HubRegistration {
  hub: string;
  runtimeDid: string;
  account: string;
}

/**
 * Register this computer's runtime with the hub under the signed-in
 * account (`token`, pekohub ADR-007). The daemon connects at once, so
 * this computer's pekos can go online.
 */
export async function runtimeHubRegister(hub: string, token: string): Promise<HubRegistration> {
  return invoke<HubRegistration>("runtime_hub_register", { hub, token });
}

/** What disconnecting this computer from PekoHub came to. */
export interface HubDisconnect {
  /** The runtime is no longer registered. */
  done: boolean;
  /** Messages to pekos on other computers not delivered yet; nothing changed. */
  unsent: number | null;
  /** Pekos that went local-only on the way. */
  localOnly: string[];
}

/**
 * Disconnect this computer from the PekoHub account (runtime ADR-091 D5):
 * its pekos go local-only and its copies of your conversations with pekos
 * on other computers are deleted (their hosts keep them). With messages
 * still undelivered nothing changes and `unsent` says how many, unless
 * `discardUnsent`.
 */
export async function runtimeHubDisconnect(hub: string, discardUnsent: boolean): Promise<HubDisconnect> {
  return invoke<HubDisconnect>("runtime_hub_disconnect", { hub, discardUnsent });
}

/**
 * The PekoHub account this computer's person is linked to (runtime
 * ADR-081 D3). Signing in registers the runtime, which links the local
 * user to the account: it stays one person, also addressed as
 * `user:hub:<id>`. `null` when the runtime isn't registered.
 */
export interface LocalUserAccount {
  id: string;
  /** The account's name as PekoHub gave it at registration. */
  name: string | null;
}

export async function localUserAccount(): Promise<LocalUserAccount | null> {
  return invoke<LocalUserAccount | null>("local_user_account");
}

/** This computer's person (runtime ADR-124). */
export interface LocalPerson {
  /**
   * Their PekoHub name once signed in, else the name they chose here,
   * else their login name. `null` from a runtime too old to say.
   */
  name: string | null;
  /** Their PekoHub handle, while signed in. */
  handle: string | null;
}

export async function localPerson(): Promise<LocalPerson> {
  return invoke<LocalPerson>("local_person");
}

/**
 * Set what this computer's person is called. Signed in, PekoHub takes
 * it first and may refuse it (the error says why).
 */
export async function setPersonName(name: string): Promise<void> {
  await invoke("person_name_set", { name });
}

/**
 * Wait for an OAuth callback redirect on `127.0.0.1:<port>`.
 *
 * D6: the Tauri command spawns a localhost HTTP server and resolves
 * with `{code, state}` once PekoHub's browser redirect lands, or
 * rejects after the 2-minute timeout baked into the Rust side. The
 * SPA calls this in parallel with the `startOAuthConnect` redirect
 * so the user never has to copy-paste the authorization code.
 */
export interface OAuthCallbackPayload {
  code: string;
  state: string;
}
export async function startOAuthCallbackListener(
  port: number,
  path?: string,
): Promise<OAuthCallbackPayload> {
  return invoke<OAuthCallbackPayload>("start_oauth_callback_listener", {
    port,
    path: path ?? null,
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
  /**
   * The API base of the hub that issued the tokens. The backend sends
   * them to that hub only (a share link may name another).
   */
  hub?: string;
}

export interface PekohubRuntime {
  id: string;
  name: string;
  url?: string;
}

/**
 * The hub API the app uses until the user picks another (`pekohub.base_url`).
 * PekoHub's API lives on `api.pekohub.ai`; `pekohub.ai` is its website.
 */
export const DEFAULT_HUB_URL = "https://api.pekohub.ai";

/** Official website hosts whose API lives on `api.pekohub.ai`. */
const OFFICIAL_WEB_HOSTS = new Set(["pekohub.ai", "www.pekohub.ai", "pekohub.org"]);

/**
 * The hub API base for an address the user configured or a link carried:
 * the official website hosts map to `api.pekohub.ai`, any other hub is
 * taken at its origin (self-hosted hubs serve both from one origin).
 */
export function hubApiBase(url?: string | null): string {
  const raw = url?.trim() || DEFAULT_HUB_URL;
  try {
    const parsed = new URL(raw);
    if (OFFICIAL_WEB_HOSTS.has(parsed.hostname)) return `${parsed.protocol}//api.pekohub.ai`;
    return parsed.origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** The website for a hub's API base: links people open name it, not the API. */
export function hubWebOrigin(url?: string | null): string {
  const api = hubApiBase(url);
  return api === "https://api.pekohub.ai" ? "https://pekohub.ai" : api;
}

/** The hub the app's settings name (`pekohub.base_url`), as an API base. */
export function configuredHubUrl(settings?: { key: string; value: string }[] | null): string {
  return hubApiBase(settings?.find((s) => s.key === "pekohub.base_url")?.value);
}

/** The hub resources the backend reads for the frontend (`hub_http.rs`). */
export type HubResource = "runtimes" | "accessible_pekos" | "search" | "seeds";

interface HubAnswer {
  status: number;
  body: string;
}

/** Statuses a `Response` may not carry a body with. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * The backend's answer as a `Response`, so callers keep their status
 * handling. A failure to reach the hub rejects with an `Error`.
 */
async function hubAnswer(call: Promise<HubAnswer>): Promise<Response> {
  let answer: HubAnswer;
  try {
    answer = await call;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
  const body = NULL_BODY_STATUSES.has(answer.status) ? null : answer.body;
  return new Response(body, { status: answer.status });
}

/**
 * A hub answer's JSON body. A body that isn't JSON — a web page, when
 * the address serves a site but no hub API — gets an error that says
 * so, not the engine's "string did not match the expected pattern".
 */
export async function hubJson(resp: Response, baseUrl: string): Promise<any> {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    let host = baseUrl;
    try {
      host = new URL(baseUrl).host;
    } catch {
      // keep the address as given
    }
    throw new Error(`${host} didn't answer as a PekoHub: no hub API at this address`);
  }
}

/**
 * `GET` a hub resource. Hub calls go through the backend: the
 * webview's content security policy allows no outside hosts, so a
 * `fetch()` from here fails in a built app.
 */
export function hubGet(
  baseUrl: string,
  resource: HubResource,
  opts: { accessToken?: string; query?: Record<string, string> } = {},
): Promise<Response> {
  return hubAnswer(
    invoke<HubAnswer>("hub_get", {
      baseUrl,
      resource,
      accessToken: opts.accessToken ?? null,
      query: opts.query ? Object.entries(opts.query) : null,
    }),
  );
}

/**
 * The newest text of the seed `owner/name` on a hub, through the backend
 * (see `hubGet`). Seeds are public, so no token is sent.
 */
export function hubSeed(baseUrl: string, owner: string, name: string): Promise<Response> {
  return hubAnswer(invoke<HubAnswer>("hub_seed", { baseUrl, owner, name }));
}

/**
 * A public peko's share link (`<website>/@<owner's handle>/<name>`), from
 * the hub this runtime is registered with. `null` when the peko isn't
 * public or the runtime isn't registered.
 */
export function pekoShareLink(name: string): Promise<string | null> {
  return invoke<string | null>("peko_share_link", { name });
}

/** The signed-in PekoHub account; `avatar` is a `data:` URL when it has a picture. */
export interface HubAccount {
  handle: string;
  displayName: string | null;
  avatar: string | null;
}

/** The signed-in PekoHub account at `hub`, or `null` when not signed in. */
export function hubAccount(hub: string): Promise<HubAccount | null> {
  return invoke<HubAccount | null>("hub_account", { hub });
}

/** Something the PekoHub account should hear about (the Hub sends no email). */
export interface HubNotification {
  id: string;
  kind: string;
  text: string;
  /** The website page that acts on it. */
  path: string | null;
  url: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface HubNotificationList {
  unread: number;
  notifications: HubNotification[];
}

/** The signed-in account's PekoHub notifications, newest first. */
export async function hubNotifications(hub: string): Promise<HubNotificationList> {
  const resp = await hubAnswer(invoke<HubAnswer>("hub_notifications", { hub }));
  if (!resp.ok) throw new Error(t("errors.hubNotifications", { status: resp.status }));
  return hubJson(resp, hub);
}

/** Mark PekoHub notifications read: `ids`, or all of them. */
export async function markHubNotificationsRead(hub: string, ids?: string[]): Promise<void> {
  const resp = await hubAnswer(invoke<HubAnswer>("hub_notifications_read", { hub, ids: ids ?? null }));
  if (!resp.ok) throw new Error(t("errors.hubNotifications", { status: resp.status }));
}

/** `POST /oauth/token` on a hub, through the backend (see `hubGet`). */
function hubOAuthToken(baseUrl: string, params: Record<string, string>): Promise<Response> {
  return hubAnswer(invoke<HubAnswer>("hub_oauth_token", { baseUrl, params }));
}

/**
 * Exchange an OAuth authorization code for tokens at the hub's token
 * endpoint.
 */
export async function oauthTokenExchange(params: {
  baseUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const resp = await hubOAuthToken(params.baseUrl, {
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => t("errors.unknown"));
    throw new Error(t("errors.tokenExchangeFailed", { status: resp.status, text }));
  }
  return hubJson(resp, params.baseUrl);
}

/**
 * Refresh an OAuth access token using a refresh token.
 */
export async function oauthTokenRefresh(params: {
  baseUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const resp = await hubOAuthToken(params.baseUrl, {
    grant_type: "refresh_token",
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => t("errors.unknown"));
    throw new Error(t("errors.tokenRefreshFailed", { status: resp.status, text }));
  }
  return hubJson(resp, params.baseUrl);
}

/**
 * List runtimes registered to the authenticated user on PekoHub.
 */
export async function pekohubListRuntimes(
  baseUrl: string,
  accessToken: string,
): Promise<PekohubRuntime[]> {
  const resp = await hubGet(baseUrl, "runtimes", { accessToken });
  if (!resp.ok) {
    const text = await resp.text().catch(() => t("errors.unknown"));
    throw new Error(t("errors.hubRequestFailed", { status: resp.status, text }));
  }
  const data = await hubJson(resp, baseUrl);
  // The endpoint may return { runtimes: [...] } or just [...]
  const arr = Array.isArray(data) ? data : data.runtimes;
  if (!Array.isArray(arr)) {
    throw new Error(t("errors.hubUnexpectedResponse"));
  }
  return arr.map((r: Record<string, unknown>) => ({
    id: String(r.id ?? r.runtime_id ?? ""),
    name: String(r.name ?? r.display_name ?? r.id ?? ""),
    url: r.url ? String(r.url) : undefined,
  }));
}

/**
 * List the pekos the authenticated user can reach on PekoHub —
 * owner-only plus `private`-exposure entries (pekohub ADR-005; this
 * endpoint replaced `/v1/me/accessible-principals`, which is 404).
 *
 * Wire shape: `{ pekos: [{ id, ownerName, pekoName, publicName,
 * status }] }`. The internal type keeps the "principal" machine
 * identifier — `pekoName` is mapped to `principalName` here, at the
 * wire boundary, so the rest of the desktop never sees the rename.
 */
export interface AccessiblePrincipal {
  id: string;
  /** Its PekoHub ID; empty from hubs that predate sending it. */
  hubId: string;
  /** The owner's handle (`alice`), for the peko's page and records. */
  owner: string;
  ownerName: string;
  /** Mapped from the wire's `pekoName` field. */
  principalName: string;
  publicName: string;
  status: string;
  avatar: string | null;
  /** Its id on its own runtime: the app keys a peko's accent on it. */
  localId: string | null;
  description: string | null;
  exposure: string;
  /** The computer it runs on, as that computer names itself on PekoHub. */
  runtimeName?: string | null;
  /**
   * That computer's runtime DID; absent from hubs that predate sending it.
   * One of this computer's (see `runtimeDid`) is here or gone, never a
   * peko on another computer.
   */
  runtimeId?: string | null;
  /** When that computer last connected to PekoHub (ISO); null if never. */
  lastSeenAt?: string | null;
}

interface AccessiblePekoWire {
  id?: unknown;
  hubId?: unknown;
  owner?: unknown;
  ownerName?: unknown;
  pekoName?: unknown;
  publicName?: unknown;
  status?: unknown;
  avatar?: unknown;
  localId?: unknown;
  description?: unknown;
  exposure?: unknown;
  runtimeName?: unknown;
  runtimeId?: unknown;
  lastSeenAt?: unknown;
}

const textOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

export async function pekohubListAccessiblePekos(
  baseUrl: string,
  accessToken: string,
): Promise<AccessiblePrincipal[]> {
  const resp = await hubGet(baseUrl, "accessible_pekos", { accessToken });
  if (!resp.ok) {
    const text = await resp.text().catch(() => t("errors.unknown"));
    throw new Error(t("errors.listAccessiblePekosFailed", { status: resp.status, text }));
  }
  const data = await hubJson(resp, baseUrl);
  // The endpoint returns { pekos: [...] }; tolerate a bare array.
  const arr = Array.isArray(data) ? data : data?.pekos;
  if (!Array.isArray(arr)) {
    throw new Error(t("errors.hubUnexpectedResponse"));
  }
  return arr.map((w: AccessiblePekoWire) => ({
    id: String(w.id ?? ""),
    hubId: String(w.hubId ?? ""),
    owner: String(w.owner ?? w.ownerName ?? "").toLowerCase(),
    ownerName: String(w.ownerName ?? ""),
    principalName: String(w.pekoName ?? ""),
    publicName: String(w.publicName ?? w.pekoName ?? ""),
    status: String(w.status ?? "offline"),
    avatar: textOrNull(w.avatar),
    localId: textOrNull(w.localId),
    description: textOrNull(w.description),
    exposure: String(w.exposure ?? "private"),
    runtimeName: textOrNull(w.runtimeName),
    runtimeId: textOrNull(w.runtimeId),
    lastSeenAt: textOrNull(w.lastSeenAt),
  }));
}

// ---------------------------------------------------------------------------
// Channels (peko-channel cross-runtime desktop)
//
// PR-1 shipped the read-only surface (list / get / events / members).
// PR-2a adds `channelPost`. Create / invite / leave land in PR-3.
// All wrappers thread `runtimeId` for cross-runtime routing
// (`hub:<url>` style ids route through `HubRemoteClient` in PR #5;
// `null`/`undefined` resolve to the local IPC client).
//
// Types are re-exported here so hook files can `import { ChannelSummary,
// ... } from "../lib/api"` alongside the IPC wrappers, matching the
// convention used by the principal hooks (`usePrincipals.ts`).
// ---------------------------------------------------------------------------

export type {
  ChannelSummary,
  ChannelDetail,
  ChannelEvent,
  ChannelMembers,
  ChannelInviteResult,
  ChannelLeaveResult,
};

/**
 * List channels `principalName` is a member of. The desktop's
 * `useChannels` hook iterates local principals and dedupes by
 * `channelId` to render a unified sidebar.
 */
export async function channelList(
  principalName: string,
  runtimeId?: RuntimeId,
): Promise<ChannelSummary[]> {
  return invoke<ChannelSummary[]>("channel_list", {
    principalName,
    runtimeId: runtimeId ?? null,
  });
}

/** A group on another computer inviting you (runtime ADR-092 D2). */
export interface GroupInvitation {
  channelId: string;
  name: string;
  inviter: string;
  members: number;
}

/** A group you joined from another computer (runtime ADR-092 D2). */
export interface PersonGroup {
  channelId: string;
  name: string;
  home: string | null;
}

/** Groups on other computers inviting you; empty when not signed in. */
export async function groupInvitations(): Promise<GroupInvitation[]> {
  return invoke<GroupInvitation[]>("group_invitations");
}

/** Accept or decline a group's invitation. */
export async function groupInvitationAnswer(channelId: string, accept: boolean): Promise<void> {
  return invoke<void>("group_invitation_answer", { channelId, accept });
}

/**
 * One older page of a group you joined from another computer, read from
 * its home and not stored here (runtime ADR-092 D3).
 */
export async function groupHistoryOlder(
  channelId: string,
  before: string,
): Promise<{ events: ChannelEvent[]; hasMore: boolean }> {
  return invoke("group_history_older", { channelId, before });
}

/** What joining by link or ID asked for (runtime ADR-092 D5). */
export interface GroupJoinRequested {
  channelId: string;
  name: string;
}

/** A group's PekoHub registration (runtime ADR-092 D5). */
export interface GroupRegistration {
  id: string;
  page: string;
  visibility: "invite_only" | "public";
}

/** A new invite link, or how many links `revoke` stopped. */
export interface GroupLink {
  link: string | null;
  expires: string | null;
  revoked: number | null;
}

/** Join a group by its invite link, or a public one by its ID. */
export async function groupJoin(link: string): Promise<GroupJoinRequested> {
  return invoke<GroupJoinRequested>("group_join", { link });
}

/** Give a group an ID on PekoHub, or change who may find it. */
export async function groupRegister(
  channelId: string,
  visibility: "invite_only" | "public",
): Promise<GroupRegistration> {
  return invoke<GroupRegistration>("group_register", { channelId, visibility });
}

/** Make an invite link to a registered group, or stop them all. */
export async function groupLink(
  channelId: string,
  options: { days?: number; revoke?: boolean } = {},
): Promise<GroupLink> {
  return invoke<GroupLink>("group_link", {
    channelId,
    days: options.days ?? null,
    revoke: options.revoke ?? false,
  });
}

/** Groups you joined from other computers; empty when not signed in. */
export async function personGroups(): Promise<PersonGroup[]> {
  return invoke<PersonGroup[]>("person_groups");
}

/** One of your DMs with another person (runtime ADR-095 D6). */
export interface PersonDm {
  channelId: string;
  /** `user:hub:<account>`. */
  peer: string;
  /** Their PekoHub account ID. */
  account: string;
  name: string | null;
  /** They haven't accepted yet: nothing you wrote has reached them. */
  waiting: boolean;
}

/**
 * A person asking to DM you (runtime ADR-095 D6). It names only who asks;
 * what they wrote arrives once you accept.
 */
export interface DmRequest {
  channelId: string;
  /** `user:hub:<account>`. */
  from: string;
  account: string;
  name: string | null;
  receivedAt: string;
}

/** Your DMs with other people; empty when not signed in. */
export async function personDms(): Promise<PersonDm[]> {
  return invoke<PersonDm[]>("person_dms");
}

/**
 * Open (or find) a DM with a person by their PekoHub account ID. They get
 * a message request; returns the DM's channel id.
 */
export async function personDmOpen(account: string, name?: string): Promise<string> {
  return invoke<string>("person_dm_open", { account, name: name ?? null });
}

/** People asking to DM you; empty when not signed in. */
export async function dmRequests(): Promise<DmRequest[]> {
  return invoke<DmRequest[]>("dm_requests");
}

/** Accept, decline, or block a message request. Accepting returns the DM's channel id. */
export async function dmRequestAnswer(
  channelId: string,
  answer: "accept" | "decline" | "block",
): Promise<string | null> {
  return invoke<string | null>("dm_request_answer", { channelId, answer });
}

/** A person you blocked: their PekoHub account ID, and their name when known. */
export interface BlockedPerson {
  account: string;
  name: string | null;
}

/** The people you blocked. */
export async function blockedPeople(): Promise<BlockedPerson[]> {
  return invoke<BlockedPerson[]>("blocked_people");
}

/** Block or unblock a person by account ID; returns everyone blocked now. */
export async function setPersonBlocked(account: string, blocked: boolean): Promise<BlockedPerson[]> {
  return invoke<BlockedPerson[]>("set_person_blocked", { account, blocked });
}

/** Where you have read up to in one conversation (runtime ADR-108 D5). */
export interface ReadState {
  channel: string;
  kind: "dm" | "group" | string;
  /** A DM's other member: `principal` (a peko), `user` or `visitor`. */
  peerKind?: string | null;
  /** A peko on this computer, by its local id. */
  peerLocalId?: string | null;
  /** A peko or person on PekoHub, by their ID there. */
  peerHubId?: string | null;
  /** Posts after your read mark that you did not write. */
  unread: number;
  /** Whether you have a read mark here at all. */
  marked: boolean;
}

/** Where you have read up to in each of your conversations. */
export async function readState(): Promise<ReadState[]> {
  return invoke<ReadState[]>("read_state");
}

/**
 * You have seen `channel` up to `at` (ISO). Your phone and your other
 * computers are told. Resolves to whether the mark moved.
 */
export async function markRead(channel: string, at: string): Promise<boolean> {
  return invoke<boolean>("mark_read", { channel, at });
}

/** A device on your account's list (runtime ADR-111). */
export interface AccountDevice {
  /** Its key as a `did:key` (a computer's runtime id). */
  id: string;
  kind: "computer" | "phone";
  name?: string | null;
  /** A phone's id at PekoHub. */
  hubDeviceId?: string | null;
  /** ISO time. */
  addedAt: string;
  /** The device that added it. */
  addedBy: string;
  /** Whether it is this computer. */
  this: boolean;
  /** ISO time: when a phone last asked this computer for something. */
  lastSeen?: string | null;
  /**
   * Runtime ADR-125: how another computer is reached now. Absent for
   * phones, this computer, and from older engines.
   */
  path?: NetworkPath | null;
}

/** Something about your account that waits for you (runtime ADR-111 D6). */
export interface SecurityItem {
  id: string;
  kind: "owner_change" | "key_change" | "devices_reset" | string;
  summary: string;
  reason: string;
  /** The peko an owner change is about. */
  peko?: string | null;
  createdAt: string;
  /** Runtime ADR-112: the code of what it asks you to trust. */
  code?: string | null;
  /** Runtime ADR-112: a key change's code for the key trusted until now. */
  pinnedCode?: string | null;
}

/** Your account's devices, as this computer holds them. */
export interface AccountDevices {
  /** `user:hub:<id>`; absent when this computer is not signed in. */
  account?: string | null;
  runtime: string;
  /** Whether this computer is on the list. */
  onList: boolean;
  devices: AccountDevice[];
  security: SecurityItem[];
  /** Runtime ADR-112: your account's code, once this computer holds its list. */
  code?: string | null;
}

/** An identity's code (runtime ADR-112), as this computer holds it. */
export interface IdentityCode {
  of: string;
  name?: string | null;
  /** Absent when this computer has not met it. */
  code?: string | null;
}

/**
 * The code of `of`: `account`, `peko:hub:<id>`, `user:hub:<id>`, or one of
 * your pekos by name. Two owners read their codes to each other to check
 * that PekoHub put them in touch with each other.
 */
export async function identityCode(of: string): Promise<IdentityCode> {
  return invoke<IdentityCode>("identity_code", { of });
}

/** A code that adds a device: to type, and as an SVG picture to scan. */
export interface JoinCodeShown {
  code: string;
  svg: string;
  expiresAt: string;
}

/** Your account's devices, and what waits about it. */
/** How frames to a computer travel now (runtime ADR-125 D9). */
export type NetworkPath = "direct" | "relay" | "waiting" | "offline";

/** How this computer connects (runtime ADR-125 D2). */
export type NetworkConnection = "pekohub" | "automatic" | "direct";

/** One computer this one links with, or could. */
export interface NetworkPeer {
  runtimeId: string;
  account?: string | null;
  name?: string | null;
  path: NetworkPath;
  address?: string | null;
  since?: string | null;
  lastError?: string | null;
}

/** How this computer connects, and how each computer is reached. */
export interface NetworkStatus {
  connection: NetworkConnection;
  directWith: "mine" | "people";
  /** Where the engine listens, while it does. */
  listening?: string | null;
  /** What it tells other computers to dial. */
  told: string[];
  /** Why it does not listen, when it could not. */
  listenError?: string | null;
  peers: NetworkPeer[];
  /** The settings as written (Advanced); absent `directListen` is the default. */
  directListen?: string | null;
  directAddresses: string[];
  directPeers: string[];
}

/** A change to how this computer connects; absent fields stay. */
export interface NetworkChange {
  connection?: NetworkConnection;
  directWith?: "mine" | "people";
  /** An empty string goes back to the default (0.0.0.0:11438). */
  directListen?: string;
  directAddresses?: string[];
  directPeers?: string[];
}

/** How this computer connects to your other computers (runtime ADR-125). */
export async function networkStatus(): Promise<NetworkStatus> {
  return invoke<NetworkStatus>("network_status");
}

/** Change how this computer connects; the engine applies it at once. */
export async function networkSettingsSet(change: NetworkChange): Promise<NetworkStatus> {
  return invoke<NetworkStatus>("network_settings_set", { change });
}

/** Dial the computers this one knows addresses for, now. */
export async function networkLinkRetry(runtimeId?: string): Promise<void> {
  return invoke<void>("network_link_retry", { runtimeId: runtimeId ?? null });
}

export async function accountDevices(): Promise<AccountDevices> {
  return invoke<AccountDevices>("account_devices");
}

/**
 * Show a code that adds a device. It works once, for ten minutes.
 * Rejects with `not_signed_in` when this computer is not signed in to
 * PekoHub.
 */
export async function deviceAdd(): Promise<JoinCodeShown> {
  return invoke<JoinCodeShown>("device_add");
}

/** Join this computer to your account with a code from another device. */
export async function deviceJoin(code: string): Promise<AccountDevices> {
  return invoke<AccountDevices>("device_join", { code });
}

/** Remove a device from your account; returns the devices left. */
export async function deviceRemove(deviceId: string): Promise<AccountDevices> {
  return invoke<AccountDevices>("device_remove", { deviceId });
}

/** Decide something about your account; resolves to what happened. */
export async function securityDecide(id: string, approve: boolean): Promise<string> {
  return invoke<string>("security_decide", { id, approve });
}

/**
 * Look up a single channel's metadata + member count. Returns
 * `null` when the channel doesn't exist on the runtime.
 */
export async function channelGet(
  channelId: string,
  runtimeId?: RuntimeId,
): Promise<ChannelDetail | null> {
  return invoke<ChannelDetail | null>("channel_get", {
    channelId,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * List events on `channelId` since `since` (None = from the start).
 * Returns an empty array if the channel doesn't exist.
 */
export async function channelEvents(
  channelId: string,
  since?: string | null,
  runtimeId?: RuntimeId,
): Promise<ChannelEvent[]> {
  return invoke<ChannelEvent[]>("channel_events", {
    channelId,
    since: since ?? null,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * List the principal DIDs currently in `channelId`. Delegates to
 * the runtime's `ChannelMembers` IPC variant, which derives the
 * authoritative membership from the `Member*` event log.
 */
export async function channelMembers(
  channelId: string,
  runtimeId?: RuntimeId,
): Promise<ChannelMembers> {
  return invoke<ChannelMembers>("channel_members", {
    channelId,
    runtimeId: runtimeId ?? null,
  });
}

/** What starts a turn for a peko in a channel (ADR-082). */
export type WakePolicy = "human" | "mention" | "off";

/** A channel's kind, members, and how each member peko hosted here wakes. */
export interface ChannelInfo {
  channelId: string;
  kind: "dm" | "group";
  name: string;
  /** Actors in `kind:id` form, e.g. `user:local`, `principal:prin_…`. */
  members: string[];
  pekos: { name: string; localId: string; wake: WakePolicy }[];
  /** A group's home and PekoHub registration (runtime ADR-092 D1/D5). */
  group?: {
    /** This computer is the group's home: register it and make links here. */
    homeHere: boolean;
    owner: string;
    hubId: string | null;
    page: string | null;
    visibility: "invite_only" | "public" | null;
  } | null;
  /**
   * Everyone in it once, with names — those on other computers too
   * (runtime ChannelInfo `people`). Empty from older runtimes.
   */
  people?: ChannelPerson[];
  /** When the group began: its home's time, not this copy's. */
  createdAt?: string | null;
}

/** One member of a channel, as people read it. */
export interface ChannelPerson {
  /** Canonical address, e.g. `principal:hub:<id>`, `user:local:local`. */
  address: string;
  /** Other forms they appear as here (a remote peko's `did:key`, a Hub address). */
  aliases: string[];
  /** `principal` (a peko) or `user` (a person). */
  kind: string;
  name: string | null;
  /** A person's PekoHub handle (runtime ADR-124): unique, where names repeat. */
  handle?: string | null;
  /** This computer's person. */
  you: boolean;
  /** Hosted on this computer. */
  here: boolean;
}

/** Read a channel's kind, members, and pekos' wake policies (members only). */
export async function channelInfo(channelId: string): Promise<ChannelInfo> {
  return invoke<ChannelInfo>("channel_info", { channelId });
}

/**
 * Your messages to a peko on another computer that haven't reached it
 * yet (its computer has been asleep or off since), by message id. They
 * go out when it is back. Empty for a peko on this computer.
 */
export async function remotePekoUndelivered(name: string, runtimeId: string): Promise<string[]> {
  return invoke<string[]>("remote_peko_undelivered", { name, runtimeId });
}

/**
 * Runtime ADR-101: a group's board, changed with `op` first when given.
 * The change is posted as you (or as `senderName`, one of your pekos);
 * the runtime refuses what you may not do, with a reason.
 */
export async function channelBoard(
  channelId: string,
  op?: BoardOp,
  senderName?: string,
): Promise<BoardItem[]> {
  return invoke<BoardItem[]>("channel_board", {
    channelId,
    op: op ?? null,
    senderName: senderName ?? null,
  });
}

/**
 * Set how `principalName` wakes in a group. Only the peko's owner; a
 * DM always wakes on human posts and is refused. Resolves with the
 * policy now stored.
 */
export async function channelSetWake(
  channelId: string,
  principalName: string,
  wake: WakePolicy,
): Promise<WakePolicy> {
  return invoke<WakePolicy>("channel_set_wake", { channelId, principalName, wake });
}

/**
 * How often other pekos may wake one of your pekos in a group, and what
 * waits past that (runtime ADR-128).
 */
export interface ChannelWakes {
  /** A number as text, or `none`. */
  perHour: string;
  perDay: string;
  spentHour: number;
  spentDay: number;
  /** Posts to the peko that wait for the limit to have room. */
  held: number;
  /** When the limit next has room (RFC3339), when it holds posts now. */
  freeAt: string | null;
}

/**
 * Read how often other pekos may wake `principalName` in a group; with
 * `change`, set the limits (a number as text, or `none`) or let the peko
 * continue at once (`reset`) first. Only the peko's owner, groups only.
 */
export async function channelWakes(
  channelId: string,
  principalName: string,
  change: { perHour?: string; perDay?: string; reset?: boolean } = {},
): Promise<ChannelWakes> {
  return invoke<ChannelWakes>("channel_wakes", {
    channelId,
    principalName,
    perHour: change.perHour ?? null,
    perDay: change.perDay ?? null,
    reset: change.reset ?? false,
  });
}

/**
 * PR-2a: post a message to `channelId` from `senderName`. `parent`
 * is the optional task id of the message being replied to. Returns
 * the runtime-minted `task_id` (a UUID-shaped string) so the frontend
 * can correlate an inbound peko-stream event back to its outbound
 * post when PR-2b lights up the live stream.
 */
export async function channelPost(
  channelId: string,
  /** A peko to post as; `null` posts as you. */
  senderName: string | null,
  text: string,
  parent?: string | null,
  runtimeId?: RuntimeId,
  /** Absolute paths on this computer (runtime ADR-094). */
  attachments?: string[],
  /** Answers to a post's questions (runtime ADR-114); a root post only. */
  answers?: Answers,
  /** Reply to this message, by `msg_id` (runtime ADR-126). */
  replyTo?: string | null,
): Promise<string> {
  return invoke<string>("channel_post", {
    channelId,
    senderName,
    text,
    parent: parent ?? null,
    runtimeId: runtimeId ?? null,
    attachments: attachments ?? null,
    answers: answers ?? null,
    replyTo: replyTo ?? null,
  });
}

/**
 * PR-3: create a new channel owned by `creatorName`. The runtime
 * mints a fresh `ChannelId` (the `chan_<8 base36>` form), persists
 * the channel directory + initial `Created` event, and returns the
 * new id. Cross-runtime fan-out (TunnelChannelInvite) is a side
 * effect — the IPC response only acknowledges the local channel.
 */
export async function channelCreate(
  creatorName: string,
  name: string,
  runtimeId?: RuntimeId,
): Promise<string> {
  return invoke<string>("channel_create", {
    creatorName,
    name,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * PR-3: add `inviteeName` to `channelId` (invited by `inviterName`).
 * The runtime adds the invitee to the channel's membership log
 * (local + remote members), and for any peer runtime that hosts the
 * invitee it emits a signed `TunnelChannelInvite` envelope to
 * bootstrap the receiver's local mirror. Returns the joined channel
 * + invitee ids.
 */
export async function channelInvite(
  channelId: string,
  inviterName: string,
  inviteeName: string,
  runtimeId?: RuntimeId,
): Promise<ChannelInviteResult> {
  return invoke<ChannelInviteResult>("channel_invite", {
    channelId,
    inviterName,
    inviteeName,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * PR-3: remove `principalName` from `channelId`. The runtime appends
 * a `MemberLeft` event to the log. Returns the channel + principal
 * ids. The local channel directory is NOT auto-removed when the
 * last local member leaves — the local mirror persists until the
 * creator explicitly deletes it.
 */
export async function channelLeave(
  channelId: string,
  /** A peko to remove; `null` leaves the group yourself. */
  principalName: string | null,
  runtimeId?: RuntimeId,
): Promise<ChannelLeaveResult> {
  return invoke<ChannelLeaveResult>("channel_leave", {
    channelId,
    principalName,
    runtimeId: runtimeId ?? null,
  });
}

/**
 * PR-2b: subscribe to live events for `channelId`. The runtime
 * replays events from `since` (None = from start) then forwards
 * live events until the connection closes. Each event is emitted on
 * Tauri's `peko-stream` channel as `StreamEvent::ChannelEvent` —
 * the `useChannelStreamInvalidator` hook subscribes to those.
 *
 * This call resolves only when the runtime closes the stream
 * (`Done`) or fails with a runtime-side error (the Tauri command
 * surfaces it as a `String` error). A long-lived watcher can be
 * restarted by re-invoking this function after a disconnect.
 */
export async function channelEventsWatch(
  channelId: string,
  since?: string,
  runtimeId?: RuntimeId,
): Promise<void> {
  return invoke<void>("channel_events_watch", {
    channelId,
    since: since ?? null,
    runtimeId: runtimeId ?? null,
  });
}

// ─── Privacy choices and crash reports (pekohub ADR-014) ─────────

/** The owner's two privacy switches, and whether they have seen them. */
export interface PrivacyChoices {
  acknowledged: boolean;
  crashReports: boolean;
  usageEvents: boolean;
}

export async function privacyGet(): Promise<PrivacyChoices> {
  return invoke("privacy_get");
}

export async function privacySet(choices: PrivacyChoices): Promise<PrivacyChoices> {
  return invoke("privacy_set", { choices });
}
