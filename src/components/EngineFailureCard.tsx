import { AlertTriangle } from "lucide-react";
import { useEngineRestart } from "../hooks/useEngine";
import { useState } from "react";

/**
 * Layout-level recovery surface for the engine. Renders ONLY when
 * the supervisor's `EngineState` is `Failed` — the supervisor owns
 * the engine lifecycle (ADR-043) and the desktop no longer treats
 * `Running` as a user-visible badge. Users see this card only when
 * something needs their attention.
 *
 * Why this lives in the layout (not Settings):
 * - The recovery action has to be one click away when the chat is
 *   broken. Settings is two clicks deep, which is too far when the
 *   "Restart engine" button is what the user actually needs.
 * - The version mismatch banner lives here too, for the same reason.
 */
export default function EngineFailureCard({ message }: { message: string }) {
  const restart = useEngineRestart();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      data-testid="engine-failure-card"
      className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            The engine couldn't start
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            This usually means another peko daemon is using the IPC
            socket, or the bundled engine binary failed to launch.
            Chat and other engine-backed features won't work until
            the engine is running.
          </p>
          {showDetails && (
            <pre
              data-testid="engine-failure-details"
              className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-red-200 bg-white/60 p-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-slate-950/40 dark:text-red-300"
            >
              {message}
            </pre>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => restart.mutate()}
          disabled={restart.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {restart.isPending ? "Restarting…" : "Restart engine"}
        </button>
        <button
          onClick={() => setShowDetails((s) => !s)}
          className="text-xs font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-300"
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>
    </div>
  );
}