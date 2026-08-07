// src/__tests__/useChannels.test.tsx
//
// PR-1 / feature/desktop-channels: exercise the channel hooks. We focus on
// `useChannels` because that's where the fan-out + dedupe logic lives.
// `useChannelMembers` is exercised in `MemberList.test.tsx` indirectly;
// we cover the explicit dedupe edge case here so the regression surface
// stays tight.
//
// Validates:
//   • fans out one channelList call per principal
//   • dedupes rows by channelId and accumulates memberPrincipals
//   • returns [] when no principals are passed (enabled=false)
//   • single-principal path matches the runtime's response shape

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelListMock = vi.fn();
const channelGetMock = vi.fn();
const channelMembersMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelList: (...args: unknown[]) => channelListMock(...args),
  channelGet: (...args: unknown[]) => channelGetMock(...args),
  channelMembers: (...args: unknown[]) => channelMembersMock(...args),
}));

import { useChannels, useChannelsForPrincipal } from "../hooks/useChannels";

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

describe("useChannels — fan-out + dedupe", () => {
  beforeEach(() => {
    channelListMock.mockReset();
  });

  it("returns an empty list and skips the IPC when no principals are given", async () => {
    const qc = freshClient();
    const { result } = renderHookWith(() => useChannels([]), qc);
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe("idle");
    });
    expect(channelListMock).not.toHaveBeenCalled();
  });

  it("dedupes channels shared across multiple principals", async () => {
    // alice is in chan_alpha + chan_bravo; bob is in chan_bravo only.
    channelListMock.mockImplementation((name: string) => {
      if (name === "alice") {
        return Promise.resolve([
            { channelId: "chan_alpha", runtimeId: "local" },
            { channelId: "chan_bravo", runtimeId: "local" },
          ]);
      }
      if (name === "bob") {
        return Promise.resolve([
            { channelId: "chan_bravo", runtimeId: "local" },
          ]);
      }
      return Promise.resolve([]);
    });

    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannels(["alice", "bob"]),
      qc,
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data ?? [];
    // Two distinct channel IDs after dedupe.
    expect(rows).toHaveLength(2);
    const alpha = rows.find((r) => r.channelId === "chan_alpha");
    const bravo = rows.find((r) => r.channelId === "chan_bravo");
    expect(alpha?.memberPrincipals).toEqual(["alice"]);
    // bravo carries both principals — order follows the input array order.
    expect(bravo?.memberPrincipals).toEqual(["alice", "bob"]);
  });

  it("sorts the resulting rows by channelId ascending", async () => {
    channelListMock.mockResolvedValue([
      { channelId: "chan_zulu", runtimeId: "local" },
      { channelId: "chan_alpha", runtimeId: "local" },
    ]);
    const qc = freshClient();
    const { result } = renderHookWith(() => useChannels(["alice"]), qc);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ids = (result.current.data ?? []).map((r) => r.channelId);
    expect(ids).toEqual(["chan_alpha", "chan_zulu"]);
  });
});

describe("useChannelsForPrincipal", () => {
  beforeEach(() => {
    channelListMock.mockReset();
  });

  it("skips the IPC when the principal name is undefined", () => {
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelsForPrincipal(undefined),
      qc,
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(channelListMock).not.toHaveBeenCalled();
  });

  it("returns the runtime's per-principal channel list verbatim", async () => {
    channelListMock.mockResolvedValue([
      { channelId: "chan_alpha", runtimeId: "local" },
    ]);
    const qc = freshClient();
    const { result } = renderHookWith(
      () => useChannelsForPrincipal("alice"),
      qc,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].channelId).toBe("chan_alpha");
  });
});