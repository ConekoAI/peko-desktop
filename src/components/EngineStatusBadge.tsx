import type { EngineState } from "../types";
import {
  engineStateTone,
  engineStateLabel,
  engineStateSubtitle,
  type EngineTone,
} from "../lib/engine-helpers";

/**
 * Header badge for the engine lifecycle. Reads the tone off the
 * latest EngineState and switches colour/copy accordingly:
 *
 * - `running`    → green  / "Running"
 * - `starting`   → amber  / "Starting"
 * - `restarting` → amber  / "Restarting…" / "Restarting (n)…"
 * - `stopped`    → red    / "Stopped"
 * - `failed`     → red    / "Failed"
 *
 * `suppressSubtitle` keeps the badge compact for the header; the
 * status bar (which has more vertical space) sets it to `false` to
 * render the version/PID subtitle.
 */
export default function EngineStatusBadge({
  state,
  suppressSubtitle = true,
}: {
  state: EngineState | undefined;
  suppressSubtitle?: boolean;
}) {
  const tone: EngineTone = engineStateTone(state);
  const label = engineStateLabel(state);
  const subtitle = suppressSubtitle ? null : engineStateSubtitle(state);

  return (
    <div className="flex flex-col items-end leading-tight">
      <span
        data-testid="engine-status-badge"
        data-tone={tone}
        className={[
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
          tone === "ok"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
            : tone === "warn"
              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
              : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={[
            "h-1.5 w-1.5 rounded-full",
            tone === "ok"
              ? "bg-emerald-500"
              : tone === "warn"
                ? "bg-amber-500"
                : "bg-red-500",
          ].join(" ")}
        />
        {label}
      </span>
      {subtitle && (
        <span
          data-testid="engine-status-subtitle"
          className="mt-0.5 text-[10px] font-normal text-slate-500 dark:text-slate-400"
        >
          {subtitle}
        </span>
      )}
    </div>
  );
}
