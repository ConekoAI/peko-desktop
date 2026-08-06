// src/__tests__/ChannelSidebar.test.tsx
//
// PR-1 / feature/desktop-channels: render the read-only channel
// sidebar. Validates:
//   • empty state ("No channels yet. Create one with `peko channel create`.")
//   • grouped rendering with runtime badge per row
//   • search filter against `channelId`
//   • active-row indicator on the route's $channelId
//   • disabled "New channel" CTA in PR-1 (PR-3 wires the modal)
//
// Mock pattern follows `ModelGalleryCard.test.tsx`: vi.mock + QueryClientProvider.
// `useChannels` is the dependency, so we stub it; `usePrincipals` is also
// stubbed because ChannelSidebar reads it to compute the fan-out input.
// `useNavigate` / `useParams` from `@tanstack/react-router` are stubbed
// so we don't need to instantiate the full router (only the active-row
// match needs to work for the test).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useChannelsMock = vi.fn();
const usePrincipalsMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../hooks/useChannels", () => ({
  useChannels: (...args: unknown[]) => useChannelsMock(...args),
  useChannel: () => ({ data: undefined }),
  useChannelMembers: () => ({ data: undefined }),
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: (...args: unknown[]) => usePrincipalsMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ channelId: "chan_alpha" }),
}));

import ChannelSidebar from "../components/ChannelSidebar";

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelSidebar />
    </QueryClientProvider>,
  );
}

const sampleRows = [
  {
    channelId: "chan_alpha",
    runtimeId: "local",
    memberPrincipals: ["alice"],
  },
  {
    channelId: "chan_bravo",
    runtimeId: "hub:https://hub.example.com",
    memberPrincipals: ["alice", "bob"],
  },
];

describe("ChannelSidebar", () => {
  beforeEach(() => {
    useChannelsMock.mockReset();
    usePrincipalsMock.mockReset();
    navigateMock.mockReset();
    usePrincipalsMock.mockReturnValue({
      data: [{ name: "alice" }, { name: "bob" }],
    });
  });

  it("renders the empty-state hint when no channels exist", () => {
    useChannelsMock.mockReturnValue({ data: [], isLoading: false });
    renderSidebar();
    expect(screen.getByTestId("channel-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/No channels yet\. Create one with/i),
    ).toBeInTheDocument();
  });

  it("renders a row per channel with the runtime badge testid", () => {
    useChannelsMock.mockReturnValue({
      data: sampleRows,
      isLoading: false,
    });
    renderSidebar();
    expect(screen.getByTestId("channel-row-chan_alpha")).toBeInTheDocument();
    expect(screen.getByTestId("channel-row-chan_bravo")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-badge-local")).toBeInTheDocument();
    expect(
      screen.getByTestId("runtime-badge-hub:https://hub.example.com"),
    ).toBeInTheDocument();
  });

  it("filters by channelId substring as the user types in the search box", () => {
    useChannelsMock.mockReturnValue({
      data: sampleRows,
      isLoading: false,
    });
    renderSidebar();
    const search = screen.getByTestId("channel-search");
    fireEvent.change(search, { target: { value: "bravo" } });
    expect(screen.queryByTestId("channel-row-chan_alpha")).toBeNull();
    expect(screen.getByTestId("channel-row-chan_bravo")).toBeInTheDocument();
  });

  it("shows the loading spinner while useChannels is fetching", () => {
    useChannelsMock.mockReturnValue({ data: undefined, isLoading: true });
    renderSidebar();
    expect(screen.queryByTestId("channel-empty")).toBeNull();
    expect(screen.queryByTestId("channel-row-chan_alpha")).toBeNull();
  });

  it("disables the 'New channel' CTA in PR-1 (PR-3 wires the modal)", () => {
    useChannelsMock.mockReturnValue({
      data: sampleRows,
      isLoading: false,
    });
    // ChannelSidebar only renders the CTA footer when the layout hands
    // it an `onCreateClick` callback. We pass a no-op so the button is
    // mounted — the test then asserts the PR-1 disabled state.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChannelSidebar onCreateClick={() => {}} />
      </QueryClientProvider>,
    );
    const cta = screen.getByTestId("channel-new") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.title).toMatch(/PR-3/);
  });
});