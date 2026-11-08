// Your pekos on your other computers look like this computer's: they are
// saved from your PekoHub account's list, take their face and status
// from it (a private peko has no public page), and a peko here says
// where it really is.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listOwnMock = vi.fn();
const publicProfileMock = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  pekohubListAccessiblePekos: (hubUrl: string, token: string) => listOwnMock(hubUrl, token),
  remotePrincipalProfile: (...args: unknown[]) => publicProfileMock(...args),
}));

const bundleMock = vi.fn();
vi.mock("../hooks/useRuntimes", () => ({
  loadOAuthBundle: () => bundleMock(),
}));

import { ownPekosToAdopt, ownPekosToForget } from "../hooks/useRemotePrincipals";
import { usePrincipalStatus } from "../hooks/usePrincipalStatus";
import { effectiveRegistration } from "../components/modals/PrincipalProfileModal";
import type { AccessiblePrincipal, RemotePrincipalSummary } from "../lib/api";

const HUB = "http://127.0.0.1:3901";

function own(principalName: string, hubId: string, localId: string | null): AccessiblePrincipal {
  return {
    id: `inst-${principalName}`,
    hubId,
    owner: "alice",
    ownerName: "Alice",
    principalName,
    publicName: principalName,
    status: "online",
    avatar: "🦊",
    localId,
    description: "notes",
    exposure: "private",
  };
}

function saved(
  principalName: string,
  hubId: string | null,
  fromAccount = true,
  hubUrl = HUB,
): RemotePrincipalSummary {
  return {
    fromAccount,
    hubUrl,
    owner: "alice",
    principalName,
    displayName: principalName,
    exposure: "private",
    status: "online",
    runtimeId: `hub:${HUB}`,
    addedAtUnixMs: 0,
    hasInviteToken: false,
    hubId,
  };
}

describe("ownPekosToAdopt", () => {
  it("adopts only your pekos that live elsewhere and aren't saved yet", () => {
    const list = [
      own("here-by-hub", "h1", "prin_x"),
      own("here-by-local-id", "h2", "prin_here"),
      own("saved", "h3", "prin_s"),
      own("renamed", "h4", "prin_r"),
      own("new", "h5", null),
      { ...own("old-hub", "", "prin_o") },
    ];
    const here = [
      { hubId: "h1", localId: "prin_a" },
      // Registered moments ago: the list here hasn't caught its Hub ID.
      { hubId: null, localId: "prin_here" },
    ];
    const picked = ownPekosToAdopt(list, here, [saved("saved", "h3"), saved("was-named", "h4")]);
    expect(picked.map((p) => p.principalName)).toEqual(["renamed", "new"]);
  });

  it("of several pekos with one name, takes the one online, else the one saved", () => {
    const off = (hubId: string) => ({ ...own("kit", hubId, null), status: "offline" });
    const online = own("kit", "live", "prin_live");
    // A wiped computer's kit stays listed, offline, beside the new one.
    const list = [online, off("stale-a"), off("stale-b")];
    expect(ownPekosToAdopt(list, [], []).map((p) => p.hubId)).toEqual(["live"]);
    // The stale one saved earlier is replaced by the one online.
    expect(ownPekosToAdopt(list, [], [saved("kit", "stale-b")]).map((p) => p.hubId)).toEqual([
      "live",
    ]);
    // Nothing online: keep what is saved rather than flip to another leftover.
    const offline = [off("stale-a"), off("stale-b")];
    expect(ownPekosToAdopt(offline, [], [saved("kit", "stale-b")])).toEqual([]);
    expect(ownPekosToAdopt(offline, [], []).map((p) => p.hubId)).toEqual(["stale-a"]);
  });

  it("claims one first saved from a DM", () => {
    const list = [own("nova", "h1", "prin_n")];
    expect(ownPekosToAdopt(list, [], [saved("nova", "h1", false)]).map((p) => p.hubId)).toEqual([
      "h1",
    ]);
  });
});

describe("ownPekosToForget", () => {
  it("forgets yours that left your account, on this hub only", () => {
    const list = [own("kept", "h1", "prin_k")];
    const gone = ownPekosToForget(list, HUB, [
      saved("kept", "h1"),
      saved("deleted", "h2"),
      // Someone else's peko from a DM: not your account's to drop.
      saved("theirs", "h3", false),
      // Saved from another hub: this list says nothing about it.
      saved("elsewhere", "h4", true, "https://api.pekohub.ai"),
    ]);
    expect(gone.map((r) => r.principalName)).toEqual(["deleted"]);
  });
});

describe("effectiveRegistration", () => {
  it("says local only until a peko here has a PekoHub ID", () => {
    expect(effectiveRegistration({ exposure: "private", hubId: null })).toBe("local_only");
    expect(effectiveRegistration({ exposure: "private", hubId: "h1" })).toBe("private");
    expect(effectiveRegistration({ exposure: "public", hubId: "h1" })).toBe("public");
    expect(effectiveRegistration({ exposure: "local_only", hubId: null })).toBe("local_only");
    // A remote peko's summary carries no hubId field: as configured.
    expect(effectiveRegistration({ exposure: "public" })).toBe("public");
  });
});

describe("a remote peko's status", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  beforeEach(() => {
    listOwnMock.mockReset();
    publicProfileMock.mockReset();
    bundleMock.mockReset();
  });

  it("comes from your account for one of your own pekos", async () => {
    bundleMock.mockResolvedValue({ access_token: "tok" });
    listOwnMock.mockResolvedValue([own("nova", "h1", "prin_nova")]);
    const { result } = renderHook(
      () => usePrincipalStatus(`hub:${HUB}`, "nova", "alice", HUB),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.status).toBe("online"));
    expect(result.current.data?.profile).toEqual({
      avatar: "🦊",
      description: "notes",
      localId: "prin_nova",
    });
    expect(listOwnMock).toHaveBeenCalledWith(HUB, "tok");
    expect(publicProfileMock).not.toHaveBeenCalled();
  });

  it("comes from the public page for anyone else's", async () => {
    bundleMock.mockResolvedValue({ access_token: "tok" });
    listOwnMock.mockResolvedValue([own("nova", "h1", "prin_nova")]);
    publicProfileMock.mockResolvedValue({
      status: "offline",
      avatar: "🐙",
      description: null,
      localId: "prin_bob",
    });
    const { result } = renderHook(
      () => usePrincipalStatus(`hub:${HUB}`, "helper", "bob", HUB),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.status).toBe("offline"));
    expect(result.current.data?.profile?.avatar).toBe("🐙");
    expect(publicProfileMock).toHaveBeenCalledWith(HUB, "bob", "helper");
  });

  it("comes from the public page when this computer isn't signed in", async () => {
    bundleMock.mockResolvedValue(null);
    publicProfileMock.mockResolvedValue(null);
    const { result } = renderHook(
      () => usePrincipalStatus(`hub:${HUB}`, "nova", "alice", HUB),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.status).toBe("offline"));
    expect(listOwnMock).not.toHaveBeenCalled();
  });
});
