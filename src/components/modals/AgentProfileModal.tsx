import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useAgent, useRemoveAgent, useExportAgent } from "../../hooks/useAgents";
import { useSessions } from "../../hooks/useSessions";
import { useExtensions, useEnableExtension, useDisableExtension } from "../../hooks/useExtensions";
import { formatDate } from "../../lib/format";
import ConfirmModal from "./ConfirmModal";
import DataTable from "../DataTable";
import {
  X,
  MessageSquare,
  Trash2,
  Download,
  Loader2,
  Bot,
  Puzzle,
  Activity,
  Calendar,
  Clock,
  Hash,
  Sparkles,
  Cloud,
  Power,
  PowerOff,
  FileCode,
} from "lucide-react";
import type { SessionSummary } from "../../types";

type TabKey = "overview" | "sessions" | "extensions" | "config";

function DetailItem({
  icon: Icon,
  label,
  value,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{value}</p>
          {badge && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {badge}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface AgentProfileModalProps {
  open: boolean;
  agentName: string;
  onClose: () => void;
}

export default function AgentProfileModal({ open, agentName, onClose }: AgentProfileModalProps) {
  const { data: agent, isLoading } = useAgent(agentName);
  const { data: sessions } = useSessions(agentName);
  const remove = useRemoveAgent();
  const exportAgent = useExportAgent();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const tabs: { id: TabKey; label: string; icon: React.ElementType }[] = useMemo(
    () => [
      { id: "overview", label: "Overview", icon: Activity },
      { id: "sessions", label: "Sessions", icon: MessageSquare },
      { id: "extensions", label: "Extensions", icon: Puzzle },
      { id: "config", label: "Config", icon: FileCode },
    ],
    []
  );

  const sessionColumns = useMemo(
    () => [
      {
        key: "title",
        header: "Session",
        sortable: true,
        render: (row: SessionSummary) => (
          <Link
            to="/chat/$agentName/$sessionId"
            params={{ agentName: agentName, sessionId: row.id }}
            className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            {row.title ?? `Session ${row.id.slice(0, 8)}`}
          </Link>
        ),
      },
      {
        key: "messageCount",
        header: "Messages",
        sortable: true,
        render: (row: SessionSummary) => (
          <span className="inline-flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
            <Hash className="h-3 w-3" />
            {row.messageCount}
          </span>
        ),
      },
      {
        key: "updatedAt",
        header: "Last Active",
        sortable: true,
        render: (row: SessionSummary) => (
          <span className="text-sm text-slate-500 dark:text-slate-400">{formatDate(row.updatedAt)}</span>
        ),
      },
    ],
    [agentName]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/50">
              <Bot className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              ) : agent ? (
                <>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{agent.name}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {agent.description ?? "No description"}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Agent not found</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isLoading && agent && (
              <>
                <Link
                  to="/chat/$agentName"
                  params={{ agentName: agent.name }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat
                </Link>
                <button
                  onClick={() => exportAgent.mutate(agent.name)}
                  disabled={exportAgent.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {exportAgent.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Export
                </button>
                <button
                  onClick={() => setConfirmRemove(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 border-b border-slate-200 px-5 pt-3 dark:border-slate-800">
          <div className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    activeTab === tab.id
                      ? "border-emerald-500 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300"
                      : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content — fixed min-height so all tabs feel consistent */}
        <div className="min-h-[360px] flex-1 overflow-y-auto p-5">
          {isLoading || !agent ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-400 dark:text-slate-600">Loading agent...</p>
            </div>
          ) : (
            <>
              {activeTab === "overview" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailItem icon={Sparkles} label="Model" value={agent.model} badge={agent.provider} />
                    <DetailItem
                      icon={Cloud}
                      label="Teams"
                      value={agent.memberships?.length ? agent.memberships.join(", ") : "Standalone"}
                    />
                    <DetailItem icon={Hash} label="Sessions" value={agent.sessionCount} />
                    <DetailItem icon={Calendar} label="Created" value={formatDate(agent.createdAt)} />
                    <DetailItem icon={Clock} label="Updated" value={formatDate(agent.updatedAt)} />
                  </div>

                  {agent.systemPrompt ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">System Prompt</h3>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {agent.systemPrompt}
                      </pre>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-sm text-slate-400 dark:text-slate-600">No system prompt configured</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "sessions" && (
                <div className="space-y-4">
                  {sessions && sessions.length > 0 ? (
                    <DataTable
                      columns={sessionColumns}
                      rows={sessions}
                      keyExtractor={(r) => r.id}
                      emptyText="No sessions found"
                      searchable
                      pageSize={10}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900">
                      <MessageSquare className="h-8 w-8 text-slate-300 dark:text-slate-700" />
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No sessions for this agent</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "extensions" && (
                <AgentExtensionsTab agentName={agent.name} agentExtensions={agent.extensions} />
              )}

              {activeTab === "config" && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Agent Config</h3>
                  <pre className="overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {JSON.stringify(agent.config, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmRemove}
        title="Remove Agent"
        message={`Are you sure you want to remove agent "${agent?.name ?? agentName}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (agent) remove.mutate(agent.name);
          setConfirmRemove(false);
          onClose();
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

function AgentExtensionsTab({
  agentName,
  agentExtensions,
}: {
  agentName: string;
  agentExtensions: string[];
}) {
  const { data: allExtensions, isLoading } = useExtensions();
  const enable = useEnableExtension();
  const disable = useDisableExtension();

  const target = agentName;
  const enabledSet = new Set(agentExtensions);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-300 dark:text-slate-700" />
        <p className="text-sm text-slate-400 dark:text-slate-600">Loading extensions...</p>
      </div>
    );
  }

  if (!allExtensions || allExtensions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900">
        <Puzzle className="h-8 w-8 text-slate-300 dark:text-slate-700" />
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No extensions installed</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allExtensions.map((ext) => {
        const isEnabled = enabledSet.has(ext.id) || enabledSet.has(ext.name);
        const isPending = enable.isPending || disable.isPending;

        return (
          <div
            key={ext.id}
            className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-white">{ext.name}</span>
                <span
                  className={[
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                    ext.source === "built-in"
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
                  ].join(" ")}
                >
                  {ext.source}
                </span>
              </div>
              {ext.description && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{ext.description}</p>
              )}
            </div>

            <button
              onClick={() => {
                if (isEnabled) {
                  disable.mutate({ name: ext.id, target });
                } else {
                  enable.mutate({ name: ext.id, target });
                }
              }}
              disabled={isPending}
              className={[
                "ml-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                isEnabled
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
              ].join(" ")}
            >
              {isEnabled ? (
                <>
                  <Power className="h-3.5 w-3.5" />
                  Enabled
                </>
              ) : (
                <>
                  <PowerOff className="h-3.5 w-3.5" />
                  Disabled
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
