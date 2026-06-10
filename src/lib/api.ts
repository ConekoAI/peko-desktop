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
  RuntimeConnection,
  SearchResult,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  Setting,
  SystemStatus,
  TeamDetail,
  TeamSummary,
} from "../types";

// ─── Runtimes ───────────────────────────────────────────────

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

export async function runtimeRename(id: string, name: string): Promise<RuntimeConnection> {
  return invoke("runtime_rename", { id, name });
}

// ─── Daemon ─────────────────────────────────────────────────

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

// ─── Agents ─────────────────────────────────────────────────

export async function agentList(runtimeId?: string): Promise<AgentSummary[]> {
  return invoke("agent_list", { runtime_id: runtimeId });
}

export async function agentShow(name: string, runtimeId?: string): Promise<AgentDetail> {
  return invoke("agent_show", { name, runtime_id: runtimeId });
}

export async function agentCreate(payload: {
  name: string;
  provider: string;
  model: string;
  description?: string;
  systemPrompt?: string;
  config?: Record<string, unknown>;
  runtimeId?: string;
}): Promise<AgentDetail> {
  return invoke("agent_create", {
    name: payload.name,
    provider: payload.provider,
    model: payload.model,
    runtime_id: payload.runtimeId,
  });
}

export async function agentUpdate(
  name: string,
  runtimeId: string | undefined,
  payload: Partial<{
    model: string;
    description: string;
    systemPrompt: string;
    config: Record<string, unknown>;
  }>,
): Promise<AgentDetail> {
  return invoke("agent_update", { name, runtime_id: runtimeId, payload });
}

export async function agentRemove(name: string, runtimeId?: string): Promise<void> {
  return invoke("agent_remove", { name, runtime_id: runtimeId });
}

export async function agentExport(name: string, runtimeId?: string, withExtensions?: boolean): Promise<string> {
  return invoke("agent_export", { name, runtime_id: runtimeId, with_extensions: withExtensions });
}

export async function agentImport(path: string, runtimeId?: string): Promise<AgentDetail> {
  return invoke("agent_import", { path, runtime_id: runtimeId });
}

export async function providerList(runtimeId?: string): Promise<ProviderInfo[]> {
  return invoke("provider_list", { runtime_id: runtimeId });
}

// ─── Teams ──────────────────────────────────────────────────

export async function teamList(): Promise<TeamSummary[]> {
  return invoke("team_list");
}

export async function teamShow(name: string): Promise<TeamDetail> {
  return invoke("team_show", { name });
}

export async function teamCreate(payload: {
  name: string;
  description?: string;
  members?: string[];
  config?: Record<string, unknown>;
}): Promise<TeamDetail> {
  return invoke("team_create", {
    name: payload.name,
    description: payload.description,
    members: payload.members,
  });
}

export async function teamJoin(team: string, agent: string): Promise<void> {
  return invoke("team_join", { team, agent });
}

export async function teamLeave(team: string, agent: string): Promise<void> {
  return invoke("team_leave", { team, agent });
}

export async function teamRemove(name: string): Promise<void> {
  return invoke("team_remove", { name });
}

// ─── Sessions ───────────────────────────────────────────────

export async function sessionList(agent?: string, runtimeId?: string): Promise<SessionSummary[]> {
  return invoke("session_list", { agent, runtime_id: runtimeId });
}

export async function sessionShow(id: string, runtimeId?: string): Promise<SessionDetail> {
  return invoke("session_show", { id, runtime_id: runtimeId });
}

export async function sessionHistory(id: string, runtimeId?: string): Promise<SessionMessage[]> {
  return invoke("session_history", { id, runtime_id: runtimeId });
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

export async function sessionSend(
  id: string,
  message: string,
  newSession: boolean = false,
  runtimeId?: string,
): Promise<void> {
  return invoke("session_send", { id, message, new_session: newSession, runtime_id: runtimeId });
}

// ─── Extensions ─────────────────────────────────────────────

export async function extensionList(): Promise<ExtensionSummary[]> {
  return invoke("extension_list");
}

export async function extensionInstall(path: string): Promise<ExtensionSummary> {
  return invoke("extension_install", { path });
}

export async function extensionEnable(name: string, target?: string): Promise<ExtensionSummary> {
  return invoke("extension_enable", { id: name, target });
}

export async function extensionDisable(name: string, target?: string): Promise<ExtensionSummary> {
  return invoke("extension_disable", { id: name, target });
}

export async function extensionUninstall(name: string): Promise<void> {
  return invoke("extension_uninstall", { name });
}

// ─── Registry ───────────────────────────────────────────────

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

// ─── Cron ───────────────────────────────────────────────────

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

// ─── Settings ───────────────────────────────────────────────

export async function settingsGet(key: string): Promise<string | null> {
  return invoke("settings_get", { key });
}

export async function settingsSet(key: string, value: string): Promise<void> {
  return invoke("settings_set", { key, value });
}

export async function settingsList(): Promise<Setting[]> {
  return invoke("settings_list");
}

// ─── Credentials ────────────────────────────────────────────

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

// ─── System ─────────────────────────────────────────────────

export async function systemStatus(runtimeId?: string): Promise<SystemStatus> {
  return invoke("system_status", { runtime_id: runtimeId });
}

export async function systemDoctor(runtimeId?: string): Promise<DoctorReport> {
  return invoke("system_doctor", { runtime_id: runtimeId });
}

export async function systemLogs(lines?: number): Promise<string[]> {
  return invoke("system_logs", { lines });
}

export async function systemEvents(): Promise<{ events: Array<Record<string, unknown>> }> {
  return invoke("system_events");
}
