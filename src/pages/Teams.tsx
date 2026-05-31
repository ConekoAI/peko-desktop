import { useState } from "react";

import { useTeams, useRemoveTeam } from "../hooks/useTeams";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { Plus, Trash2 } from "lucide-react";
import type { TeamSummary } from "../types";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  inactive: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export default function Teams() {
  const { data: teams, isLoading } = useTeams();
  const remove = useRemoveTeam();
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: TeamSummary) => (
        <span className="font-medium text-slate-900 dark:text-white">{row.name}</span>
      ),
    },
    {
      key: "description",
      header: "Description",
      sortable: false,
      render: (row: TeamSummary) => (
        <span className="text-slate-600 dark:text-slate-400">{row.description ?? "—"}</span>
      ),
    },
    {
      key: "agentCount",
      header: "Agents",
      sortable: true,
      render: (row: TeamSummary) => row.agentCount,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: TeamSummary) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_STYLE[row.status] ?? STATUS_STYLE.inactive,
          ].join(" ")}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (row: TeamSummary) => (
        <div className="flex items-center gap-2">
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
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Teams</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Manage agent teams
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">
          <Plus className="h-4 w-4" />
          New Team
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">Loading...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={teams ?? []}
          keyExtractor={(r) => r.name}
          emptyText="No teams found"
        />
      )}

      <ConfirmModal
        open={!!confirmName}
        title="Remove Team"
        message={`Are you sure you want to remove team "${confirmName ?? ""}"?`}
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
