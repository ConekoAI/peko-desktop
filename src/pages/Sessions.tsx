
import { Link } from "@tanstack/react-router";
import { useSessions } from "../hooks/useSessions";
import DataTable from "../components/DataTable";
import { formatDate } from "../lib/format";
import { Plus } from "lucide-react";
import type { SessionSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  closed: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export default function Sessions() {
  const { data: sessions, isLoading } = useSessions();

  const columns = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (row: SessionSummary) => (
        <Link
          to="/sessions/$id"
          params={{ id: row.id }}
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
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
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Sessions</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Browse conversation sessions
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">
          <Plus className="h-4 w-4" />
          New Session
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">Loading...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={sessions ?? []}
          keyExtractor={(r) => r.id}
          emptyText="No sessions found"
        />
      )}
    </div>
  );
}
