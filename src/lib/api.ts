import { invoke } from "@tauri-apps/api/core";
import type {
  AgentDetail,
  AgentSummary,
  AuthStatus,
  BundleItem,
  CronJob,
  Credential,
  DaemonStatus,
  DoctorReport,
  ExtensionSummary,
  ProviderInfo,
  SearchResult,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  Setting,
  SystemStatus,
  TeamDetail,
  TeamSummary,
} from "../types";

// ─── Daemon ───────────────────────────────────────────────

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

// ─── Agents ───────────────────────────────────────────────

export async function agentList(): Promise<AgentSummary[]> {
  return invoke("agent_list");
}

export async function agentShow(name: string): Promise<AgentDetail> {
  return invoke("agent_show", { name });
}

export async function agentCreate(payload: {
  name: string;
  provider: string;
  model: string;
  description?: string;
  systemPrompt?: string;
  team?: string;
  config?: Record<string, unknown>;
}): Promise<AgentDetail> {
  return invoke("agent_create", { 
    name: payload.name, 
    provider: payload.provider, 
    model: payload.model 
  });
}

export async function agentUpdate(
  name: string,
  payload: Partial<{
    model: string;
    description: string;
    systemPrompt: string;
    team: string;
    config: Record<string, unknown>;
  }>,
): Promise<AgentDetail> {
  return invoke("agent_update", { name, payload });
}

export async function agentRemove(name: string): Promise<void> {
  return invoke("agent_remove", { name });
}

export async function agentExport(name: string): Promise<string> {
  return invoke("agent_export", { name });
}

export async function agentImport(path: string): Promise<AgentDetail> {
  return invoke("agent_import", { path });
}

export async function providerList(): Promise<ProviderInfo[]> {
  return invoke("provider_list");
}

// ─── Teams ────────────────────────────────────────────────

export async function teamList(): Promise<TeamSummary[]> {
  return invoke("team_list");
}

export async function teamShow(name: string): Promise<TeamDetail> {
  return invoke("team_show", { name });
}

export async function teamCreate(payload: {
  name: string;
  description?: string;
  orchestrator?: string;
  agents?: string[];
  config?: Record<string, unknown>;
}): Promise<TeamDetail> {
  return invoke("team_create", { payload });
}

export async function teamUpdate(
  name: string,
  payload: Partial<{
    description: string;
    orchestrator: string;
    agents: string[];
    config: Record<string, unknown>;
  }>,
): Promise<TeamDetail> {
  return invoke("team_update", { name, payload });
}

export async function teamRemove(name: string): Promise<void> {
  return invoke("team_remove", { name });
}

// ─── Sessions ─────────────────────────────────────────────

export async function sessionList(agent?: string): Promise<SessionSummary[]> {
  return invoke("session_list", { agent });
}

export async function sessionShow(id: string): Promise<SessionDetail> {
  return invoke("session_show", { id });
}

export async function sessionHistory(id: string): Promise<SessionMessage[]> {
  return invoke("session_history", { id });
}

export async function sessionCreate(payload: {
  agent: string;
  title?: string;
  parentId?: string;
}): Promise<SessionDetail> {
  return invoke("session_create", { payload });
}

export async function sessionBranch(sessionId: string, messageId: string): Promise<SessionDetail> {
  return invoke("session_branch", { sessionId, messageId });
}

export async function sessionCompact(sessionId: string): Promise<SessionDetail> {
  return invoke("session_compact", { sessionId });
}

export async function sessionClose(id: string): Promise<void> {
  return invoke("session_close", { id });
}

export async function sessionSend(id: string, message: string, newSession: boolean = false): Promise<void> {
  return invoke("session_send", { id, message, new_session: newSession });
}

// ─── Extensions ───────────────────────────────────────────

export async function extensionList(): Promise<ExtensionSummary[]> {
  return invoke("extension_list");
}

export async function extensionInstall(path: string): Promise<ExtensionSummary> {
  return invoke("extension_install", { path });
}

export async function extensionEnable(name: string): Promise<ExtensionSummary> {
  return invoke("extension_enable", { name });
}

export async function extensionDisable(name: string): Promise<ExtensionSummary> {
  return invoke("extension_disable", { name });
}

export async function extensionUninstall(name: string): Promise<void> {
  return invoke("extension_uninstall", { name });
}

// ─── Registry ─────────────────────────────────────────────

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

export async function registryLogin(username: string, token: string): Promise<AuthStatus> {
  return invoke("registry_login", { username, token });
}

export async function registryLogout(): Promise<void> {
  return invoke("registry_logout");
}

// ─── Cron ─────────────────────────────────────────────────

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

export async function cronUpdate(
  id: string,
  payload: Partial<{ name: string; schedule: string; command: string; enabled: boolean }>,
): Promise<CronJob> {
  return invoke("cron_update", { id, payload });
}

export async function cronRemove(id: string): Promise<void> {
  return invoke("cron_remove", { id });
}

export async function cronRun(id: string): Promise<void> {
  return invoke("cron_run", { id });
}

// ─── Settings ─────────────────────────────────────────────

export async function settingsGet(key: string): Promise<string | null> {
  return invoke("settings_get", { key });
}

export async function settingsSet(key: string, value: string): Promise<void> {
  return invoke("settings_set", { key, value });
}

export async function settingsList(): Promise<Setting[]> {
  return invoke("settings_list");
}

// ─── Credentials ──────────────────────────────────────────

export async function credentialGet(provider: string): Promise<Credential | null> {
  return invoke("credential_get", { provider });
}

export async function credentialSet(payload: Credential): Promise<void> {
  return invoke("credential_set", { payload });
}

export async function credentialDelete(provider: string): Promise<void> {
  return invoke("credential_delete", { provider });
}

export async function credentialTest(provider: string): Promise<{ success: boolean; message?: string }> {
  return invoke("credential_test", { provider });
}

export async function credentialList(): Promise<Credential[]> {
  return invoke("credential_list");
}

// ─── System ───────────────────────────────────────────────

export async function systemStatus(): Promise<SystemStatus> {
  return invoke("system_status");
}

export async function systemDoctor(): Promise<DoctorReport> {
  return invoke("system_doctor");
}

export async function systemLogs(lines?: number): Promise<string[]> {
  return invoke("system_logs", { lines });
}

export async function systemEvents(): Promise<{ events: Array<Record<string, unknown>> }> {
  return invoke("system_events");
}
