// src/__tests__/ChannelInviteModal.test.tsx
//
// PR-3 / feature/desktop-channels: render coverage for the invite
// picker. The picker is sectioned by local vs remote principals,
// filters out already-invited members, and derives the inviter
// from the runtime's required-inviter-is-member invariant.
//
// Mock pattern mirrors `ChannelSidebar.test.tsx`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useChannelInviteMock = vi.fn();
const usePrincipalsMock = vi.fn();
const useRemotePrincipalsMock = vi.fn();

vi.mock("../hooks/useChannels", () => ({
  useChannelInvite: (...args: unknown[]) => useChannelInviteMock(...args),
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: (...args: unknown[]) => usePrincipalsMock(...args),
}));

vi.mock("../hooks/useRemotePrincipals", () => ({
  useRemotePrincipals: (...args: unknown[]) => useRemotePrincipalsMock(...args),
}));

import ChannelInviteModal from "../components/modals/ChannelInviteModal";

const idleMut = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

function renderModal(
  props: Partial<React.ComponentProps<typeof ChannelInviteModal>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <ChannelInviteModal
          open={true}
          channel="chan_alpha"
          detail={{
            channelId: "chan_alpha",
            runtimeId: "local",
            name: "alpha",
            creator: "alice",
            createdAt: "2026-08-06T12:00:00Z",
            memberCount: 2,
          }}
          members={{
            channelId: "chan_alpha",
            runtimeId: "local",
            members: ["alice", "bob"],
          }}
          onClose={onClose}
          {...props}
        />
      </QueryClientProvider>,
    ),
    onClose,
  };
}

describe("ChannelInviteModal", () => {
  beforeEach(() => {
    useChannelInviteMock.mockReset();
    usePrincipalsMock.mockReset();
    useRemotePrincipalsMock.mockReset();
    usePrincipalsMock.mockReturnValue({
      data: [
        { name: "alice" },
        { name: "bob" },
        { name: "carol" },
      ],
    });
    useRemotePrincipalsMock.mockReturnValue({
      data: [
        { principalName: "dave", runtimeId: "peer-1", hubUrl: "https://peer1.example.com" },
      ],
    });
    useChannelInviteMock.mockReturnValue({ ...idleMut, mutate: vi.fn() });
  });

  it("renders nothing when closed", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChannelInviteModal
          open={false}
          channel="chan_alpha"
          detail={null}
          members={null}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("channel-invite-search")).toBeNull();
  });

  it("renders the search box + an inviteable principal per non-member", () => {
    renderModal();
    expect(screen.getByTestId("channel-invite-search")).toBeInTheDocument();
    expect(screen.getByTestId("channel-invite-candidates")).toBeInTheDocument();
    // alice + bob are already members; only carol is inviteable locally.
    expect(screen.getByTestId("channel-invite-row-carol")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-invite-row-alice")).toBeNull();
    expect(screen.queryByTestId("channel-invite-row-bob")).toBeNull();
  });

  it("includes remote principals with the @<runtime-id> DID form", () => {
    renderModal();
    expect(
      screen.getByTestId("channel-invite-row-dave@peer-1"),
    ).toBeInTheDocument();
  });

  it("filters the candidate list by the search query", () => {
    renderModal();
    const search = screen.getByTestId("channel-invite-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "car" } });
    expect(screen.getByTestId("channel-invite-row-carol")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-invite-row-dave@peer-1")).toBeNull();
  });

  it("calls mutate with the right inviter + invitee on submit", async () => {
    const mutateMock = vi.fn((_args, opts) => {
      opts.onSuccess?.();
    });
    useChannelInviteMock.mockReturnValue({
      ...idleMut,
      mutate: mutateMock,
    });
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId("channel-invite-row-carol"));
    fireEvent.click(screen.getByTestId("channel-invite-submit"));
    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    // creator (alice) is local + member → she's the inviter.
    expect(mutateMock).toHaveBeenCalledWith(
      { inviterName: "alice", inviteeName: "carol" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an amber hint when no local principal is a member", () => {
    usePrincipalsMock.mockReturnValue({ data: [{ name: "eve" }] });
    // Detail says creator is "alice" but the members list has no one
    // local — so the inviter-derivation falls back to "no one".
    renderModal({
      detail: {
        channelId: "chan_alpha",
        runtimeId: "local",
        name: "alpha",
        creator: "alice",
        createdAt: "2026-08-06T12:00:00Z",
        memberCount: 1,
      },
      members: {
        channelId: "chan_alpha",
        runtimeId: "local",
        members: ["alice"],
      },
    });
    expect(
      screen.getByText(/You need a local principal that.?s already a member/i),
    ).toBeInTheDocument();
  });

  it("surfaces mutation errors inline", () => {
    useChannelInviteMock.mockReturnValue({
      ...idleMut,
      isError: true,
      error: new Error("inviter not a member"),
    });
    renderModal();
    expect(screen.getByText(/inviter not a member/)).toBeInTheDocument();
  });
});