import { useState } from "react";
import { useCron, useRunCron, useRemoveCron, useAddCron } from "../hooks/useCron";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import { Plus, Play, Trash2, Loader2, X, Clock } from "lucide-react";
import type { CronJob } from "../types";

const RESULT_STYLE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  failure: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  running: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
};

function AddCronModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useAddCron();
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [command, setCommand] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !schedule.trim() || !command.trim()) return;
    add.mutate(
      { name: name.trim(), schedule: schedule.trim(), command: command.trim(), enabled: true },
      { onSuccess: onClose }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Add Cron Job</h2>
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
              placeholder="daily-backup"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Schedule (cron expression)</label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 0 * * *"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Command / Message</label>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="/backup full"
              rows={3}
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
              disabled={add.isPending || !name.trim() || !schedule.trim() || !command.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Job
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Cron() {
  const { data: jobs, isLoading } = useCron();
  const run = useRunCron();
  const remove = useRemoveCron();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: CronJob) => (
        <span className="font-medium text-slate-900 dark:text-white">{row.name}</span>
      ),
    },
    {
      key: "schedule",
      header: "Schedule",
      sortable: true,
      render: (row: CronJob) => (
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {row.schedule}
        </code>
      ),
    },
    {
      key: "command",
      header: "Command",
      sortable: false,
      render: (row: CronJob) => (
        <span className="truncate text-slate-600 dark:text-slate-400">{row.command}</span>
      ),
    },
    {
      key: "enabled",
      header: "Enabled",
      sortable: true,
      render: (row: CronJob) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            row.enabled
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
          ].join(" ")}
        >
          {row.enabled ? "Yes" : "No"}
        </span>
      ),
    },
    {
      key: "lastResult",
      header: "Last Result",
      sortable: true,
      render: (row: CronJob) =>
        row.lastResult ? (
          <span
            className={[
              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
              RESULT_STYLE[row.lastResult] ?? RESULT_STYLE.running,
            ].join(" ")}
          >
            {row.lastResult}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "nextRun",
      header: "Next Run",
      sortable: true,
      render: (row: CronJob) =>
        row.nextRun ? formatDate(row.nextRun) : "—",
    },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (row: CronJob) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => run.mutate(row.id)}
            disabled={run.isPending}
            className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
            title="Run now"
          >
            {run.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setConfirmId(row.id)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            title="Remove"
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
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Cron Jobs</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Scheduled tasks and recurring jobs
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Add Job
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
          <p className="text-sm text-slate-400 dark:text-slate-600">Loading cron jobs...</p>
        </div>
      ) : jobs && jobs.length > 0 ? (
        <DataTable
          columns={columns}
          rows={jobs}
          keyExtractor={(r) => r.id}
          emptyText="No cron jobs configured"
          searchable
          pageSize={10}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <Clock className="h-10 w-10 text-slate-300 dark:text-slate-700" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">No cron jobs yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Add your first scheduled job to get started</p>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Add Job
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!confirmId}
        title="Remove Cron Job"
        message="Are you sure you want to remove this cron job? This action cannot be undone."
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmId) remove.mutate(confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />

      <AddCronModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
