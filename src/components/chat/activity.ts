import type { ChatStreamMsg } from "../../lib/api";

/** One tool call in a reply's activity. */
export interface ToolStep {
  toolId: string;
  name: string;
  status: "running" | "done" | "failed";
  /** Short redacted summary of the arguments (owner only). */
  input: string | null;
  /** Short redacted excerpt of the result (owner only). */
  output: string | null;
  durationMs: number | null;
}

/** What a peko did while producing one reply: its thinking and tool calls. */
export interface Activity {
  thinking: string;
  steps: ToolStep[];
}

export const EMPTY_ACTIVITY: Activity = { thinking: "", steps: [] };

/**
 * Fold one stream event into the reply's activity. Events that are not
 * tool steps or thinking leave it unchanged (same object).
 */
export function applyActivity(activity: Activity, msg: ChatStreamMsg): Activity {
  switch (msg.kind) {
    case "thinking":
      return { ...activity, thinking: activity.thinking + msg.delta };
    case "toolStart":
      return {
        ...activity,
        steps: [
          ...activity.steps,
          {
            toolId: msg.toolId,
            name: msg.name,
            status: "running",
            input: msg.input ?? null,
            output: null,
            durationMs: null,
          },
        ],
      };
    case "toolEnd": {
      const ended: Partial<ToolStep> = {
        status: msg.success ? "done" : "failed",
        output: msg.output ?? null,
        durationMs: msg.durationMs,
      };
      const known = activity.steps.some((s) => s.toolId === msg.toolId);
      return {
        ...activity,
        steps: known
          ? activity.steps.map((s) => (s.toolId === msg.toolId ? { ...s, ...ended } : s))
          : [
              ...activity.steps,
              { toolId: msg.toolId, name: msg.name, input: null, ...ended } as ToolStep,
            ],
      };
    }
    default:
      return activity;
  }
}

export function isEmptyActivity(activity: Activity): boolean {
  return activity.thinking === "" && activity.steps.length === 0;
}

/** The one-line summary: what is running now, or what was done. */
export function activitySummary(activity: Activity, live: boolean): string {
  const running = activity.steps.filter((s) => s.status === "running");
  if (live && running.length > 0) {
    return running.length === 1
      ? `Running ${running[0].name}…`
      : `Running ${running.length} tools…`;
  }
  if (live && activity.steps.length === 0 && activity.thinking) return "Thinking…";
  const parts: string[] = [];
  const n = activity.steps.length;
  if (n > 0) parts.push(`Used ${n} ${n === 1 ? "tool" : "tools"}`);
  const failed = activity.steps.filter((s) => s.status === "failed").length;
  if (failed > 0) parts.push(`${failed} failed`);
  if (activity.thinking) parts.push("Thought");
  return parts.join(" · ");
}
