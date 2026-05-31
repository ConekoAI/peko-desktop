import { Link } from "@tanstack/react-router";
import { useAgents } from "../hooks/useAgents";
import { useDaemonStatus } from "../hooks/useDaemon";
import { useSystemStatus } from "../hooks/useSystemStatus";
import { formatBytes, formatDuration } from "../lib/format";
import {
  Bot,
  Users,
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  ArrowRight,
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
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/30">
        <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
      {to && <ArrowRight className="mt-1 h-4 w-4 text-slate-300 dark:text-slate-700" />}
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
  const { data: daemon } = useDaemonStatus();
  const { data: system } = useSystemStatus();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Overview of your Peko environment
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Bot}
          label="Agents"
          value={agents?.length ?? 0}
          to="/agents"
        />
        <StatCard
          icon={Users}
          label="Teams"
          value="—"
          to="/teams"
        />
        <StatCard
          icon={Activity}
          label="Daemon"
          value={daemon?.running ? "Running" : "Stopped"}
          sub={daemon?.uptime ? `Uptime ${formatDuration(daemon.uptime)}` : undefined}
        />
        <StatCard
          icon={Cpu}
          label="CPU"
          value={system?.cpu.usage ? `${system.cpu.usage.toFixed(1)}%` : "—"}
          sub={`${system?.cpu.cores ?? "—"} cores`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <MemoryStick className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Memory</h3>
          </div>
          {system?.memory ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Used</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {formatBytes(system.memory.used)} / {formatBytes(system.memory.total)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{
                    width: `${(system.memory.used / system.memory.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-600">No data</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Disk</h3>
          </div>
          {system?.disk ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Used</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {formatBytes(system.disk.used)} / {formatBytes(system.disk.total)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{
                    width: `${(system.disk.used / system.disk.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-600">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}
