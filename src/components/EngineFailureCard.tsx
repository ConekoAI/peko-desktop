import { AlertTriangle } from "lucide-react";
import { useEngineRestart } from "../hooks/useEngine";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
            {t("layout.engineFailure.title")}
          </p>
          <p className="mt-1 text-xs text-danger">
            {t("layout.engineFailure.body")}
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
          {restart.isPending ? t("layout.engineFailure.restarting") : t("layout.engineFailure.restart")}
        </button>
        <button
          onClick={() => setShowDetails((s) => !s)}
          className="text-xs font-medium text-danger underline-offset-2 hover:underline"
        >
          {showDetails ? t("layout.engineFailure.hideDetails") : t("layout.engineFailure.showDetails")}
        </button>
      </div>
    </div>
  );
}