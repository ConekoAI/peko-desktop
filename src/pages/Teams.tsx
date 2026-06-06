import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTeams, useRemoveTeam, useCreateTeam } from "../hooks/useTeams";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { Plus, Trash2, ExternalLink, Loader2, Users, X } from "lucide-react";
import type { TeamSummary } from "../types";



function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTeam();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
      },
      { onSuccess: onClose }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create Team</h2>
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
              placeholder="my-team"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
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

export default function Teams() {
  const { data: teams, isLoading } = useTeams();
  const remove = useRemoveTeam();
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: TeamSummary) => (
        <Link
          to="/teams/$name"
          params={{ name: row.name }}
          className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {row.name}
        </Link>
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
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (row: TeamSummary) => (
        <div className="flex items-center gap-2">
          <Link
            to="/teams/$name"
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
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Teams</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage agent teams</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          New Team
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
          <p className="text-sm text-slate-400 dark:text-slate-600">Loading teams...</p>
        </div>
      ) : teams && teams.length > 0 ? (
        <DataTable
          columns={columns}
          rows={teams}
          keyExtractor={(r) => r.name}
          emptyText="No teams found"
          searchable
          pageSize={10}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <Users className="h-10 w-10 text-slate-300 dark:text-slate-700" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">No teams yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Create your first team to get started</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Team
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!confirmName}
        title="Remove Team"
        message={`Are you sure you want to remove team "${confirmName ?? ""}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmName) remove.mutate(confirmName);
          setConfirmName(null);
        }}
        onCancel={() => setConfirmName(null)}
      />

      <CreateTeamModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
