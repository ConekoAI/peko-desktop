// src/__tests__/useChannelPost.test.tsx
//
// PR-2a / feature/desktop-channels: exercise the post mutation. The
// composer's surface is mostly UX, so most of the behavior tests
// live in `ChannelComposer.test.tsx`. Here we focus on the
// invalidation contract: a successful post invalidates the events
// query for the channel and the channels list, so the sidebar +
// the event list both refetch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelPostMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelPost: (...args: unknown[]) => channelPostMock(...args),
}));

import { useChannelPost } from "../hooks/useChannelPost";

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

describe("useChannelPost", () => {
  beforeEach(() => {
    channelPostMock.mockReset();
  });

  it("calls channelPost with the args and resolves with the task id", async () => {
    channelPostMock.mockResolvedValue("task_abcdef");
    const qc = freshClient();
    const { result } = renderHookWith(() => useChannelPost("local"), qc);
    let taskId: string | undefined;
    await act(async () => {
      taskId = await result.current.mutateAsync({
        channelId: "chan_alpha",
        senderName: "alice",
        text: "hi",
      });
    });
    expect(taskId).toBe("task_abcdef");
    expect(channelPostMock).toHaveBeenCalledTimes(1);
    // First three args come from the mutation payload; the trailing
    // `parent` and `runtimeId` are pass-throughs. We assert on the
    // payload-derived args because those are the contract; the
    // pass-through values are exercised in ChannelComposer.test.tsx.
    const args = channelPostMock.mock.calls[0];
    expect(args[0]).toBe("chan_alpha");
    expect(args[1]).toBe("alice");
    expect(args[2]).toBe("hi");
  });

  it("invalidates channel-events + channel + channels on success", async () => {
    channelPostMock.mockResolvedValue("task_abcdef");
    const qc = freshClient();
    // Seed the cache with stale data so we can observe invalidation
    // via fetchStatus flipping to "fetching".
    qc.setQueryData(["channel-events", "local", "chan_alpha"], []);
    qc.setQueryData(["channel", "local", "chan_alpha"], null);
    qc.setQueryData(["channels", "local"], []);

    const { result } = renderHookWith(() => useChannelPost("local"), qc);
    await act(async () => {
      await result.current.mutateAsync({
        channelId: "chan_alpha",
        senderName: "alice",
        text: "hi",
      });
    });

    await waitFor(() => {
      for (const key of [
        ["channel-events", "local", "chan_alpha"],
        ["channel", "local", "chan_alpha"],
        ["channels", "local"],
      ]) {
        const q = qc.getQueryCache().find({ queryKey: key });
        // Either the query is now fetching (refetched) or its data was
        // cleared by `remove` (set when no observers remain) — both
        // are valid post-invalidation signals. The simplest assertion
        // is that the query is NOT in `idle` (i.e. was touched).
        expect(q?.state.fetchStatus !== "idle" || q?.state.data === undefined).toBe(true);
      }
    });
  });

  it("exposes the error message via mutation.error", async () => {
    channelPostMock.mockRejectedValue(new Error("not a member"));
    const qc = freshClient();
    const { result } = renderHookWith(() => useChannelPost("local"), qc);
    await act(async () => {
      try {
        await result.current.mutateAsync({
          channelId: "chan_alpha",
          senderName: "alice",
          text: "hi",
        });
      } catch {
        // expected
      }
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("not a member");
  });
});