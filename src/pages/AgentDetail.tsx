import { useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useAgent, useRemoveAgent, useExportAgent } from "../hooks/useAgents";
import { useTeams } from "../hooks/useTeams";
import { useSessions } from "../hooks/useSessions";
import { formatDate } from "../lib/format";
import {
  ArrowLeft,
  Puzzle,
  MessageSquare,
  Trash2,
  Download,
  Loader2,
  Bot,
  FileCode,
  Activity,
  Calendar,
  Clock,
  Hash,
  Sparkles,
  Cloud,
} from "lucide-react";
import ConfirmModal from "../components/modals/ConfirmModal";
import DataTable from "../components/DataTable";
import type { SessionSummary } from "../types";


type TabKey = "overview" | "sessions" | "config";

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
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
            {value}
          </p>
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

export default function AgentDetail() {
  const { name } = useParams({ from: "/agents/$name" });
  const { data: agent, isLoading } = useAgent(name);
  const { data: teams } = useTeams();
  const { data: sessions } = useSessions(name);
  const agentTeam = agent?.team ?? teams?.[0]?.name ?? "";
  const remove = useRemoveAgent();
  const exportAgent = useExportAgent();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
        <p className="text-sm text-slate-400 dark:text-slate-600">Loading agent...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Bot className="h-10 w-10 text-slate-300 dark:text-slate-700" />
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">Agent not found</p>
        <Link
          to="/agents"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Agents
        </Link>
      </div>
    );
  }

  const tabs: { id: TabKey; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "sessions", label: "Sessions", icon: MessageSquare },
    { id: "config", label: "Config", icon: FileCode },
  ];

  const sessionColumns = [
    {
      key: "title",
      header: "Session",
      sortable: true,
      render: (row: SessionSummary) => (
        <Link
          to="/chat/$teamName/$agentName/$sessionId"
          params={{ teamName: agentTeam, agentName: agent.name, sessionId: row.id }}
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
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {formatDate(row.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/agents"
            className="mt-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{agent.name}</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {agent.description ?? "No description"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/chat/$teamName/$agentName"
            params={{ teamName: agentTeam, agentName: agent.name }}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </Link>
          <button
            onClick={() => exportAgent.mutate(agent.name)}
            disabled={exportAgent.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {exportAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export
          </button>
          <button
            onClick={() => setConfirmRemove(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:flex-none",
                activeTab === tab.id
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {/* Details row */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem
                icon={Sparkles}
                label="Model"
                value={agent.model}
                badge={agent.provider}
              />
              <DetailItem
                icon={Cloud}
                label="Team"
                value={agent.team ?? "—"}
              />
              <DetailItem
                icon={Hash}
                label="Sessions"
                value={agent.sessionCount}
              />
              <DetailItem
                icon={Calendar}
                label="Created"
                value={formatDate(agent.createdAt)}
              />
              <DetailItem
                icon={Clock}
                label="Updated"
                value={formatDate(agent.updatedAt)}
              />
            </div>
          </div>

          {/* Extensions + System Prompt side by side */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center gap-2">
                <Puzzle className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Extensions
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {agent.extensions.length}
                  </span>
                </h3>
              </div>
              {agent.extensions.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-600">No extensions enabled</p>
              ) : (
                <ul className="space-y-1.5">
                  {agent.extensions.map((ext) => (
                    <li
                      key={ext}
                      className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      <Puzzle className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="truncate font-mono text-xs">{ext}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {agent.systemPrompt ? (
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">System Prompt</h3>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {agent.systemPrompt}
                </pre>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm text-slate-400 dark:text-slate-600">No system prompt configured</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sessions Tab */}
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
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900">
              <MessageSquare className="h-8 w-8 text-slate-300 dark:text-slate-700" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No sessions for this agent</p>
            </div>
          )}
        </div>
      )}

      {/* Config Tab */}
      {activeTab === "config" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Agent Config</h3>
          <pre className="overflow-auto rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {JSON.stringify(agent.config, null, 2)}
          </pre>
        </div>
      )}

      <ConfirmModal
        open={confirmRemove}
        title="Remove Agent"
        message={`Are you sure you want to remove agent "${agent.name}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          remove.mutate(agent.name);
          setConfirmRemove(false);
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
