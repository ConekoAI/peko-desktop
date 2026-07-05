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

// ─── Principal (ADR-041) ────────────────────────────────────────
//
// Principal is the only top-level runtime actor. Agent is a thin
// markdown prompt file inside a Principal and is not a top-level
// entity; sessions are internal storage and are not surfaced.

export interface PrincipalSummary {
  name: string;
  description?: string;
  status: string;
  exposure: string;
  /** Subject string ("user:alice", "principal:<did>", or "public"). */
  owner: string;
  runtimeId: string;
}

export interface PrincipalDetail extends PrincipalSummary {
  agentPrompts: { name: string; path: string }[];
  permissions: { subject: string; permission: string }[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

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

// ─── Shared with Me (PekoHub) ────────────────────────────────────
//
// Other runtimes share Principals (not "agents"). The shape mirrors
// the runtime's `shared_instances_list` payload.

export interface SharedInstance {
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