import { useEngineStatus } from "../hooks/useEngine";
import {
  engineStateLabel,
  engineStateSubtitle,
} from "../lib/engine-helpers";

/**
 * Status footer driven by the engine state (ADR-043). With engine
 * adoption in place the only state worth surfacing in the chrome is
 * `Failed` — on every other state the user has nothing to do, so
 * the bar is hidden. The Layout mounts this only when the engine
 * is in `Failed`, but we double-check here too in case the
 * component is mounted directly.
 */
export default function StatusBar() {
  const { data: engine } = useEngineStatus();

  if (engine?.kind !== "failed") {
    return null;
  }

  const subtitle = engineStateSubtitle(engine);

  return (
    <footer className="flex h-7 items-center justify-between border-t border-red-200 bg-red-50 px-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <span className="font-medium">
          {engineStateLabel(engine)}: {subtitle ?? "engine is in a failed state"}
        </span>
      </div>
      <span>v—</span>
    </footer>
  );
}