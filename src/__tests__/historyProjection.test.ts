import { describe, it, expect } from "vitest";
import { historyEventsToChatItems } from "../pages/Chat";
import type { HistoryEvent } from "../types";

describe("historyEventsToChatItems", () => {
  it("maps user message events to user chat items", () => {
    const events: HistoryEvent[] = [
      {
        kind: "message",
        role: "user",
        content: "hi",
        timestamp: "2026-07-17T10:00:00Z",
      },
    ];
    const items = historyEventsToChatItems(events);
    expect(items).toHaveLength(1);
    expect(items[0].isUser).toBe(true);
    expect(items[0].event.type).toBe("chunk");
    expect(items[0].event.content).toBe("hi");
    expect(items[0].event.timestamp).toBe("2026-07-17T10:00:00Z");
  });

  it("maps assistant message events to assistant chat items", () => {
    const events: HistoryEvent[] = [
      {
        kind: "message",
        role: "assistant",
        content: "hello back",
        timestamp: "2026-07-17T10:00:01Z",
      },
    ];
    const items = historyEventsToChatItems(events);
    expect(items).toHaveLength(1);
    expect(items[0].isUser).toBe(false);
    expect(items[0].event.content).toBe("hello back");
  });

  it("filters out non-message events", () => {
    const events: HistoryEvent[] = [
      { kind: "session", sessionId: "abc", startedAt: "2026-07-17T10:00:00Z" },
      {
        kind: "message",
        role: "user",
        content: "hi",
        timestamp: "2026-07-17T10:00:00.500Z",
      },
      {
        kind: "tool_call",
        toolName: "Read",
        args: "{}",
        toolCallId: "tc1",
        timestamp: "2026-07-17T10:00:01Z",
      },
      { kind: "compaction", timestamp: "2026-07-17T10:00:02Z" },
      { kind: "thinking", content: "hmm", timestamp: "2026-07-17T10:00:03Z" },
    ];
    const items = historyEventsToChatItems(events);
    expect(items).toHaveLength(1);
    expect(items[0].event.content).toBe("hi");
  });

  it("skips empty messages so we don't render blank bubbles", () => {
    const events: HistoryEvent[] = [
      {
        kind: "message",
        role: "assistant",
        content: "",
        timestamp: "2026-07-17T10:00:00Z",
      },
      {
        kind: "message",
        role: "user",
        content: "hello?",
        timestamp: "2026-07-17T10:00:01Z",
      },
    ];
    const items = historyEventsToChatItems(events);
    expect(items).toHaveLength(1);
    expect(items[0].event.content).toBe("hello?");
  });

  it("preserves chronological order", () => {
    const events: HistoryEvent[] = [
      {
        kind: "message",
        role: "user",
        content: "first",
        timestamp: "2026-07-17T10:00:00Z",
      },
      {
        kind: "message",
        role: "assistant",
        content: "second",
        timestamp: "2026-07-17T10:00:01Z",
      },
      {
        kind: "message",
        role: "user",
        content: "third",
        timestamp: "2026-07-17T10:00:02Z",
      },
    ];
    const items = historyEventsToChatItems(events);
    expect(items.map((i) => i.event.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(items.map((i) => i.isUser)).toEqual([true, false, true]);
  });

  it("returns an empty array when given no events", () => {
    expect(historyEventsToChatItems([])).toEqual([]);
  });
});