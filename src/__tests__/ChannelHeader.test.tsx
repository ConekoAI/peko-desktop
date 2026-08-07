// src/__tests__/ChannelHeader.test.tsx
//
// P1.10 polish: render coverage for the "View only" chip on the
// channel header when the viewer isn't a member. Also pins the
// member / invite button visibility rules.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useChannelMock = vi.fn();

vi.mock("../hooks/useChannels", () => ({
  useChannel: (...args: unknown[]) => useChannelMock(...args),
}));

import ChannelHeader from "../components/ChannelHeader";

function renderHeader(
  props: Partial<React.ComponentProps<typeof ChannelHeader>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelHeader channelId="chan_alpha" onInviteClick={() => {}} onLeaveClick={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

const detail = {
  channelId: "chan_alpha",
  name: "design",
  creator: "prin_alice",
  createdAt: "2026-08-05T12:00:00Z",
  memberCount: 3,
  runtimeId: "local",
};

describe("ChannelHeader", () => {
  beforeEach(() => {
    useChannelMock.mockReset();
  });

  it("renders the channel name + creator line when detail is loaded", () => {
    useChannelMock.mockReturnValue({ data: detail });
    renderHeader();
    expect(screen.getByRole("heading", { name: /design/ })).toBeInTheDocument();
    expect(screen.getByText(/prin_alice/)).toBeInTheDocument();
  });

  it("shows the View only chip when isMember === false (P1.10)", () => {
    useChannelMock.mockReturnValue({ data: detail });
    renderHeader({ isMember: false });
    expect(screen.getByTestId("channel-guest-chip")).toBeInTheDocument();
    expect(screen.getByTestId("channel-guest-chip")).toHaveTextContent(/View only/);
  });

  it("hides the View only chip when isMember === true", () => {
    useChannelMock.mockReturnValue({ data: detail });
    renderHeader({ isMember: true });
    expect(screen.queryByTestId("channel-guest-chip")).toBeNull();
  });

  it("hides Invite / Leave buttons when isMember === false", () => {
    useChannelMock.mockReturnValue({ data: detail });
    renderHeader({ isMember: false });
    expect(screen.queryByTestId("channel-invite-button")).toBeNull();
    expect(screen.queryByTestId("channel-leave-button")).toBeNull();
  });

  it("shows Invite / Leave buttons when isMember === true", () => {
    useChannelMock.mockReturnValue({ data: detail });
    renderHeader({ isMember: true });
    expect(screen.getByTestId("channel-invite-button")).toBeInTheDocument();
    expect(screen.getByTestId("channel-leave-button")).toBeInTheDocument();
  });

  it("falls back to the bare channelId row when detail is still loading", () => {
    useChannelMock.mockReturnValue({ data: undefined });
    renderHeader();
    expect(screen.getByText(/chan_alpha/)).toBeInTheDocument();
  });
});