// The peko list: pekos on this runtime and pekos reached through a hub
// sit in one list, look the same, and open their own profile.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
  useSearch: () => ({}),
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({
    data: [{ name: "omni", owner: "user:local", runtimeId: "local", avatar: "🦉" }],
    isLoading: false,
  }),
  isGenesisPending: () => false,
}));

vi.mock("../hooks/useRuntimes", () => ({
  usePekohubBundle: () => ({ data: null }),
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
vi.mock("../hooks/useRemotePrincipals", () => ({
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
  useAccessiblePrincipals: () => ({ data: undefined }),
  useRemotePrincipalAdd: () => ({ mutate: vi.fn(), isPending: false }),
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
  beforeEach(() => navigateMock.mockReset());

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
});
