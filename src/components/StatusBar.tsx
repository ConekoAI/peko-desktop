import { useEngineStatus } from "../hooks/useEngine";
import {
  engineStateIsProblem,
  engineStateLabel,
  engineStateSubtitle,
  engineStateTone,
} from "../lib/engine-helpers";

/**
 * Status footer driven by the engine state (ADR-043). Replaces the
 * legacy DaemonStatus footer — the dashboard onUpdateEvent contract
 * is the same (a single inline tone + version), only the source of
 * truth changed.
 */
export default function StatusBar() {
  const { data: engine, isLoading } = useEngineStatus();

  const tone = isLoading ? "warn" : engineStateTone(engine);
  const subtitle = engineStateSubtitle(engine);

  // `problem` means we want to push a full-width error strip rather
  // than the inline tone. Right now only `Failed` qualifies; if we
  // extend EngineState later we can drive this off the same helper.
  if (engineStateIsProblem(engine)) {
    return (
      <footer className="flex h-7 items-center justify-between border-t border-red-200 bg-red-50 px-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          <span className="font-medium">
            {engineStateLabel(engine)}: {subtitle ?? "engine is in a failed state"}
          </span>
        </div>
        <span>v{engine && engine.kind === "running" ? engine.version : "—"}</span>
      </footer>
    );
  }

  return (
    <footer className="flex h-7 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <div className="flex items-center gap-2">
        <span
          data-testid="statusbar-tone"
          data-tone={tone}
          className={[
            "inline-block h-2 w-2 rounded-full",
            tone === "ok"
              ? "bg-emerald-500"
              : tone === "warn"
                ? isLoading
                  ? "animate-pulse bg-amber-400"
                  : "bg-amber-500"
                : "bg-red-500",
          ].join(" ")}
        />
        <span>
          {isLoading
            ? "Connecting…"
            : engineStateLabel(engine)}
          {subtitle && !isLoading && engine?.kind === "running"
            ? ` · ${subtitle}`
            : ""}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span>
          v{engine && engine.kind === "running" ? engine.version : "—"}
        </span>
        <span className="text-slate-300 dark:text-slate-700">|</span>
        <span>{isLoading ? "Connecting" : "Connected"}</span>
      </div>
    </footer>
  );
}
