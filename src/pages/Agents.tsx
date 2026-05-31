import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAgents, useRemoveAgent, useCreateAgent } from "../hooks/useAgents";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import { Plus, Trash2, ExternalLink, Loader2, Bot, X } from "lucide-react";
import type { AgentSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  busy: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  offline: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAgent();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), model, description: "" },
      { onSuccess: onClose }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create Agent</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="kimi">Kimi</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
      render: (row: AgentSummary) => {
        const parts = row.model.split("/");
        const provider = parts.length > 1 ? parts[0] : "—";
        return <span className="text-slate-600 dark:text-slate-400">{provider}</span>;
      },
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
      key: "lastActive",
      header: "Last Activity",
      sortable: true,
      render: (row: AgentSummary) => (row.lastActive ? formatDate(row.lastActive) : "—"),
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
