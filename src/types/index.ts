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

export interface AgentSummary {
  name: string;
  description?: string;
  provider: string;
  model: string;
  sessionCount: number;
  runtimeId: string;
}

export interface AgentDetail {
  name: string;
  description?: string;
  provider: string;
  model: string;
  sessionCount: number;
  systemPrompt?: string;
  tools: string[];
  extensions: string[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  runtimeId: string;
  status?: string;
}

export interface SessionSummary {
  id: string;
  agent: string;
  title?: string;
  messageCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  runtimeId: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
  branches?: string[];
  parentId?: string;
  metadata: Record<string, unknown>;
}



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

export interface Credential {
  provider: string;
  username?: string;
  token?: string;
  expiresAt?: string;
}

export interface SharedInstance {
  id: string;
  ownerId: number;
  ownerName: string;
  agentName: string;
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

export interface AgentPublishState {
  exposure: "unexposed" | "private" | "public";
  status: "online" | "offline" | "busy" | "error";
  instanceId?: string;
}
