// A reply's activity: thinking and tool calls folded from stream
// events, shown as one collapsible row.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ActivitySteps from "../components/chat/ActivitySteps";
import {
  activitySummary,
  applyActivity,
  EMPTY_ACTIVITY,
  type Activity,
} from "../components/chat/activity";
import type { ChatStreamMsg } from "../lib/api";

function fold(events: ChatStreamMsg[]): Activity {
  return events.reduce(applyActivity, EMPTY_ACTIVITY);
}

const start = (toolId: string, name: string, input: string | null = null): ChatStreamMsg => ({
  kind: "toolStart",
  toolId,
  name,
  input,
});
const end = (toolId: string, name: string, success: boolean, output: string | null = null): ChatStreamMsg => ({
  kind: "toolEnd",
  toolId,
  name,
  success,
  durationMs: 1500,
  output,
});

describe("applyActivity", () => {
  it("tracks tool calls from start to end and concatenates thinking", () => {
    const a = fold([
      { kind: "thinking", delta: "Let me " },
      { kind: "thinking", delta: "check." },
      start("c1", "Bash", '{"command":"date"}'),
      start("c2", "Read"),
      end("c1", "Bash", true, "Tue"),
      end("c2", "Read", false),
    ]);
    expect(a.thinking).toBe("Let me check.");
    expect(a.steps.map((s) => [s.name, s.status, s.output])).toEqual([
      ["Bash", "done", "Tue"],
      ["Read", "failed", null],
    ]);
    expect(a.steps[0].input).toBe('{"command":"date"}');
  });

  it("keeps an end whose start it never saw", () => {
    const a = fold([end("c9", "Grep", true)]);
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toMatchObject({ name: "Grep", status: "done", input: null });
  });

  it("ignores other stream events", () => {
    expect(applyActivity(EMPTY_ACTIVITY, { kind: "chunk", delta: "hi" })).toBe(EMPTY_ACTIVITY);
  });
});

describe("activitySummary", () => {
  it("names the running step while live, and summarizes after", () => {
    const running = fold([start("c1", "Bash")]);
    expect(activitySummary(running, true)).toBe("Running Bash…");
    expect(activitySummary(fold([{ kind: "thinking", delta: "hm" }]), true)).toBe("Thinking…");
    const finished = fold([
      { kind: "thinking", delta: "hm" },
      start("c1", "Bash"),
      end("c1", "Bash", true),
      start("c2", "Read"),
      end("c2", "Read", false),
    ]);
    expect(activitySummary(finished, false)).toBe("Used 2 tools · 1 failed · Thought");
  });
});

describe("ActivitySteps", () => {
  it("renders nothing without activity", () => {
    const { container } = render(<ActivitySteps activity={EMPTY_ACTIVITY} live={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("expands to the thinking and each call's input and output", () => {
    const activity = fold([
      { kind: "thinking", delta: "Checking the date." },
      start("c1", "Bash", '{"command":"date"}'),
      end("c1", "Bash", true, "Tue Oct 27"),
    ]);
    render(<ActivitySteps activity={activity} live={false} />);
    const toggle = screen.getByRole("button", { name: /used 1 tool/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Tue Oct 27")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText("Checking the date.")).toBeInTheDocument();
    expect(screen.getByText('{"command":"date"}')).toBeInTheDocument();
    expect(screen.getByText("Tue Oct 27")).toBeInTheDocument();
    expect(screen.getByText("1.5 s")).toBeInTheDocument();
  });
});
