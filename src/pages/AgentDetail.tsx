import { useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useAgent, useRemoveAgent, useExportAgent } from "../hooks/useAgents";
import { useSessions } from "../hooks/useSessions";
import { formatDate } from "../lib/format";
import {
  ArrowLeft,
  Wrench,
  Puzzle,
  MessageSquare,
  Trash2,
  Download,
  Loader2,
  Bot,
  FileCode,
  Activity,
} from "lucide-react";
import ConfirmModal from "../components/modals/ConfirmModal";
import DataTable from "../components/DataTable";
import type { SessionSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  busy: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  offline: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

type TabKey = "overview" | "sessions" | "config";

export default function AgentDetail() {
  const { name } = useParams({ from: "/agents/$name" });
  const { data: agent, isLoading } = useAgent(name);
  const { data: sessions } = useSessions(name);
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
      header: "Title",
      sortable: true,
      render: (row: SessionSummary) => (
        <Link
          to="/sessions/$id"
          params={{ id: row.id }}
          className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {row.title ?? `Session ${row.id.slice(0, 8)}`}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: SessionSummary) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            row.status === "active"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : row.status === "paused"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
          ].join(" ")}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "messageCount",
      header: "Messages",
      sortable: true,
      render: (row: SessionSummary) => row.messageCount,
    },
    {
      key: "updatedAt",
      header: "Last Updated",
      sortable: true,
      render: (row: SessionSummary) => formatDate(row.updatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/agents"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{agent.name}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{agent.description ?? "No description"}</p>
          </div>
          <span
            className={[
              "ml-2 inline-flex rounded-full px-3 py-1 text-xs font-medium",
              STATUS_STYLE[agent.status] ?? STATUS_STYLE.offline,
            ].join(" ")}
          >
            {agent.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/sessions"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <MessageSquare className="h-4 w-4" />
            Send Message
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Model</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{agent.model}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Team</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{agent.team ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Sessions</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{agent.sessionCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{formatDate(agent.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Updated</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{formatDate(agent.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Tools</h3>
            </div>
            {agent.tools.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-600">No tools configured</p>
            ) : (
              <ul className="space-y-1.5">
                {agent.tools.map((tool) => (
                  <li
                    key={tool}
                    className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Wrench className="h-3 w-3 text-slate-400" />
                    {tool}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <Puzzle className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Extensions</h3>
            </div>
            {agent.extensions.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-600">No extensions installed</p>
            ) : (
              <ul className="space-y-1.5">
                {agent.extensions.map((ext) => (
                  <li
                    key={ext}
                    className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Puzzle className="h-3 w-3 text-slate-400" />
                    {ext}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {agent.systemPrompt && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-3 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">System Prompt</h3>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {agent.systemPrompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Sessions Tab */}
      {activeTab === "sessions" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Sessions</h3>
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
