import { useState } from "react";
import { Check, Loader2, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSetupStatus, useStopSetup } from "../../hooks/useSetup";
import type { RuntimeId } from "../../lib/api";

const DISMISSED_KEY = "peko.setupReportDismissed";

function dismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A peko's first turn, for its owner: what it has done so far, a button
 * that stops it, and its own report of how setup went. Shown above the
 * conversation while the peko is setting itself up, and afterwards until
 * the report is hidden. Renders nothing for a peko that is long set up.
 */
export default function SetupPanel({ name, runtimeId }: { name: string; runtimeId?: RuntimeId }) {
  const { t } = useTranslation();
  const { data: status } = useSetupStatus(name, runtimeId);
  const stop = useStopSetup();
  const [hidden, setHidden] = useState<string[]>(dismissed);

  if (!status) return null;
  const working = status.settingUp;
  const report = status.setup.length > 0 && !hidden.includes(name) ? status.report : null;
  if (!working && !report) return null;

  function hide() {
    const next = [...new Set([...hidden, name])];
    setHidden(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Hidden for this visit only.
    }
  }

  return (
    <section
      className="mx-4 mt-3 rounded-lg border border-line bg-surface-sunken p-3 text-xs"
      data-testid="setup-panel"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-medium text-fg">
          {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {working ? t("peko.setup.title", { name }) : t("peko.setup.reportTitle")}
        </h2>
        {working ? (
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1"
            disabled={!status.running || stop.isPending}
            onClick={() => stop.mutate({ name, runtimeId })}
            data-testid="setup-stop"
          >
            <Square className="h-3 w-3" />
            {stop.isPending ? t("peko.setup.stopping") : t("peko.setup.stop")}
          </button>
        ) : (
          <button
            type="button"
            className="text-fg-subtle hover:text-fg-soft"
            onClick={hide}
            aria-label={t("peko.setup.hide")}
            data-testid="setup-hide"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {working && (
        <>
          <p className="mt-1 text-fg-subtle">{t("peko.setup.stopHint")}</p>
          {status.steps.length === 0 ? (
            <p className="mt-2 text-fg-muted">{t("peko.setup.empty")}</p>
          ) : (
            <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-fg-soft">
              {status.steps.map((step) => (
                <li key={step.callId} className="flex items-start gap-1.5" data-testid="setup-step">
                  {step.outcome === null ? (
                    <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
                  ) : step.outcome === "ok" ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" />
                  ) : (
                    <X className="mt-0.5 h-3 w-3 shrink-0 text-danger" aria-label={t("peko.setup.stepFailed")} />
                  )}
                  <span className="min-w-0 break-words">{step.line}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {stop.error && (
        <p className="mt-2 text-danger">
          {stop.error instanceof Error ? stop.error.message : String(stop.error)}
        </p>
      )}

      {report && (
        <pre
          className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-fg-soft"
          data-testid="setup-report"
        >
          {report}
        </pre>
      )}
    </section>
  );
}
