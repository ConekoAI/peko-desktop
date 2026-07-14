export interface RuntimeConnection {
  id: string;
  name: string;
  connectionType: "local" | "remote";
  status: "connected" | "disconnected" | "connecting" | "error";
  ipcPath?: string;
  pekohubUrl?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  version: string;
}

// ─── Engine (ADR-043) ─────────────────────────────────────────────
//
// The engine is the bundled `peko` sidecar, owned by the desktop's
// `SidecarSupervisor`. EngineState is the canonical source of truth
// for the engine lifecycle: Stopped / Starting / Running / Restarting
// / Failed. Anything that needs to know if the engine is up should
// poll this, not the legacy DaemonStatus shape (which is now a
// projection from EngineState kept only for backwards compatibility).
//
// Diagnostics is the power-user bundle surfaced from Settings →
// Daemon. It is intentionally verbose (PID, version parity, log
// ring, restart count, ownership mode, etc.) and only renders when
// the user has explicitly navigated to the diagnostics surface
// (ADR-043 §adoption — engine status is invisible on the happy
// path, so the diagnostics panel is opt-in by route, not by an
// arm-and-reveal toggle).

export type EngineState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running"; pid: number; version: string; uptime_secs: number }
  | { kind: "restarting"; attempt: number }
  | { kind: "failed"; message: string };

export interface EngineDiagnostics {
  state: EngineState;
  pid: number | null;
  version: string | null;
  expected_version: string | null;
  /** `true` when actual == expected, `false` when both present and
   *  different, `null` when one side is unknown (engine still
   *  starting). */
  version_matches: boolean | null;
  uptime_secs: number;
  lockfile_path: string;
  socket_path: string;
  log_ring: string[];
  restart_count: number;
  last_error: string | null;
  /** ADR-043 §adoption: `true` when the supervisor owns the engine
   *  process (spawned a child sidecar), `false` when it adopted a
   *  foreign daemon already on the IPC socket. The diagnostics
   *  panel disables the Restart button on borrowed engines — they
   *  are not the desktop's to restart. */
  owns_process: boolean;
  /** Launch mode of the running engine (`"sidecar"` or `"headless"`).
   *  `null` when the supervisor owns the engine and hasn't learned
   *  the mode yet, or when the foreign daemon is from a build that
   *  doesn't report it. */
  mode: string | null;
}

export interface EngineVersionMismatch {
  actual: string;
  expected: string;
}

// ─── Principal (ADR-041) ────────────────────────────────────────
//
// Principal is the only top-level runtime actor. Agent is a thin
// markdown prompt file inside a Principal and is not a top-level
// entity; sessions are internal storage and are not surfaced.
//
// The `PrincipalSummary` interface lives in `lib/api.ts` next to
// the IPC wrappers that produce it. A richer `PrincipalDetail`
// projection was retired alongside the agent→principal migration
// (ADR-041) — the runtime does not currently expose per-principal
// agent-prompt lists or config snapshots over IPC.

// ─── peko log / HistoryEvent (ADR-042) ──────────────────────────

export type HistoryEvent =
  | { kind: "session"; sessionId: string; startedAt: string }
  | { kind: "message"; role: string; content: string; timestamp: string }
  | { kind: "tool_call"; toolName: string; args: string; toolCallId: string; timestamp: string }
  | { kind: "tool_result"; toolCallId: string; output: string; error?: string; timestamp: string }
  | { kind: "thinking"; content: string; timestamp: string }
  | { kind: "compaction"; timestamp: string }
  | { kind: "custom"; customType: string; timestamp: string };

export interface LogResponse {
  sessionId: string | null;
  events: HistoryEvent[];
  truncated: boolean;
  /** Subject string the response was scoped to (owner-root or peer). */
  peer: string;
}

// ─── Extension / Registry / Cron / System ────────────────────────

export interface ExtensionSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  source: string;
  extType: string;
}

export interface SearchResult {
  ref: string;
  name: string;
  description?: string;
  author?: string;
  version: string;
  downloads: number;
  tags: string[];
}

export interface BundleItem {
  ref: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags: string[];
  size?: number;
  checksum?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
  tokenExpiry?: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  lastResult?: "success" | "failure" | "running";
}

export interface SystemStatus {
  daemon: DaemonStatus;
  platform: string;
  arch: string;
  memory: {
    total: number;
    used: number;
    free: number;
  };
  cpu: {
    cores: number;
    usage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
  };
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  failed: number;
  warnings: number;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  suggestion?: string;
}

export interface StreamEvent {
  id?: string;
  type: "chunk" | "done" | "error" | "tool_call" | "tool_result";
  content?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  apiType: string;
  defaultModel: string;
  requiresKey: boolean;
  isLocal: boolean;
}

export interface Setting {
  key: string;
  value: string;
  defaultValue?: string;
  description?: string;
  category: string;
}

// ─── Credential (keychain-only) ─────────────────────────────────
//
// Credentials are owned by the runtime's OS keychain (`peko credential
// set/list/test/delete`). The desktop never holds the secret beyond
// the IPC call. The shape here mirrors what `credential_test` and
// `credential_list` return over IPC.

export interface Credential {
  provider: string;
  hasKey: boolean;
  lastTested?: string;
}

export interface AccessiblePrincipal {
  id: string;
  ownerId: number;
  ownerName: string;
  principalName: string;
  publicName?: string;
  status: "online" | "offline" | "busy" | "error";
  runtimeId?: string;
  runtimeDisplayName?: string;
  description?: string;
  exposure?: "unexposed" | "private" | "public";
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}