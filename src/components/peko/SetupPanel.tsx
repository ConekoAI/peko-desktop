import { useState } from "react";
import { AlertTriangle, Check, Circle, Loader2, RotateCw, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { isSettingUp, useRunSetup, useSetupStatus, useStopSetup } from "../../hooks/useSetup";
import { useModels } from "../../hooks/useModels";
import { usePrincipalUpdate } from "../../hooks/usePrincipals";
import type { RuntimeId, SetupResult, SetupStatus } from "../../lib/api";

const DISMISSED_KEY = "peko.setupReportDismissed";

function dismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

/**
 * A peko's first turn and its setup steps, for its owner. While the peko
 * works: what it is doing, and a button that stops it. Afterwards: each
 * setup step with how it went, and a button that has the peko go through
 * them again, until the panel is hidden. Renders nothing for a peko that
 * is set up and has no setup steps.
 */
export default function SetupPanel({ name, runtimeId }: { name: string; runtimeId?: RuntimeId }) {
  const { t } = useTranslation();
  const { data: status } = useSetupStatus(name, runtimeId);
  const stop = useStopSetup();
  const run = useRunSetup();
  const [hidden, setHidden] = useState<string[]>(dismissed);

  if (!status) return null;
  // Its first turn can't go on: show why, and what fixes it.
  if (firstTurnStuck(status)) {
    return <StuckFirstTurn name={name} runtimeId={runtimeId} status={status} />;
  }
  const working = isSettingUp(status);
  const steps = status.results;
  // An engine that predates step-by-step results sends only the report.
  const report = steps.length === 0 && status.setup.length > 0 ? status.report : null;
  const hasOutcome = steps.length > 0 || !!report;
  if (!working && (!hasOutcome || hidden.includes(name))) return null;

  function hide() {
    const next = [...new Set([...hidden, name])];
    setHidden(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Hidden for this visit only.
    }
  }

  function tryAgain() {
    // A rerun is worth seeing even if the last outcome was hidden.
    const next = hidden.filter((n) => n !== name);
    setHidden(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Nothing to undo.
    }
    run.mutate({ name, runtimeId });
  }

  const unfinished = steps.some((step) => step.status !== "ready");
  const title = !working
    ? t("peko.setup.resultsTitle")
    : status.settingUp
      ? t("peko.setup.title", { name })
      : t("peko.setup.titleSteps", { name });
  const failure = errorText(stop.error) ?? errorText(run.error);

  return (
    <section
      className="mx-4 mt-3 rounded-lg border border-line bg-surface-sunken p-3 text-xs"
      data-testid="setup-panel"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-medium text-fg">
          {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
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
            <>
              {unfinished && (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1"
                  disabled={run.isPending}
                  onClick={tryAgain}
                  data-testid="setup-retry"
                >
                  <RotateCw className="h-3 w-3" />
                  {run.isPending ? t("peko.setup.starting") : t("peko.setup.tryAgain")}
                </button>
              )}
              <button
                type="button"
                className="text-fg-subtle hover:text-fg-soft"
                onClick={hide}
                aria-label={t("peko.setup.hide")}
                data-testid="setup-hide"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {working && <p className="mt-1 text-fg-subtle">{t("peko.setup.stopHint")}</p>}

      {steps.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {steps.map((step, index) => (
            <SetupStepRow key={index} step={step} />
          ))}
        </ol>
      )}

      {working &&
        (status.steps.length === 0 ? (
          <p className="mt-2 text-fg-muted">{t("peko.setup.empty")}</p>
        ) : (
          <ol className="mt-2 max-h-32 space-y-0.5 overflow-y-auto border-t border-line pt-2 font-mono text-[11px] text-fg-soft">
            {status.steps.map((call) => (
              <li key={call.callId} className="flex items-start gap-1.5" data-testid="setup-step">
                {call.outcome === null ? (
                  <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
                ) : call.outcome === "ok" ? (
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" />
                ) : (
                  <X
                    className="mt-0.5 h-3 w-3 shrink-0 text-danger"
                    aria-label={t("peko.setup.stepFailed")}
                  />
                )}
                <span className="min-w-0 break-words">{call.line}</span>
              </li>
            ))}
          </ol>
        ))}

      {failure && <p className="mt-2 text-danger">{failure}</p>}

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

/**
 * Whether a peko's first turn can't go on by itself: nothing runs it, and
 * its model isn't on this computer or its last try failed. It used to sit
 * at "setting itself up… Nothing yet" for good (2026-11-28: a peko set to a
 * model that was since removed).
 */
export function firstTurnStuck(status: SetupStatus): boolean {
  return (
    status.settingUp &&
    !status.running &&
    (status.missingModel != null || !!status.firstTurnError)
  );
}

/** A first turn that can't go on: why, and the fix (a model, or another try). */
function StuckFirstTurn({
  name,
  runtimeId,
  status,
}: {
  name: string;
  runtimeId?: RuntimeId;
  status: SetupStatus;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useRunSetup();
  const update = usePrincipalUpdate();
  const { data: models } = useModels();
  const usable = (models ?? []).filter((m) => m.enabled);
  const [picked, setPicked] = useState("");
  const choice = picked || usable[0]?.id || "";
  const missing = status.missingModel;

  function applyModel() {
    if (!choice) return;
    update.mutate(
      { name, preferredModelId: choice, runtimeId },
      // The engine runs the first turn again with it.
      { onSettled: () => void qc.invalidateQueries({ queryKey: ["setupStatus"] }) },
    );
  }

  const reason =
    missing == null
      ? t("peko.setup.failed", { error: status.firstTurnError })
      : missing === ""
        ? t("peko.setup.noModel", { name })
        : t("peko.setup.modelGone", { name, model: missing });
  const failure = errorText(update.error) ?? errorText(run.error);

  return (
    <section
      className="mx-4 mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-xs"
      data-testid="setup-stuck"
      aria-live="polite"
    >
      <h2 className="flex items-center gap-1.5 font-medium text-fg">
        <AlertTriangle className="h-3.5 w-3.5 text-warn" />
        {missing == null
          ? t("peko.setup.stuckTitle", { name })
          : t("peko.setup.needsModelTitle", { name })}
      </h2>
      <p className="mt-1 break-words text-fg-soft" data-testid="setup-stuck-reason">
        {reason}
      </p>
      {missing == null ? (
        <button
          type="button"
          className="btn-secondary mt-2 inline-flex items-center gap-1"
          disabled={run.isPending}
          onClick={() => run.mutate({ name, runtimeId })}
          data-testid="setup-first-turn-retry"
        >
          <RotateCw className="h-3 w-3" />
          {run.isPending ? t("peko.setup.starting") : t("peko.setup.tryAgain")}
        </button>
      ) : usable.length === 0 ? (
        <p className="mt-2 text-fg-muted">{t("peko.setup.noModels")}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="select max-w-full"
            value={choice}
            onChange={(e) => setPicked(e.target.value)}
            aria-label={t("peko.setup.pickModel")}
            data-testid="setup-model"
          >
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName || m.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={!choice || update.isPending}
            onClick={applyModel}
            data-testid="setup-use-model"
          >
            {update.isPending ? t("peko.setup.starting") : t("peko.setup.useModel")}
          </button>
        </div>
      )}
      {failure && <p className="mt-2 text-danger">{failure}</p>}
    </section>
  );
}

/** One setup step: a mark for how it stands, the step, and the peko's note. */
function SetupStepRow({ step }: { step: SetupResult }) {
  const { t } = useTranslation();
  const ready = step.status === "ready";
  const failed = step.status === "failed";
  const label = ready
    ? t("peko.setup.stepReady")
    : failed
      ? t("peko.setup.stepFailed")
      : t("peko.setup.stepPending");
  return (
    <li className="flex items-start gap-2" data-testid="setup-result" data-status={step.status}>
      <span className="mt-0.5 shrink-0" role="img" aria-label={label} title={label}>
        {ready ? (
          <Check className="h-3.5 w-3.5 text-ok" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 text-danger" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-fg-subtle" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-fg">{step.step}</span>
        {step.note && (
          <span className={`block break-words ${failed ? "text-danger" : "text-fg-subtle"}`}>
            {step.note}
          </span>
        )}
      </span>
    </li>
  );
}
