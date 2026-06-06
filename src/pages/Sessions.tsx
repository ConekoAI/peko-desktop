import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useSessions, useCreateSession, useCompactSession } from "../hooks/useSessions";
import { useAgents } from "../hooks/useAgents";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import {
  Plus,
  Minimize2,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";
import type { SessionSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  inactive: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  unknown: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function CreateSessionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateSession();
  const { data: agents } = useAgents();
  const [agent, setAgent] = useState("");
  const [title, setTitle] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agent.trim()) return;
    create.mutate(
      { agent: agent.trim(), title: title.trim() || undefined },
      { onSuccess: onClose }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create Session</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Agent
            </label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            >
              <option value="">Select an agent</option>
              {agents?.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Title <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New conversation"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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
              disabled={create.isPending || !agent.trim()}
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

export default function Sessions() {
  const [agentFilter, setAgentFilter] = useState<string>("");
  const { data: sessions, isLoading } = useSessions(agentFilter || undefined);
  const { data: agents } = useAgents();
  const compact = useCompactSession();
  const [compactId, setCompactId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (row: SessionSummary) => (
        <Link
          to="/chat/$agentName/$sessionId"
          params={{ agentName: row.agent, sessionId: row.id }}
          className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {row.title ?? `Session ${row.id.slice(0, 8)}`}
        </Link>
      ),
    },
    {
      key: "agent",
      header: "Agent",
      sortable: true,
      render: (row: SessionSummary) => (
        <span className="text-slate-600 dark:text-slate-400">{row.agent}</span>
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
            STATUS_STYLE[row.status] ?? STATUS_STYLE.closed,
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
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (row: SessionSummary) => (
        <div className="flex items-center gap-2">
          <Link
            to="/chat/$agentName/$sessionId"
            params={{ agentName: row.agent, sessionId: row.id }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="View"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => setCompactId(row.id)}
            disabled={compact.isPending}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="Compact"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Sessions</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Browse conversation sessions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          >
            <option value="">All agents</option>
            {agents?.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Session
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
          <p className="text-sm text-slate-400 dark:text-slate-600">Loading sessions...</p>
        </div>
      ) : sessions && sessions.length > 0 ? (
        <DataTable
          columns={columns}
          rows={sessions}
          keyExtractor={(r) => r.id}
          emptyText="No sessions found"
          searchable
          pageSize={10}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <MessageSquare className="h-10 w-10 text-slate-300 dark:text-slate-700" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">No sessions yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Create your first session to get started</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Session
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!compactId}
        title="Compact Session"
        message="Compacting will summarize older messages to reduce token usage. This action cannot be undone."
        variant="warning"
        confirmText="Compact"
        onConfirm={() => {
          if (compactId) compact.mutate(compactId);
          setCompactId(null);
        }}
        onCancel={() => setCompactId(null)}
      />

      <CreateSessionModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
