import type { EngineState } from "../types";
import { t } from "../i18n";

/**
 * Headline badge tone for a given engine state.
 *
 * - "ok"      → green dot, "Running" copy
 * - "warn"    → amber dot, "Starting" / "Restarting" copy
 * - "error"   → red dot, "Stopped" / "Failed" copy
 *
 * Picked deliberately as a 3-state enum rather than per-state
 * colours so the badge stays visually consistent across the header
 * and the status footer.
 */
export type EngineTone = "ok" | "warn" | "error";

export function engineStateTone(state: EngineState | undefined): EngineTone {
  if (!state) return "warn";
  switch (state.kind) {
    case "running":
      return "ok";
    case "starting":
    case "restarting":
      return "warn";
    case "stopped":
    case "failed":
      return "error";
  }
}

/**
 * Short label used in the header badge and status-bar footer.
 * Drives off the same tone mapping so the visual states stay in
 * lockstep with the text.
 */
export function engineStateLabel(state: EngineState | undefined): string {
  if (!state) return t("engine.state.connecting");
  switch (state.kind) {
    case "running":
      return t("engine.state.running");
    case "starting":
      return t("engine.state.starting");
    case "restarting":
      // The supervisor caps at attempt 1, but future-proof the copy
      // against a higher cap. "Restarting…" alone is fine when the
      // count is 1.
      return state.attempt > 1
        ? t("engine.state.restartingAttempt", { attempt: state.attempt })
        : t("engine.state.restarting");
    case "stopped":
      return t("engine.state.stopped");
    case "failed":
      return t("engine.state.failed");
  }
}

/**
 * Long subtitle rendered under the badge / in the status footer.
 * Pulls the version / PID out of the Running variant; for non-Running
 * states returns null so callers can hide the subtitle entirely.
 */
export function engineStateSubtitle(state: EngineState | undefined): string | null {
  if (!state) return null;
  switch (state.kind) {
    case "running":
      return t("engine.subtitle.running", { version: state.version, pid: state.pid });
    case "starting":
      return t("engine.subtitle.starting");
    case "restarting":
      return t("engine.subtitle.restarting");
    case "stopped":
      return t("engine.subtitle.stopped");
    case "failed":
      return state.message;
  }
}

/**
 * True when the state represents a problem the user should be made
 * aware of (failed) or is in a transient mid-cycle (restarting). The
 * status bar uses this to decide whether to show a full-width error
 * strip vs. an inline tone.
 */
export function engineStateIsProblem(state: EngineState | undefined): boolean {
  if (!state) return false;
  return state.kind === "failed";
}
