import { useAccessiblePrincipals } from "../hooks/useAccessiblePrincipals";
import { Loader2, User, MessageCircle, AlertCircle } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "online"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
      : status === "busy"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        : status === "error"
          ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
          : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        color,
      ].join(" ")}
    >
      {status}
    </span>
  );
}

export default function Shared() {
  const { data, isLoading, isError, error } = useAccessiblePrincipals();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Accessible Principals</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Principals you own or that have been privately shared with you
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading accessible principals...</span>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error?.message ?? "Failed to load accessible principals"}</span>
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <User className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            No principals are accessible to you yet.
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Principals you create, and ones shared with you, will appear here.
          </p>
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {data.map((inst) => (
            <div
              key={inst.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
                  <User className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {inst.publicName ?? inst.principalName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    by {inst.ownerName} · {inst.principalName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={inst.status} />
                <button
                  disabled={inst.status === "offline"}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <MessageCircle className="h-3 w-3" />
                  Chat
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
