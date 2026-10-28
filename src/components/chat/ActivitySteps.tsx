import { useState } from "react";
import { Brain, Check, ChevronRight, Loader2, Wrench, X } from "lucide-react";

import { activitySummary, isEmptyActivity, type Activity, type ToolStep } from "./activity";

/**
 * What a peko did while producing a reply — its thinking and tool
 * calls — as one collapsible row between the user's message and the
 * reply. While the reply streams, the row names the running step; after
 * it, a summary ("Used 2 tools · Thought"). Expanding shows the thinking
 * and each call with its input and output, which the runtime sends to
 * the peko's owner only (others see names and status).
 */
export default function ActivitySteps({
  activity,
  live,
}: {
  activity: Activity;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (isEmptyActivity(activity)) return null;
  const busy = live && activity.steps.some((s) => s.status === "running");

  return (
    <div className="px-4 py-1 pl-15" data-testid="activity-steps">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg-soft"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : activity.steps.length > 0 ? (
          <Wrench className="h-3.5 w-3.5" />
        ) : (
          <Brain className="h-3.5 w-3.5" />
        )}
        <span>{activitySummary(activity, live)}</span>
      </button>

      {open && (
        <div className="mt-1 space-y-2 border-l-2 border-line pl-3">
          {activity.thinking && (
            <div>
              <p className="flex items-center gap-1 text-[11px] font-medium text-fg-muted">
                <Brain className="h-3 w-3" /> Thinking
              </p>
              <p className="mt-0.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs italic text-fg-muted">
                {activity.thinking}
              </p>
            </div>
          )}
          {activity.steps.map((step) => (
            <StepRow key={step.toolId} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: ToolStep }) {
  return (
    <div className="text-xs" data-testid={`activity-step-${step.toolId}`}>
      <p className="flex items-center gap-1.5 text-fg-soft">
        {step.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
        ) : step.status === "done" ? (
          <Check className="h-3 w-3 text-brand" />
        ) : (
          <X className="h-3 w-3 text-danger" />
        )}
        <span className="font-medium">{step.name}</span>
        {step.durationMs !== null && (
          <span className="text-fg-subtle">{formatDuration(step.durationMs)}</span>
        )}
      </p>
      {step.input && <Snippet label="Input" text={step.input} />}
      {step.output && <Snippet label="Output" text={step.output} />}
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-1 ml-4">
      <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-raised p-1.5 font-mono text-[11px] text-fg-muted">
        {text}
      </pre>
    </div>
  );
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
