import { useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useTeam, useRemoveTeam } from "../hooks/useTeams";
import { formatDate } from "../lib/format";
import {
  ArrowLeft,
  Users,
  Settings,
  Activity,
  Trash2,
  Loader2,
  Bot,
} from "lucide-react";
import ConfirmModal from "../components/modals/ConfirmModal";
import DataTable from "../components/DataTable";
import type { AgentSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  inactive: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const AGENT_STATUS_STYLE: Record<string, string> = {
  idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  busy: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  offline: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

type TabKey = "overview" | "agents" | "config";

export default function TeamDetail() {
  const { name } = useParams({ from: "/teams/$name" });
  const { data: team, isLoading } = useTeam(name);
  const remove = useRemoveTeam();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
        <p className="text-sm text-slate-400 dark:text-slate-600">Loading team...</p>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Users className="h-10 w-10 text-slate-300 dark:text-slate-700" />
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">Team not found</p>
        <Link
          to="/teams"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Teams
        </Link>
      </div>
    );
  }

  const tabs: { id: TabKey; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "agents", label: "Agents", icon: Users },
    { id: "config", label: "Config", icon: Settings },
  ];

  const agentColumns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: AgentSummary) => (
        <Link
          to="/agents/$name"
          params={{ name: row.name }}
          className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "model",
      header: "Model",
      sortable: true,
      render: (row: AgentSummary) => <span className="text-slate-600 dark:text-slate-400">{row.model}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: AgentSummary) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            AGENT_STATUS_STYLE[row.status] ?? AGENT_STATUS_STYLE.offline,
          ].join(" ")}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "sessionCount",
      header: "Sessions",
      sortable: true,
      render: (row: AgentSummary) => row.sessionCount,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/teams"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{team.name}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{team.description ?? "No description"}</p>
          </div>
          <span
            className={[
              "ml-2 inline-flex rounded-full px-3 py-1 text-xs font-medium",
              STATUS_STYLE[team.status] ?? STATUS_STYLE.inactive,
            ].join(" ")}
          >
            {team.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{team.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Description</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{team.description ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Orchestrator</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{team.orchestrator ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Agents</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{team.agentCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{formatDate(team.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Updated</dt>
                <dd className="font-medium text-slate-900 dark:text-white">{formatDate(team.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Agents</h3>
            </div>
            {team.agents.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-600">No agents in this team</p>
            ) : (
              <ul className="space-y-1.5">
                {team.agents.map((agent) => (
                  <li
                    key={agent.name}
                    className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Bot className="h-3 w-3 text-slate-400" />
                    <Link
                      to="/agents/$name"
                      params={{ name: agent.name }}
                      className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      {agent.name}
                    </Link>
                    <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{agent.model}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Agents Tab */}
      {activeTab === "agents" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Agents</h3>
          {team.agents.length > 0 ? (
            <DataTable
              columns={agentColumns}
              rows={team.agents}
              keyExtractor={(r) => r.name}
              emptyText="No agents in this team"
              searchable
              pageSize={10}
            />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900">
              <Users className="h-8 w-8 text-slate-300 dark:text-slate-700" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No agents in this team</p>
            </div>
          )}
        </div>
      )}

      {/* Config Tab */}
      {activeTab === "config" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Team Config</h3>
          <pre className="overflow-auto rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {JSON.stringify(team.config, null, 2)}
          </pre>
        </div>
      )}

      <ConfirmModal
        open={confirmRemove}
        title="Remove Team"
        message={`Are you sure you want to remove team "${team.name}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          remove.mutate(team.name);
          setConfirmRemove(false);
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
