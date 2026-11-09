// src/__tests__/GroupRail.test.tsx
//
// Every group you are in is a tile in the app rail beside Chats. Covers:
//   • a tile per group, named once its info loads (the id until then)
//   • groups you left are hidden
//   • the "New group" tile calls the layout's create modal
//   • invitations from other computers, joined groups, join by link
//
// `useChannels` / `usePrincipals` are stubbed; the router is stubbed so
// only the active-tile match needs to work.

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

const groupInvitationsMock = vi.fn();
const personGroupsMock = vi.fn();
const groupInvitationAnswerMock = vi.fn();
const groupJoinMock = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  groupJoin: (link: string) => groupJoinMock(link),
  groupInvitations: () => groupInvitationsMock(),
  personGroups: () => personGroupsMock(),
  groupInvitationAnswer: (id: string, accept: boolean) => groupInvitationAnswerMock(id, accept),
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: (...args: unknown[]) => usePrincipalsMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ channelId: "chan_alpha" }),
}));

import GroupRail from "../components/rail/GroupRail";
import { groupMonogram } from "../lib/format";

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupRail />
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

describe("GroupRail", () => {
  beforeEach(() => {
    groupInvitationsMock.mockResolvedValue([]);
    personGroupsMock.mockResolvedValue([]);
    useChannelsMock.mockReset();
    usePrincipalsMock.mockReset();
    navigateMock.mockReset();
    usePrincipalsMock.mockReturnValue({
      data: [{ name: "alice" }, { name: "bob" }],
    });
  });

  it("shows no group tiles when there are none, but still offers Join", () => {
    useChannelsMock.mockReturnValue({ data: [], isLoading: false });
    renderSidebar();
    expect(screen.queryByTestId(/^channel-row-/)).toBeNull();
    expect(screen.getByTestId("group-join-open")).toBeInTheDocument();
  });

  it("stands for a group by up to two letters of its name", () => {
    expect(groupMonogram("launch-plan")).toBe("LP");
    expect(groupMonogram("Reading")).toBe("RE");
    expect(groupMonogram("book club 2")).toBe("BC");
    expect(groupMonogram("—")).toBe("#");
  });

  it("renders a tile per group", () => {
    useChannelsMock.mockReturnValue({
      data: sampleRows,
      isLoading: false,
    });
    renderSidebar();
    expect(screen.getByTestId("channel-row-chan_alpha")).toBeInTheDocument();
    expect(screen.getByTestId("channel-row-chan_bravo")).toBeInTheDocument();
  });

  it("shows the loading spinner while useChannels is fetching", () => {
    useChannelsMock.mockReturnValue({ data: undefined, isLoading: true });
    renderSidebar();
    expect(screen.getByTestId("group-rail-loading")).toBeInTheDocument();
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
        <GroupRail onCreateClick={onCreate} />
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
    expect(screen.getByTestId("channel-row-chan_alpha")).toHaveAccessibleName("Launch crew");
    expect(screen.getByTestId("channel-row-chan_alpha")).toHaveTextContent("LC");
    // Still loading: the id stands in.
    expect(screen.getByTestId("channel-row-chan_bravo")).toHaveAccessibleName("chan_bravo");
    delete groupNames.chan_alpha;
  });

  it("never points at the CLI", () => {
    useChannelsMock.mockReturnValue({ data: [], isLoading: false });
    renderSidebar();
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

  it("shows no tiles when you have left every group", async () => {
    useChannelsMock.mockReturnValue({ data: sampleRows, isLoading: false });
    for (const row of sampleRows) leftGroups.add(row.channelId);
    renderSidebar();
    await waitFor(() => expect(screen.queryByTestId(/^channel-row-/)).toBeNull());
    leftGroups.clear();
  });
});

// Runtime ADR-092 D2: invitations from groups on other computers, and the
// groups you joined, sit beside your pekos' groups.
describe("GroupRail — groups on other computers", () => {
  beforeEach(() => {
    useChannelsMock.mockReturnValue({ data: [], isLoading: false });
    usePrincipalsMock.mockReturnValue({ data: [] });
    groupInvitationAnswerMock.mockReset().mockResolvedValue(undefined);
  });

  it("offers Join and Decline for an invitation", async () => {
    groupInvitationsMock.mockResolvedValue([
      { channelId: "chan_book", name: "book club", inviter: "principal:hub:x", members: 3 },
    ]);
    personGroupsMock.mockResolvedValue([]);
    renderSidebar();
    fireEvent.click(await screen.findByTestId("invitation-tile-chan_book"));
    const card = await screen.findByTestId("invitation-chan_book");
    expect(card).toHaveTextContent("book club");
    expect(card).toHaveTextContent("3 members");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(groupInvitationAnswerMock).toHaveBeenCalledWith("chan_book", false));
    // Declining closes it; open it again to join.
    await waitFor(() => expect(screen.queryByTestId("invitation-chan_book")).toBeNull());
    fireEvent.click(screen.getByTestId("invitation-tile-chan_book"));
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    await waitFor(() => expect(groupInvitationAnswerMock).toHaveBeenCalledWith("chan_book", true));
  });

  it("lists a group you joined from another computer", async () => {
    groupInvitationsMock.mockResolvedValue([]);
    personGroupsMock.mockResolvedValue([{ channelId: "chan_book", name: "book club", home: "did:key:zH" }]);
    groupNames["chan_book"] = "book club";
    renderSidebar();
    expect(await screen.findByTestId("channel-row-chan_book")).toHaveAccessibleName("book club");
    expect(screen.queryByTestId("group-invitations")).toBeNull();
    fireEvent.click(screen.getByTestId("channel-row-chan_book"));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/channels/$channelId", params: { channelId: "chan_book" } }),
    );
  });

  // Runtime ADR-092 D5: joining by invite link or a public group's ID.
  it("joins a group by its invite link", async () => {
    groupInvitationsMock.mockResolvedValue([]);
    personGroupsMock.mockResolvedValue([]);
    groupJoinMock.mockReset().mockResolvedValue({ channelId: "chan_book", name: "book club" });
    renderSidebar();
    fireEvent.click(screen.getByTestId("group-join-open"));
    fireEvent.change(screen.getByTestId("group-join-input"), {
      target: { value: " https://pekohub.ai/g/123?invite=tok " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(groupJoinMock).toHaveBeenCalledWith("https://pekohub.ai/g/123?invite=tok"));
    expect(await screen.findByTestId("group-join-asked")).toHaveTextContent("book club");
  });

  // Found live: the group arrives a moment after the home lets you in;
  // the list picks it up then and opens it, with no navigating away.
  it("opens a joined group as soon as its home lets you in", async () => {
    groupInvitationsMock.mockResolvedValue([]);
    personGroupsMock.mockReset().mockResolvedValue([]);
    groupJoinMock.mockReset().mockResolvedValue({ channelId: "chan_book", name: "book club" });
    navigateMock.mockReset();
    renderSidebar();
    fireEvent.click(screen.getByTestId("group-join-open"));
    fireEvent.change(screen.getByTestId("group-join-input"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByTestId("group-join-asked")).toBeInTheDocument();
    personGroupsMock.mockResolvedValue([{ channelId: "chan_book", name: "book club", home: null }]);
    await waitFor(
      () =>
        expect(navigateMock).toHaveBeenCalledWith(
          expect.objectContaining({ to: "/channels/$channelId", params: { channelId: "chan_book" } }),
        ),
      { timeout: 4000 },
    );
    expect(screen.queryByTestId("group-join")).toBeNull();
  });

  it("says why a group can't be joined", async () => {
    groupInvitationsMock.mockResolvedValue([]);
    personGroupsMock.mockResolvedValue([]);
    groupJoinMock.mockReset().mockRejectedValue(new Error("No group 123 is open to you"));
    renderSidebar();
    fireEvent.click(screen.getByTestId("group-join-open"));
    fireEvent.change(screen.getByTestId("group-join-input"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("No group 123 is open to you")).toBeInTheDocument();
  });
});
