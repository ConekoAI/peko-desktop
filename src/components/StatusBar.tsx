import { useDaemonStatus } from "../hooks/useDaemon";
import { formatDuration } from "../lib/format";

export default function StatusBar() {
  const { data: status } = useDaemonStatus();

  return (
    <footer className="flex h-7 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <div className="flex items-center gap-2">
        <span
          className={[
            "inline-block h-2 w-2 rounded-full",
            status?.running ? "bg-emerald-500" : "bg-red-500",
          ].join(" ")}
        />
        <span>
          {status?.running
            ? `Daemon running${status.uptime ? ` · ${formatDuration(status.uptime)}` : ""}`
            : "Daemon stopped"}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span>v{status?.version ?? "0.0.0"}</span>
        <span className="text-slate-300 dark:text-slate-700">|</span>
        <span>Connected</span>
      </div>
    </footer>
  );
}
