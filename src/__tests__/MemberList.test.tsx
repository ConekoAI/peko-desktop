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

  // PR-3b / P1.2 attribution: when the IPC surfaces `memberProvenance`,
  // principals whose `runtimeId !== null` render under the Remote
  // section with a Globe icon + a per-runtime badge. Local rows keep
  // the Monitor icon + "local" badge. Pre-PR-3b runtimes omit the
  // field and fall back to the all-local rendering.
  it("splits local and remote members when memberProvenance is present", async () => {
    useChannelMembersMock.mockReturnValue({
      data: {
        members: ["alice", "bob", "carol"],
        memberProvenance: [
          { principal: "alice", runtimeId: null },
          { principal: "bob", runtimeId: "did:key:zRuntimeB" },
          { principal: "carol", runtimeId: "did:key:zRuntimeC" },
        ],
      },
      isLoading: false,
    });
    renderList();

    await waitFor(() => {
      expect(screen.getByTestId("channel-members-local")).toBeInTheDocument();
      expect(screen.getByTestId("channel-members-remote")).toBeInTheDocument();
    });

    // Local section: only the principal with runtimeId === null.
    const localSection = screen.getByTestId("channel-members-local");
    expect(localSection).toHaveTextContent("alice");
    expect(localSection).not.toHaveTextContent("bob");
    expect(localSection).not.toHaveTextContent("carol");

    // Remote section: every principal with a non-null runtimeId.
    const remoteSection = screen.getByTestId("channel-members-remote");
    expect(remoteSection).toHaveTextContent("bob");
    expect(remoteSection).toHaveTextContent("carol");
    expect(remoteSection).not.toHaveTextContent("alice");

    // Per-runtime badges present; the local badge appears once.
    expect(
      screen.getByTestId("runtime-badge-did:key:zRuntimeB"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("runtime-badge-did:key:zRuntimeC"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("runtime-badge-local")).toHaveLength(1);
  });

  // Back-compat: pre-PR-3b runtimes don't surface `memberProvenance`,
  // so the list still renders all members as local.
  it("falls back to all-local rendering when memberProvenance is missing", async () => {
    useChannelMembersMock.mockReturnValue({
      data: { members: ["alice", "bob"] },
      isLoading: false,
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByTestId("channel-members-local")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("channel-members-remote")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("runtime-badge-local")).toHaveLength(2);
  });
});