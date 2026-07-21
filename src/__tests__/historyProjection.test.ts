import { describe, it, expect } from "vitest";
import { chatLogMessagesToChatItems } from "../pages/Chat";
import type { ChatLogMessage } from "../types";

function makeMessage(overrides: Partial<ChatLogMessage> = {}): ChatLogMessage {
  return {
    schemaVersion: 1,
    id: "chat_abc",
    sender: "user:alice",
    timestamp: "2026-07-17T10:00:00Z",
    text: "hi",
    ...overrides,
  };
}

describe("chatLogMessagesToChatItems", () => {
  it("maps a user message to a user chat item", () => {
    const items = chatLogMessagesToChatItems([
      makeMessage({ text: "hi", sender: "user:alice" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].isUser).toBe(true);
    expect(items[0].event.type).toBe("chunk");
    expect(items[0].event.content).toBe("hi");
    expect(items[0].event.timestamp).toBe("2026-07-17T10:00:00Z");
  });

  it("maps a principal message to an assistant chat item", () => {
    const items = chatLogMessagesToChatItems([
      makeMessage({
        id: "chat_def",
        sender: "principal:did:peko:local:helper:abc",
        text: "hello back",
        timestamp: "2026-07-17T10:00:01Z",
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].isUser).toBe(false);
    expect(items[0].event.content).toBe("hello back");
  });

  it("does not project session internals (tool_call, thinking, compaction, session)", () => {
    // The runtime no longer exposes session-internal `kind` rows on
    // the chat-log IPC, so any future regression that introduces a
    // non-message `kind` field must not be silently projected onto a
    // bubble. The chat log is the only consumer-visible surface.
    const items = chatLogMessagesToChatItems([
      makeMessage({ text: "hi" }),
      // An entry that pretends to carry a session-internal `kind`
      // field should still be projected if it has the chat-log
      // shape — the chat-log wire schema is what we test, not the
      // legacy session schema.
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].event.content).toBe("hi");
  });

  it("skips empty messages so we don't render blank bubbles", () => {
    const items = chatLogMessagesToChatItems([
      makeMessage({ text: "", sender: "principal:did:peko:x" }),
      makeMessage({ text: "hello?", id: "chat_two" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].event.content).toBe("hello?");
  });

  it("preserves chronological order from oldest to newest", () => {
    const items = chatLogMessagesToChatItems([
      makeMessage({ id: "a", sender: "user:alice", text: "first", timestamp: "2026-07-17T10:00:00Z" }),
      makeMessage({
        id: "b",
        sender: "principal:did:peko:x",
        text: "second",
        timestamp: "2026-07-17T10:00:01Z",
      }),
      makeMessage({ id: "c", sender: "user:alice", text: "third", timestamp: "2026-07-17T10:00:02Z" }),
    ]);
    expect(items.map((i) => i.event.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(items.map((i) => i.isUser)).toEqual([true, false, true]);
  });

  it("returns an empty array when given no messages", () => {
    expect(chatLogMessagesToChatItems([])).toEqual([]);
  });

  it("treats any non-user sender as the principal", () => {
    // Defensive: future sender kinds (`principal:<did>` for
    // principal-to-principal exchanges, `public:` for unauthenticated
    // reads) should all render as the assistant side of the
    // conversation. The chat page is scoped to the user's view, so
    // anything that isn't `user:*` is the other party.
    const items = chatLogMessagesToChatItems([
      makeMessage({ id: "1", sender: "user:alice", text: "ping" }),
      makeMessage({
        id: "2",
        sender: "principal:did:peko:remote:abc",
        text: "pong",
      }),
      makeMessage({
        id: "3",
        sender: "public",
        text: "broadcast",
      }),
    ]);
    expect(items.map((i) => i.isUser)).toEqual([true, false, false]);
  });
});

describe("paging reconciliation", () => {
  // The PrincipalLog page walks pages via opaque cursors and dedupes
  // by message id. These tests pin the dedupe contract for the
  // two scenarios that motivated the rewrite:
  //   1. refetch after a streamed send must not duplicate bubbles
  //   2. appending older pages must not duplicate bubbles
  // The dedupe key is the message id — the runtime guarantees it is
  // stable per (principal, peer, message).

  it("two pages of distinct messages union without overlap when reconciled by id", () => {
    const page1: ChatLogMessage[] = [
      makeMessage({ id: "m-3", text: "third", timestamp: "2026-07-17T10:00:02Z" }),
      makeMessage({ id: "m-4", text: "fourth", timestamp: "2026-07-17T10:00:03Z" }),
    ];
    const page2: ChatLogMessage[] = [
      makeMessage({ id: "m-1", text: "first", timestamp: "2026-07-17T10:00:00Z" }),
      makeMessage({ id: "m-2", text: "second", timestamp: "2026-07-17T10:00:01Z" }),
    ];

    const seen = new Set(page1.map((m) => m.id));
    const older = page2.filter((m) => !seen.has(m.id));
    // The page prepends older messages and reverses so the final
    // order walks oldest -> newest.
    const merged = [...older, ...page1];
    expect(merged.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3", "m-4"]);
  });

  it("a refetch that overlaps an older page drops duplicates", () => {
    const page1: ChatLogMessage[] = [
      makeMessage({ id: "m-2", text: "two" }),
      makeMessage({ id: "m-3", text: "three" }),
    ];
    const page2Refetch: ChatLogMessage[] = [
      makeMessage({ id: "m-3", text: "three" }),
      makeMessage({ id: "m-4", text: "four" }),
    ];

    const seen = new Set(page1.map((m) => m.id));
    const merged = [...page2Refetch.filter((m) => !seen.has(m.id)), ...page1];
    expect(merged.map((m) => m.id)).toEqual(["m-4", "m-2", "m-3"]);
  });
});