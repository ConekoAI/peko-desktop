// src/__tests__/useChannelMutations.test.tsx
//
// PR-3 / feature/desktop-channels: exercise the create / invite / leave
// mutation hooks. Mirrors the `useChannelPost.test.tsx` shape — we
// focus on the invalidation contract + the IPC arg shape. The
// surface-level UX tests for the modals live in
// `ChannelCreateModal.test.tsx` / `ChannelInviteModal.test.tsx` /
// `ChannelLeaveConfirmModal.test.tsx`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelCreateMock = vi.fn();
const channelInviteMock = vi.fn();
const channelLeaveMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelCreate: (...args: unknown[]) => channelCreateMock(...args),
  channelInvite: (...args: unknown[]) => channelInviteMock(...args),
  channelLeave: (...args: unknown[]) => channelLeaveMock(...args),
}));

import {
  useChannelCreate,
  useChannelInvite,
  useChannelLeave,
} from "../hooks/useChannels";

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

describe("useChannelCreate", () => {
  beforeEach(() => {
    channelCreateMock.mockReset();
  });

  it("calls channelCreate with the args and resolves with the new channel id", async () => {
    channelCreateMock.mockResolvedValue("chan_new1234");
    const qc = freshClient();
    const { result } = renderHookWith(() => useChannelCreate("local"), qc);
    let id: string | undefined;
    await act(async () => {
      id = await result.current.mutateAsync({
        creatorName: "alice",
        name: "team",
      });
    });
    expect(id).toBe("chan_new1234");
    expect(channelCreateMock).toHaveBeenCalledTimes(1);
    expect(channelCreateMock).toHaveBeenCalledWith("alice", "team", "local");
  });

  it("invalidates the channels list on success so the sidebar refetches", async () => {
    channelCreateMock.mockResolvedValue("chan_new1234");
    const qc = freshClient();
    qc.setQueryData(["channels", "local"], []);
    const { result } = renderHookWith(() => useChannelCreate("local"), qc);
    await act(async () => {
      await result.current.mutateAsync({ creatorName: "alice", name: "team" });
    });
    await waitFor(() => {
      const q = qc.getQueryCache().find({ queryKey: ["channels", "local"] });
      // Either refetched (fetchStatus !== idle) or cleared (data === undefined).
      expect(q?.state.fetchStatus !== "idle" || q?.state.data === undefined).toBe(
        true,
      );
    });
  });

  it("surfaces the runtime error message via mutation.error", async () => {
    channelCreateMock.mockRejectedValue(new Error("principal not loaded"));
    const qc = freshClient();
    const { result } = renderHookWith(() => useChannelCreate("local"), qc);
    await act(async () => {
      try {
        await result.current.mutateAsync({ creatorName: "alice", name: "team" });
      } catch {
        // expected
      }
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("principal not loaded");
  });
});

describe("useChannelInvite", () => {
  beforeEach(() => {
    channelInviteMock.mockReset();
  });

  it("calls channelInvite with channelId + inviter + invitee", async () => {
    channelInviteMock.mockResolvedValue({
      channelId: "chan_alpha",
      invitee: "prin_bob",
      runtimeId: "local",
    });
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelInvite("chan_alpha", "local"),
      qc,
    );
    let resp: { channelId: string; invitee: string } | undefined;
    await act(async () => {
      resp = await result.current.mutateAsync({
        inviterName: "alice",
        inviteeName: "bob",
      });
    });
    expect(resp).toEqual({
      channelId: "chan_alpha",
      invitee: "prin_bob",
      runtimeId: "local",
    });
    expect(channelInviteMock).toHaveBeenCalledWith(
      "chan_alpha",
      "alice",
      "bob",
      "local",
    );
  });

  it("invalidates channels + channel + members + events on success", async () => {
    channelInviteMock.mockResolvedValue({
      channelId: "chan_alpha",
      invitee: "prin_bob",
      runtimeId: "local",
    });
    const qc = freshClient();
    for (const key of [
      ["channels", "local"],
      ["channel", "local", "chan_alpha"],
      ["channel-members", "local", "chan_alpha"],
      ["channel-events", "local", "chan_alpha"],
    ]) {
      qc.setQueryData(key as unknown[], []);
    }
    const { result } = renderHookWith(
      () => useChannelInvite("chan_alpha", "local"),
      qc,
    );
    await act(async () => {
      await result.current.mutateAsync({
        inviterName: "alice",
        inviteeName: "bob",
      });
    });
    await waitFor(() => {
      for (const key of [
        ["channels", "local"],
        ["channel", "local", "chan_alpha"],
        ["channel-members", "local", "chan_alpha"],
        ["channel-events", "local", "chan_alpha"],
      ]) {
        const q = qc.getQueryCache().find({ queryKey: key });
        expect(q?.state.fetchStatus !== "idle" || q?.state.data === undefined).toBe(
          true,
        );
      }
    });
  });

  it("rejects early when channelId is missing so a stale route can't fire a phantom IPC", async () => {
    channelInviteMock.mockReset();
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelInvite(undefined, "local"),
      qc,
    );
    await act(async () => {
      try {
        await result.current.mutateAsync({
          inviterName: "alice",
          inviteeName: "bob",
        });
      } catch {
        // expected
      }
    });
    expect(channelInviteMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/channelId/);
  });
});

describe("useChannelLeave", () => {
  beforeEach(() => {
    channelLeaveMock.mockReset();
  });

  it("calls channelLeave with channelId + principal", async () => {
    channelLeaveMock.mockResolvedValue({
      channelId: "chan_alpha",
      principal: "prin_alice",
      runtimeId: "local",
    });
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelLeave("chan_alpha", "local"),
      qc,
    );
    let resp: { channelId: string; principal: string } | undefined;
    await act(async () => {
      resp = await result.current.mutateAsync({ principalName: "alice" });
    });
    expect(resp).toEqual({
      channelId: "chan_alpha",
      principal: "prin_alice",
      runtimeId: "local",
    });
    expect(channelLeaveMock).toHaveBeenCalledWith(
      "chan_alpha",
      "alice",
      "local",
    );
  });

  it("invalidates channels + channel + members + events on success", async () => {
    channelLeaveMock.mockResolvedValue({
      channelId: "chan_alpha",
      principal: "prin_alice",
      runtimeId: "local",
    });
    const qc = freshClient();
    for (const key of [
      ["channels", "local"],
      ["channel", "local", "chan_alpha"],
      ["channel-members", "local", "chan_alpha"],
      ["channel-events", "local", "chan_alpha"],
    ]) {
      qc.setQueryData(key as unknown[], []);
    }
    const { result } = renderHookWith(
      () => useChannelLeave("chan_alpha", "local"),
      qc,
    );
    await act(async () => {
      await result.current.mutateAsync({ principalName: "alice" });
    });
    await waitFor(() => {
      for (const key of [
        ["channels", "local"],
        ["channel", "local", "chan_alpha"],
        ["channel-members", "local", "chan_alpha"],
        ["channel-events", "local", "chan_alpha"],
      ]) {
        const q = qc.getQueryCache().find({ queryKey: key });
        expect(q?.state.fetchStatus !== "idle" || q?.state.data === undefined).toBe(
          true,
        );
      }
    });
  });

  it("rejects early when channelId is missing", async () => {
    channelLeaveMock.mockReset();
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelLeave(undefined, "local"),
      qc,
    );
    await act(async () => {
      try {
        await result.current.mutateAsync({ principalName: "alice" });
      } catch {
        // expected
      }
    });
    expect(channelLeaveMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/channelId/);
  });
});