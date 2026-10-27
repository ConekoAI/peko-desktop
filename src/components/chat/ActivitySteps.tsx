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
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
        <div className="mt-1 space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-800">
          {activity.thinking && (
            <div>
              <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <Brain className="h-3 w-3" /> Thinking
              </p>
              <p className="mt-0.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs italic text-slate-500 dark:text-slate-400">
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
      <p className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
        {step.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
        ) : step.status === "done" ? (
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <X className="h-3 w-3 text-red-600 dark:text-red-400" />
        )}
        <span className="font-medium">{step.name}</span>
        {step.durationMs !== null && (
          <span className="text-slate-400 dark:text-slate-500">{formatDuration(step.durationMs)}</span>
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
      <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5 font-mono text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-400">
        {text}
      </pre>
    </div>
  );
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
