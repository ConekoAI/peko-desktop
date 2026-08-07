// src/__tests__/useChannelEvents.test.tsx
//
// PR-1 / feature/desktop-channels: exercise the read-only channel
// event hook + the peko-stream invalidator. PR-2 will light up the
// daemon-side emit; PR-1 ships the listener surface so the UI doesn't
// have to rewire later.
//
// Validates:
//   • useChannelEvents hits the IPC with the right (channelId, since, rid)
//   • useChannelStreamInvalidator subscribes to peko-stream and
//     invalidates the matching channel-events query when a
//     `channel_event` message arrives
//   • useChannelStreamInvalidator invokes the onInviteReceived
//     callback for `channel_invite_received` messages
//   • the hook cleans up the listener on unmount
//
// PR-2b extends the surface: `useChannelEventsWatch` kicks off the
// long-lived `channel_events_watch` IPC subscription so the runtime
// can forward live `peko-stream` events without polling. Validates:
//   • the IPC fires with the right args
//   • the IPC is skipped when channelId is empty
//   • an IPC rejection is swallowed via console.warn (not thrown)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelEventsMock = vi.fn();
const channelEventsWatchMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelEvents: (...args: unknown[]) => channelEventsMock(...args),
  channelEventsWatch: (...args: unknown[]) => channelEventsWatchMock(...args),
}));

// We capture the listener callback so individual tests can simulate
// peko-stream emits. The Tauri `listen` returns a Promise that resolves
// to an unlisten fn (we stub it as a vi.fn so the hook's cleanup works).
type Listener = (event: { payload: unknown }) => void;
let capturedListener: Listener | undefined;
let unlistenCalled = false;
const listenMock = vi.fn(async (_eventName: string, cb: Listener) => {
  capturedListener = cb;
  return () => {
    unlistenCalled = true;
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, cb: Listener) => listenMock(eventName, cb),
}));

import {
  useChannelEvents,
  useChannelEventsWatch,
  useChannelStreamInvalidator,
} from "../hooks/useChannelEvents";

function renderHookWith<T>(hook: () => T, qc: QueryClient) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

describe("useChannelEvents", () => {
  beforeEach(() => {
    channelEventsMock.mockReset();
    channelEventsWatchMock.mockReset();
    listenMock.mockClear();
    capturedListener = undefined;
    unlistenCalled = false;
  });

  it("hits channelEvents IPC with the correct args and returns the events", async () => {
    channelEventsMock.mockResolvedValue([
      {
        kind: "posted",
        author: "alice",
        text: "hi",
        at: "2026-08-06T12:00:00Z",
      },
    ]);
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelEvents("chan_alpha", null, "local"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(channelEventsMock).toHaveBeenCalledWith("chan_alpha", null, "local");
    expect(result.current.data?.[0].kind).toBe("posted");
  });

  it("does not fire the IPC when channelId is empty", () => {
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelEvents(undefined),
      qc,
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(channelEventsMock).not.toHaveBeenCalled();
  });
});

describe("useChannelStreamInvalidator", () => {
  beforeEach(() => {
    channelEventsMock.mockReset();
    channelEventsWatchMock.mockReset();
    listenMock.mockClear();
    capturedListener = undefined;
    unlistenCalled = false;
  });

  it("subscribes to peko-stream and invalidates channel-events on channel_event", async () => {
    channelEventsMock.mockResolvedValue([]);
    const qc = freshClient();
    // Seed the cache so we can detect invalidation.
    qc.setQueryData(["channel-events", "local", "chan_alpha"], []);
    expect(
      qc.getQueryData(["channel-events", "local", "chan_alpha"]),
    ).toBeDefined();

    renderHookWith(
      () => useChannelStreamInvalidator("chan_alpha", "local"),
      qc,
    );

    await waitFor(() => expect(capturedListener).toBeDefined());

    // Audit-fix wire shape: Rust `StreamEvent` now has
    // `#[serde(tag = "type", rename_all = "camelCase")]` so the
    // daemon emits `{type: "channel_event", channelId: "...", ...}`
    // (camelCase `channelId`, no outer `runtimeId`). Prior test
    // mocked `kind`/`channelId`/`runtimeId` which matched the hook
    // but never matched the actual emit — silent invalidator
    // failure in production.
    act(() => {
      capturedListener!({
        payload: {
          type: "channel_event",
          channelId: "chan_alpha",
          payload: { kind: "posted", author: "alice", text: "hi" },
          timestamp: "2026-08-06T12:00:00Z",
        },
      });
    });

    // React Query's invalidate is async; one tick is enough for the spy.
    await waitFor(() => {
      // The query refetches — easier to assert on fetchStatus.
      const q = qc.getQueryCache().find({
        queryKey: ["channel-events", "local", "chan_alpha"],
      });
      expect(q?.state.fetchStatus).not.toBe("idle");
    });
  });

  it("invokes onInviteReceived on a channel_invite_received message", async () => {
    const onInvite = vi.fn();
    const qc = freshClient();
    renderHookWith(
      () =>
        useChannelStreamInvalidator(
          "chan_alpha",
          "local",
          onInvite,
        ),
      qc,
    );
    await waitFor(() => expect(capturedListener).toBeDefined());
    act(() => {
      capturedListener!({
        payload: {
          type: "channel_event",
          channelId: "chan_alpha",
          // The runtime encodes the invite as a synthetic
          // ChannelEvent::Created + a follow-up Created variant;
          // the listener detects `payload.payload.kind ===
          // "channel_invite_received"` (the inner event's tag).
          payload: { kind: "channel_invite_received" },
          timestamp: "2026-08-06T12:00:00Z",
        },
      });
    });
    expect(onInvite).toHaveBeenCalledWith("chan_alpha");
  });

  it("unlistens on unmount", async () => {
    const qc = freshClient();
    const { unmount } = renderHookWith(
      () => useChannelStreamInvalidator("chan_alpha", "local"),
      qc,
    );
    await waitFor(() => expect(capturedListener).toBeDefined());
    unmount();
    expect(unlistenCalled).toBe(true);
  });

  it("ignores messages for a different channelId", async () => {
    const onInvite = vi.fn();
    const qc = freshClient();
    renderHookWith(
      () => useChannelStreamInvalidator("chan_alpha", "local", onInvite),
      qc,
    );
    await waitFor(() => expect(capturedListener).toBeDefined());
    act(() => {
      capturedListener!({
        payload: {
          type: "channel_event",
          channelId: "chan_other",
          payload: { kind: "posted" },
          timestamp: "2026-08-06T12:00:00Z",
        },
      });
    });
    expect(onInvite).not.toHaveBeenCalled();
  });
});

describe("useChannelEventsWatch", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    channelEventsMock.mockReset();
    channelEventsWatchMock.mockReset();
    listenMock.mockClear();
    capturedListener = undefined;
    unlistenCalled = false;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("calls channelEventsWatch IPC on mount with the correct args", async () => {
    channelEventsWatchMock.mockResolvedValue(undefined);
    const qc = freshClient();
    renderHookWith(
      () => useChannelEventsWatch("chan_alpha", null, "local"),
      qc,
    );
    await waitFor(() => expect(channelEventsWatchMock).toHaveBeenCalledTimes(1));
    // The hook forwards `since ?? undefined` so a null cursor becomes
    // `undefined` — matches the api.ts signature where `since?: string`.
    expect(channelEventsWatchMock).toHaveBeenCalledWith(
      "chan_alpha",
      undefined,
      "local",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("forwards a concrete since cursor to the IPC", async () => {
    channelEventsWatchMock.mockResolvedValue(undefined);
    const qc = freshClient();
    renderHookWith(
      () => useChannelEventsWatch("chan_alpha", "ckpt-42", "remote-east"),
      qc,
    );
    await waitFor(() => expect(channelEventsWatchMock).toHaveBeenCalledTimes(1));
    expect(channelEventsWatchMock).toHaveBeenCalledWith(
      "chan_alpha",
      "ckpt-42",
      "remote-east",
    );
  });

  it("does not call the IPC when channelId is empty", () => {
    const qc = freshClient();
    renderHookWith(() => useChannelEventsWatch(undefined), qc);
    // The hook returns immediately — no async task is even scheduled.
    expect(channelEventsWatchMock).not.toHaveBeenCalled();
  });

  it("swallows IPC rejections via console.warn instead of throwing", async () => {
    channelEventsWatchMock.mockRejectedValue(new Error("daemon gone"));
    const qc = freshClient();
    renderHookWith(
      () => useChannelEventsWatch("chan_alpha", null, "local"),
      qc,
    );
    await waitFor(() => expect(channelEventsWatchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        "[peko-desktop] channel_events_watch failed:",
        expect.any(Error),
      ),
    );
  });
});