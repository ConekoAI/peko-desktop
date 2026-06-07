import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAgents } from "../hooks/useAgents";
import { useTeams } from "../hooks/useTeams";
import { useExtensions } from "../hooks/useExtensions";
import { useDaemonStatus, useDaemonStart, useDaemonStop, useDaemonRestart } from "../hooks/useDaemon";
import { formatDuration } from "../lib/format";
import CreateAgentModal from "../components/modals/CreateAgentModal";
import {
  Bot,
  Users,
  Puzzle,
  Activity,
  Play,
  Square,
  RotateCcw,
  Plus,
  Globe,
  FileText,
  Loader2,
} from "lucide-react";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  to?: string;
}) {
  const content = (
    <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
        <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

export default function Dashboard() {
  const { data: agents } = useAgents();
  const { data: teams } = useTeams();
  const { data: extensions } = useExtensions();
  const { data: daemon, isLoading: daemonLoading } = useDaemonStatus();
  const start = useDaemonStart();
  const stop = useDaemonStop();
  const restart = useDaemonRestart();

  const isMutating = start.isPending || stop.isPending || restart.isPending;
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Overview of your Peko environment
        </p>
      </div>

      {/* Daemon Status Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={[
                "flex h-12 w-12 items-center justify-center rounded-full",
                daemon?.running
                  ? "bg-emerald-50 dark:bg-emerald-950/30"
                  : "bg-red-50 dark:bg-red-950/30",
              ].join(" ")}
            >
              <Activity
                className={[
                  "h-6 w-6",
                  daemon?.running
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
                ].join(" ")}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Daemon {daemon?.running ? "Running" : "Stopped"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {daemonLoading
                  ? "Checking status..."
                  : daemon?.running
                    ? `Version ${daemon.version}${daemon.uptime ? ` · Uptime ${formatDuration(daemon.uptime)}` : ""}`
                    : "Start the daemon to enable agents and sessions"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!daemon?.running && (
              <button
                onClick={() => start.mutate()}
                disabled={isMutating}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start
              </button>
            )}
            {daemon?.running && (
              <>
                <button
                  onClick={() => stop.mutate()}
                  disabled={isMutating}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {stop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  Stop
                </button>
                <button
                  onClick={() => restart.mutate()}
                  disabled={isMutating}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {restart.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Restart
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={Bot} label="Agents" value={agents?.length ?? 0} />
        <StatCard icon={Users} label="Teams" value={teams?.length ?? 0} to="/teams" />
        <StatCard icon={Puzzle} label="Extensions" value={extensions?.length ?? 0} to="/extensions" />
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </button>
          <Link
            to="/registry"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Globe className="h-4 w-4" />
            Browse Registry
          </Link>
          <Link
            to="/logs"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <FileText className="h-4 w-4" />
            View Logs
          </Link>
        </div>
      </div>

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
