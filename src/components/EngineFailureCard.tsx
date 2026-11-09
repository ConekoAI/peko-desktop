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
      className="rounded-xl border border-danger/25 bg-danger-soft p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-danger">
            The engine couldn't start
          </p>
          <p className="mt-1 text-xs text-danger">
            This usually means another peko daemon is using the IPC
            socket, or the bundled engine binary failed to launch.
            Chat and other engine-backed features won't work until
            the engine is running.
          </p>
          {showDetails && (
            <pre
              data-testid="engine-failure-details"
              className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-danger/25 bg-surface/60 p-2 font-mono text-[11px] text-danger"
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
          className="btn-danger-solid btn-sm"
        >
          {restart.isPending ? "Restarting…" : "Restart engine"}
        </button>
        <button
          onClick={() => setShowDetails((s) => !s)}
          className="text-xs font-medium text-danger underline-offset-2 hover:underline"
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>
    </div>
  );
}