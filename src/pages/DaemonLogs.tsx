import { useState } from "react";
import { useSystemLogs } from "../hooks/useSystemLogs";
import Terminal from "../components/Terminal";
import { RefreshCw } from "lucide-react";

/**
 * Daemon log surface (operator-only). Distinct from `peko log
 * <PRINCIPAL>`, which is the per-principal activity feed surfaced at
 * `/log/$principalName`.
 */
export default function DaemonLogs() {
  const [lines, setLines] = useState(200);
  const { data: logs, isLoading, refetch } = useSystemLogs(lines);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Daemon Log</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Operator-level daemon log output
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            <option value={50}>50 lines</option>
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
            <option value={1000}>1000 lines</option>
          </select>
          <button
            onClick={() => refetch()}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400 dark:text-slate-600">
          Loading daemon log...
        </div>
      ) : (
        <Terminal lines={logs ?? []} className="flex-1" />
      )}
    </div>
  );
}
