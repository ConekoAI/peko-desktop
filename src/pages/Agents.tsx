import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAgents, useRemoveAgent } from "../hooks/useAgents";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import CreateAgentModal from "../components/modals/CreateAgentModal";
import { Plus, Trash2, ExternalLink, Loader2, Bot } from "lucide-react";
import type { AgentSummary } from "../types";

export default function Agents() {
  const { data: agents, isLoading } = useAgents();
  const remove = useRemoveAgent();
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = [
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
      key: "provider",
      header: "Provider",
      sortable: true,
      render: (row: AgentSummary) => (
        <span className="text-slate-600 dark:text-slate-400">{row.provider}</span>
      ),
    },
    {
      key: "model",
      header: "Model",
      sortable: true,
      render: (row: AgentSummary) => <span className="text-slate-600 dark:text-slate-400">{row.model}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (row: AgentSummary) => (
        <div className="flex items-center gap-2">
          <Link
            to="/agents/$name"
            params={{ name: row.name }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="View"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => setConfirmName(row.name)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            title="Delete"
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
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage your AI agents</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
          <p className="text-sm text-slate-400 dark:text-slate-600">Loading agents...</p>
        </div>
      ) : agents && agents.length > 0 ? (
        <DataTable
          columns={columns}
          rows={agents}
          keyExtractor={(r) => r.name}
          emptyText="No agents found"
          searchable
          pageSize={10}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <Bot className="h-10 w-10 text-slate-300 dark:text-slate-700" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">No agents yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Create your first agent to get started</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </button>
        </div>
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

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
