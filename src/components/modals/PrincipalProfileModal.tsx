import { useNavigate } from "@tanstack/react-router";
import { usePrincipal } from "../../hooks/usePrincipals";
import { X, Bot, Activity, MessageSquare, Loader2 } from "lucide-react";

interface PrincipalProfileModalProps {
  open: boolean;
  principalName: string;
  onClose: () => void;
}

/**
 * Read-only principal detail modal. Per ADR-041/042 the desktop treats
 * Principals as containers; configuration happens through the `peko
 * principal` CLI and on-disk `principal.toml`. The modal surfaces what
 * `principal_list` returns (name, owner, status, exposure) and offers
 * quick links to the chat and activity log routes.
 */
export default function PrincipalProfileModal({
  open,
  principalName,
  onClose,
}: PrincipalProfileModalProps) {
  const navigate = useNavigate();
  const { data: principal, isLoading } = usePrincipal(principalName);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[60vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/50">
              <Bot className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : principal ? (
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {principal.name}
                </h2>
                {principal.description && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {principal.description}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Principal not found
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 p-5 text-sm">
          {principal && (
            <>
              <Row label="Owner" value={principal.owner} />
              <Row label="Status" value={principal.status} />
              <Row label="Exposure" value={principal.exposure} />
              <Row label="Runtime" value={principal.runtimeId} />
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          {principal && (
            <>
              <button
                onClick={() => {
                  onClose();
                  navigate({
                    to: "/chat/$principalName",
                    params: { principalName: principal.name },
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Chat
              </button>
              <button
                onClick={() => {
                  onClose();
                  navigate({
                    to: "/log/$principalName",
                    params: { principalName: principal.name },
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Activity className="h-3.5 w-3.5" />
                Activity Log
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
