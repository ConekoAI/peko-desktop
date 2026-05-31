import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAgents, useRemoveAgent } from "../hooks/useAgents";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import type { AgentSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  busy: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  offline: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export default function Agents() {
  const { data: agents, isLoading } = useAgents();
  const remove = useRemoveAgent();
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: AgentSummary) => (
        <Link
          to="/agents/$name"
          params={{ name: row.name }}
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
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
            STATUS_STYLE[row.status] ?? STATUS_STYLE.offline,
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
    {
      key: "lastActive",
      header: "Last Active",
      sortable: true,
      render: (row: AgentSummary) =>
        row.lastActive ? formatDate(row.lastActive) : "—",
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (row: AgentSummary) => (
        <div className="flex items-center gap-2">
          <Link
            to="/agents/$name"
            params={{ name: row.name }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => setConfirmName(row.name)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Agents</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage your AI agents
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">
          Loading...
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={agents ?? []}
          keyExtractor={(r) => r.name}
          emptyText="No agents found"
        />
      )}

      <ConfirmModal
        open={!!confirmName}
        title="Remove Agent"
        message={`Are you sure you want to remove agent "${confirmName ?? ""}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmName) remove.mutate(confirmName);
          setConfirmName(null);
        }}
        onCancel={() => setConfirmName(null)}
      />
    </div>
  );
}
