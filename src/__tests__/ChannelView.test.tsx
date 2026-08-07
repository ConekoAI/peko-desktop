// src/__tests__/ChannelView.test.tsx
//
// PR-1 / feature/desktop-channels: read-only channel view. Validates:
//   • loading spinner while events are in-flight
//   • chronological event list (posted / created / member_joined / member_left)
//   • empty-state copy
//   • the stream invalidator subscription (PR-2 surface) is wired even
//     when the daemon-side `peko-stream` emit isn't present
//
// PR-3 adds the channel_members + principals mocks that the
// ChannelView now needs for the Invite / Leave action gating.
//
// The Tauri event API is stubbed so `useChannelStreamInvalidator` doesn't
// try to load the real `@tauri-apps/api/event` module under jsdom.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelEventsMock = vi.fn();
const channelEventsWatchMock = vi.fn();
const channelGetMock = vi.fn();
const channelMembersMock = vi.fn();
const channelLeaveMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelEvents: (...args: unknown[]) => channelEventsMock(...args),
  channelEventsWatch: (...args: unknown[]) => channelEventsWatchMock(...args),
  channelGet: (...args: unknown[]) => channelGetMock(...args),
  channelMembers: (...args: unknown[]) => channelMembersMock(...args),
  channelLeave: (...args: unknown[]) => channelLeaveMock(...args),
}));

// Stub the Tauri event API so the stream invalidator's `listen()` doesn't
// error under jsdom. The hook treats a thrown listen() as "no live path",
// falling back to refetchInterval polling (which we won't exercise here).
const listenMock = vi.fn().mockRejectedValue(new Error("no tauri in test"));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({
    channelId: "chan_alpha",
  }),
  useSearch: () => ({
    runtimeId: "local",
    sender: "alice",
  }),
  useNavigate: () => navigateMock,
}));

const usePrincipalsMock = vi.fn();
vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: (...args: unknown[]) => usePrincipalsMock(...args),
}));

import ChannelView from "../pages/ChannelView";

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelView />
    </QueryClientProvider>,
  );
}

const sampleEvents = [
  {
    kind: "created" as const,
    name: "alpha",
    creator: "alice",
    at: "2026-08-06T12:00:00Z",
  },
  {
    kind: "member_joined" as const,
    member: "bob",
    at: "2026-08-06T12:01:00Z",
  },
  {
    kind: "posted" as const,
    author: "alice",
    text: "first message",
    at: "2026-08-06T12:02:00Z",
  },
  {
    kind: "member_left" as const,
    member: "bob",
    at: "2026-08-06T12:05:00Z",
  },
];

describe("ChannelView", () => {
  beforeEach(() => {
    channelEventsMock.mockReset();
    channelEventsWatchMock.mockReset();
    channelEventsWatchMock.mockResolvedValue(undefined);
    channelGetMock.mockReset();
    channelMembersMock.mockReset();
    channelLeaveMock.mockReset();
    listenMock.mockClear();
    navigateMock.mockReset();
    usePrincipalsMock.mockReset();
    usePrincipalsMock.mockReturnValue({
      data: [{ name: "alice" }, { name: "bob" }],
    });
    channelGetMock.mockResolvedValue({
      channelId: "chan_alpha",
      runtimeId: "local",
      name: "alpha",
      creator: "alice",
      createdAt: "2026-08-06T12:00:00Z",
      memberCount: 2,
    });
    channelMembersMock.mockResolvedValue({
      channelId: "chan_alpha",
      runtimeId: "local",
      members: ["alice", "bob"],
    });
  });

  it("renders the loading spinner while events are in-flight", () => {
    channelEventsMock.mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getByText(/Loading events/)).toBeInTheDocument();
  });

  it("renders the chronological event list with each kind as a row", async () => {
    channelEventsMock.mockResolvedValue(sampleEvents);
    renderView();
    await waitFor(() => {
      expect(screen.getAllByTestId("channel-event-row")).toHaveLength(4);
    });
    // The "posted" event body surfaces in plain text.
    expect(screen.getByText("first message")).toBeInTheDocument();
  });

  it("shows the empty-state copy when the event log is empty", async () => {
    channelEventsMock.mockResolvedValue([]);
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/No events yet/)).toBeInTheDocument();
    });
  });

  // P1.10 polish: empty events state surfaces the channel name as
  // a "be the first to post" hint + a guest-viewer hint when the
  // local user isn't a member.
  it("empty events state surfaces the channel name + a 'be the first to post' hint", async () => {
    channelGetMock.mockResolvedValue({
      channelId: "chan_alpha",
      name: "design",
      creator: "prin_alice",
      createdAt: "2026-08-05T12:00:00Z",
      memberCount: 1,
      runtimeId: "local",
    });
    channelEventsMock.mockResolvedValue([]);
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId("channel-events-empty")).toBeInTheDocument();
    });
    const empty = screen.getByTestId("channel-events-empty");
    expect(empty).toHaveTextContent(/Be the first to post in/);
    expect(empty).toHaveTextContent(/design/);
  });

  it("wires the peko-stream invalidator even when the Tauri event API is absent", async () => {
    channelEventsMock.mockResolvedValue(sampleEvents);
    renderView();
    // The listen() rejection is swallowed; the hook falls back to polling.
    // We just verify the hook attempted to subscribe at all.
    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith(
        "peko-stream",
        expect.any(Function),
      );
    });
  });

  it("renders Invite + Leave action buttons in the header for current members", async () => {
    channelEventsMock.mockResolvedValue(sampleEvents);
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId("channel-invite-button")).toBeInTheDocument();
    });
    expect(screen.getByTestId("channel-leave-button")).toBeInTheDocument();
  });

  it("hides Invite + Leave when the local user is not a member", async () => {
    usePrincipalsMock.mockReturnValue({ data: [{ name: "carol" }] });
    channelEventsMock.mockResolvedValue(sampleEvents);
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId("channel-toggle-members")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("channel-invite-button")).toBeNull();
    expect(screen.queryByTestId("channel-leave-button")).toBeNull();
  });

  it("renders an error banner with a Retry button when channelEvents IPC fails", async () => {
    channelEventsMock.mockRejectedValue(
      new Error("IPC: channel_events connection refused"),
    );
    renderView();
    // Audit fix (P1.4): pre-fix the page silently showed the
    // empty-state when the fetch rejected. With the error UI the
    // user sees what failed and can retry.
    await waitFor(() => {
      expect(screen.getByTestId("channel-events-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("channel-events-retry")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load channel events/)).toBeInTheDocument();
    expect(
      screen.getByText(/channel_events connection refused/),
    ).toBeInTheDocument();
    // The retry button re-fires the IPC.
    channelEventsMock.mockResolvedValue(sampleEvents);
    fireEvent.click(screen.getByTestId("channel-events-retry"));
    await waitFor(() => {
      expect(screen.getAllByTestId("channel-event-row")).toHaveLength(4);
    });
  });
});