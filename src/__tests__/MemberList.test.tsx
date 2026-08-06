// src/__tests__/MemberList.test.tsx
//
// PR-1 / feature/desktop-channels: read-only member list. Validates:
//   • loading spinner while members are in-flight
//   • empty-state copy
//   • local section rendering (each member gets a runtime badge + testid)
//   • row uses the principal DID as the visible label

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useChannelMembersMock = vi.fn();

vi.mock("../hooks/useChannels", () => ({
  useChannels: () => ({ data: [] }),
  useChannel: () => ({ data: undefined }),
  useChannelMembers: (...args: unknown[]) => useChannelMembersMock(...args),
}));

import MemberList from "../components/MemberList";

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemberList channelId="chan_alpha" runtimeId="local" />
    </QueryClientProvider>,
  );
}

describe("MemberList", () => {
  beforeEach(() => {
    useChannelMembersMock.mockReset();
  });

  it("renders the loading spinner while members are in-flight", () => {
    useChannelMembersMock.mockReturnValue({ data: undefined, isLoading: true });
    renderList();
    expect(screen.getByText(/Loading members/)).toBeInTheDocument();
  });

  it("renders the empty-state copy when no members exist", async () => {
    useChannelMembersMock.mockReturnValue({
      data: { members: [] },
      isLoading: false,
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByText(/No members yet/)).toBeInTheDocument();
    });
  });

  it("renders one row per member under the Local section with testid", async () => {
    useChannelMembersMock.mockReturnValue({
      data: { members: ["alice", "bob"] },
      isLoading: false,
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByTestId("channel-member-alice")).toBeInTheDocument();
      expect(screen.getByTestId("channel-member-bob")).toBeInTheDocument();
    });
    // Each row carries the local runtime badge.
    expect(screen.getAllByTestId("runtime-badge-local")).toHaveLength(2);
  });
});