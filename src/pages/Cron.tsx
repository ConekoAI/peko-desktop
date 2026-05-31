import { useCron } from "../hooks/useCron";
import DataTable from "../components/DataTable";
import { formatDate } from "../lib/format";

import type { CronJob } from "../types";

const RESULT_STYLE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  failure: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  running: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
};

export default function Cron() {
  const { data: jobs, isLoading } = useCron();

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
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">Loading...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={jobs ?? []}
          keyExtractor={(r) => r.id}
          emptyText="No cron jobs configured"
        />
      )}
    </div>
  );
}
