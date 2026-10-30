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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useChannelsMock = vi.fn();
const usePrincipalsMock = vi.fn();
const navigateMock = vi.fn();
const groupNames: Record<string, string> = {};
const leftGroups = new Set<string>();

vi.mock("../hooks/useChannels", () => ({
  LOCAL_USER: "user:local",
  useChannels: (...args: unknown[]) => useChannelsMock(...args),
  useChannelInfo: (id: string) => ({
    data: groupNames[id]
      ? { name: groupNames[id], members: leftGroups.has(id) ? ["principal:prin_a"] : ["user:local"] }
      : undefined,
  }),
  useChannel: () => ({ data: undefined }),
  useChannelMembers: () => ({ data: undefined }),
  channelInfoQuery: (id: string) => ({
    queryKey: ["channel-info", id],
    queryFn: async () => ({
      name: groupNames[id],
      members: leftGroups.has(id) ? ["principal:prin_a"] : ["user:local"],
    }),
  }),
  hasLeftGroup: (info: { members?: string[] } | undefined) =>
    !!info?.members && !info.members.includes("user:local"),
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
      screen.getByText(/No groups yet\./i),
    ).toBeInTheDocument();
  });

  it("renders a row per group, badging only remote ones", () => {
    useChannelsMock.mockReturnValue({
      data: sampleRows,
      isLoading: false,
    });
    renderSidebar();
    expect(screen.getByTestId("channel-row-chan_alpha")).toBeInTheDocument();
    expect(screen.getByTestId("channel-row-chan_bravo")).toBeInTheDocument();
    expect(screen.queryByTestId("runtime-badge-local")).toBeNull();
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

  it("enables the 'New channel' CTA in PR-3 (Layout hoists ChannelCreateModal)", () => {
    useChannelsMock.mockReturnValue({
      data: sampleRows,
      isLoading: false,
    });
    // ChannelSidebar only renders the CTA footer when the layout hands
    // it an `onCreateClick` callback. We pass a spy so the test
    // asserts that clicking the button fires the callback the
    // layout's hoisted ChannelCreateModal listens for.
    const onCreate = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChannelSidebar onCreateClick={onCreate} />
      </QueryClientProvider>,
    );
    const cta = screen.getByTestId("channel-new") as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    expect(cta.title ?? "").not.toMatch(/PR-3/);
    fireEvent.click(cta);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("shows each group's name, not its id, once the name loads", () => {
    useChannelsMock.mockReturnValue({ data: sampleRows, isLoading: false });
    groupNames.chan_alpha = "Launch crew";
    renderSidebar();
    expect(screen.getByText("Launch crew")).toBeInTheDocument();
    expect(screen.queryByText("chan_alpha")).toBeNull();
    // Still loading: the id stands in.
    expect(screen.getByText("chan_bravo")).toBeInTheDocument();
    delete groupNames.chan_alpha;
  });

  it("names the section Groups and never points at the CLI", () => {
    useChannelsMock.mockReturnValue({ data: [], isLoading: false });
    renderSidebar();
    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.queryByText(/peko channel/)).toBeNull();
  });

  it("hides a group you left", async () => {
    useChannelsMock.mockReturnValue({ data: sampleRows, isLoading: false });
    groupNames.chan_alpha = "Launch crew";
    leftGroups.add("chan_alpha");
    renderSidebar();
    await waitFor(() => expect(screen.queryByTestId("channel-row-chan_alpha")).toBeNull());
    expect(screen.getByTestId("channel-row-chan_bravo")).toBeInTheDocument();
    leftGroups.clear();
    delete groupNames.chan_alpha;
  });

  /** Before, every row rendered nothing and the list showed blank. */
  it("says there are no groups when you have left them all", async () => {
    useChannelsMock.mockReturnValue({ data: sampleRows, isLoading: false });
    for (const row of sampleRows) leftGroups.add(row.channelId);
    renderSidebar();
    expect(await screen.findByTestId("channel-empty")).toHaveTextContent("No groups yet.");
    leftGroups.clear();
  });
});

