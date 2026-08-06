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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelEventsMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelEvents: (...args: unknown[]) => channelEventsMock(...args),
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

    act(() => {
      capturedListener!({
        payload: { kind: "channel_event", channelId: "chan_alpha", runtimeId: "local" },
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
          kind: "channel_invite_received",
          channelId: "chan_alpha",
          runtimeId: "local",
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
          kind: "channel_event",
          channelId: "chan_other",
          runtimeId: "local",
        },
      });
    });
    expect(onInvite).not.toHaveBeenCalled();
  });
});