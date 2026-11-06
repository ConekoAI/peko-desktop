// The chat list: pekos on this runtime and pekos reached through a hub
// sit in one list, look the same, and open their own profile; DMs with
// people and requests to message you sit above them (runtime ADR-095 D6).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const personDmsMock = vi.fn();
const dmRequestsMock = vi.fn();
const dmRequestAnswerMock = vi.fn();
const personDmOpenMock = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  personDms: () => personDmsMock(),
  dmRequests: () => dmRequestsMock(),
  dmRequestAnswer: (id: string, answer: string) => dmRequestAnswerMock(id, answer),
  personDmOpen: (account: string, name?: string) => personDmOpenMock(account, name),
}));

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/chat", search: {} } }),
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({
    data: [
      {
        name: "omni",
        owner: "user:local",
        runtimeId: "local",
        avatar: "🦉",
        localId: "prin_omni",
        hubId: "hub-omni",
      },
    ],
    isLoading: false,
  }),
  isGenesisPending: () => false,
}));

const bundleMock = vi.fn(() => ({ data: null as { access_token: string } | null }));
vi.mock("../hooks/useRuntimes", () => ({
  usePekohubBundle: () => bundleMock(),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: [] }),
}));

vi.mock("../hooks/usePrincipalStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/usePrincipalStatus")>();
  return {
    ...actual,
    usePrincipalStatus: () => ({ data: { status: "online", lastSeenAt: null, source: "local" } }),
  };
});

const HUB = "hub:http://localhost:3000";
const accessibleMock = vi.fn(() => ({ data: undefined as unknown, isSuccess: false }));
const adoptMock = vi.fn();
const removeMock = vi.fn();
vi.mock("../hooks/useRemotePrincipals", async (importOriginal) => ({
  ownPekosToAdopt: (await importOriginal<typeof import("../hooks/useRemotePrincipals")>())
    .ownPekosToAdopt,
  ownPekosToForget: (await importOriginal<typeof import("../hooks/useRemotePrincipals")>())
    .ownPekosToForget,
  useAdoptPekoDms: () => ({ data: 0 }),
  useRemotePrincipalRemove: () => ({ mutate: removeMock, isPending: false }),
  useRemotePrincipals: () => ({
    data: [
      {
        hubUrl: "http://localhost:3000",
        owner: "tester",
        principalName: "remy",
        displayName: "Remy",
        exposure: "public",
        status: "online",
        runtimeId: "hub:http://localhost:3000",
        addedAtUnixMs: 0,
        hasInviteToken: false,
      },
    ],
  }),
  useRemotePeko: (_runtimeId: string, name: string) => ({
    record: undefined,
    status: { data: { status: "online", lastSeenAt: null, source: "remote" } },
    identity: { name, avatar: "🦊", initials: "R", accent: "sky" },
    description: null,
  }),
  useAccessiblePrincipals: () => accessibleMock(),
  useRemotePrincipalAdopt: () => ({ mutate: adoptMock, isPending: false }),
}));

vi.mock("../lib/unread", () => ({
  // A reply from the remote peko landed while you were elsewhere.
  useUnreadCounts: () => ({ "hub:http://localhost:3000#remy": 2 }),
  unreadKey: (name: string, runtimeId?: string | null) =>
    runtimeId && runtimeId !== "local" ? `${runtimeId}#${name}` : name,
}));

vi.mock("../components/modals/PrincipalProfileModal", () => ({
  default: (props: { principalName: string; runtimeId?: string }) => (
    <div data-testid="profile">
      {props.principalName} @ {props.runtimeId}
    </div>
  ),
}));

import PrincipalSidebar from "../components/PrincipalSidebar";

describe("PrincipalSidebar", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    personDmsMock.mockReset().mockResolvedValue([]);
    dmRequestsMock.mockReset().mockResolvedValue([]);
    dmRequestAnswerMock.mockReset();
    personDmOpenMock.mockReset();
    bundleMock.mockReset().mockReturnValue({ data: null });
    accessibleMock.mockReset().mockReturnValue({ data: undefined, isSuccess: false });
    adoptMock.mockReset();
    removeMock.mockReset();
  });

  /** One of your pekos as your PekoHub account lists it. */
  const own = (principalName: string, hubId: string, localId: string) => ({
    id: `inst-${principalName}`,
    hubId,
    owner: "alice",
    ownerName: "Alice",
    principalName,
    publicName: principalName,
    status: "online",
    avatar: "🦊",
    localId,
    description: null,
    exposure: "private",
  });

  it("saves your pekos on other computers into the list, with nothing to connect", () => {
    bundleMock.mockReturnValue({ data: { access_token: "tok" } });
    accessibleMock.mockReturnValue({
      isSuccess: true,
      data: [
        // On this computer already: listed once, as itself.
        own("omni", "hub-omni", "prin_omni"),
        // On your other computer: saved, so it lists like omni.
        own("nova", "hub-nova", "prin_nova"),
      ],
    });
    render(<PrincipalSidebar />);
    expect(adoptMock).toHaveBeenCalledTimes(1);
    expect(adoptMock.mock.calls[0][0].peko.principalName).toBe("nova");
    expect(screen.queryByText(/accessible pekos/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();
    // remy is someone else's peko (not from your account): it stays.
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("lists local and remote pekos together, with no Remote heading", () => {
    render(<PrincipalSidebar />);
    expect(screen.queryByText(/^remote$/i)).toBeNull();
    const omni = screen.getByRole("button", { name: /omni/ });
    const remy = screen.getByRole("button", { name: /remy/ });
    expect(omni.parentElement).toBe(remy.parentElement);
    // Each shows its own avatar; the remote one comes from the hub.
    expect(within(omni).getByTestId("peko-avatar").textContent).toBe("🦉");
    expect(within(remy).getByTestId("peko-avatar").textContent).toBe("🦊");
    // Neither row says where the peko runs.
    expect(remy.textContent).not.toMatch(/tester|localhost/);
    // A remote peko's unread replies show like a local peko's.
    expect(within(remy).getByTestId("unread-remy").textContent).toBe("2");
    expect(within(omni).queryByTestId("unread-omni")).toBeNull();
  });

  it("opens a remote peko's chat and profile on its hub runtime", () => {
    render(<PrincipalSidebar />);
    const remy = screen.getByRole("button", { name: /remy/ });
    fireEvent.click(remy);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/chat/$pekoName",
      params: { pekoName: "remy" },
      search: { runtimeId: HUB },
    });
    fireEvent.contextMenu(remy);
    fireEvent.click(screen.getByRole("button", { name: /profile/i }));
    expect(screen.getByTestId("profile").textContent).toBe(`remy @ ${HUB}`);
  });

  it("lists DMs with people above the pekos, marking the ones not yet accepted", async () => {
    personDmsMock.mockResolvedValue([
      { channelId: "dm_bob", peer: "user:hub:bob-id", account: "bob-id", name: "Bob", waiting: true },
      { channelId: "dm_eve", peer: "user:hub:eve-id", account: "eve-id", name: null, waiting: false },
    ]);
    render(<PrincipalSidebar />);
    const bob = await screen.findByTestId("person-dm-row-dm_bob");
    expect(bob).toHaveTextContent("Bob");
    expect(bob).toHaveTextContent("invited");
    const eve = screen.getByTestId("person-dm-row-dm_eve");
    expect(eve).toHaveTextContent("eve-id");
    expect(eve).not.toHaveTextContent("invited");
    // People first, then a Pekos heading over the pekos.
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Pekos")).toBeInTheDocument();
    const order = (el: HTMLElement) =>
      Array.from(document.querySelectorAll("button")).indexOf(el as HTMLButtonElement);
    expect(order(bob)).toBeLessThan(order(screen.getByRole("button", { name: /omni/ })));
    fireEvent.click(eve);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/people/$channelId",
      params: { channelId: "dm_eve" },
      search: { runtimeId: "local" },
    });
  });

  it("has no Pekos heading when there are no people", async () => {
    render(<PrincipalSidebar />);
    await waitFor(() => expect(personDmsMock).toHaveBeenCalled());
    expect(screen.queryByText("Pekos")).toBeNull();
    expect(screen.getByText("Chats")).toBeInTheDocument();
  });

  it("accepts a message request and opens the DM with the chats", async () => {
    dmRequestsMock.mockResolvedValue([
      { channelId: "dm_alice", from: "user:hub:alice-id", account: "alice-id", name: "Alice", receivedAt: "" },
    ]);
    dmRequestAnswerMock.mockResolvedValue("dm_alice");
    render(<PrincipalSidebar />);
    const request = await screen.findByTestId("dm-request-dm_alice");
    expect(request).toHaveTextContent("Alice");
    expect(request).toHaveTextContent(/once you accept/);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(dmRequestAnswerMock).toHaveBeenCalledWith("dm_alice", "accept"));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/people/$channelId", params: { channelId: "dm_alice" } }),
      ),
    );
  });

  it("blocks a person from their request", async () => {
    dmRequestsMock.mockResolvedValue([
      { channelId: "dm_eve", from: "user:hub:eve-id", account: "eve-id", name: null, receivedAt: "" },
    ]);
    dmRequestAnswerMock.mockResolvedValue(null);
    render(<PrincipalSidebar />);
    await screen.findByTestId("dm-request-dm_eve");
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() => expect(dmRequestAnswerMock).toHaveBeenCalledWith("dm_eve", "block"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("messages a person from New chat", async () => {
    personDmOpenMock.mockResolvedValue("dm_bob");
    render(<PrincipalSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Message a person" }));
    fireEvent.change(screen.getByTestId("person-dm-account"), {
      target: { value: " user:hub:bob-id " },
    });
    fireEvent.change(screen.getByTestId("person-dm-name"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    await waitFor(() => expect(personDmOpenMock).toHaveBeenCalledWith("bob-id", "Bob"));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/people/$channelId", params: { channelId: "dm_bob" } }),
      ),
    );
    expect(screen.queryByTestId("person-dm-form")).toBeNull();
  });
});
