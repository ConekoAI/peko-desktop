// A peko removed from this computer stays gone, and moving between chats
// takes one click. Field report: after Pip was removed, Pip stayed in
// Chats as "your peko on <this computer>" (the account still listed it
// there); opening it showed an empty chat, and getting back to Nova took
// two clicks. This computer's engine is the authority on its pekos: one
// the account lists on this computer that the engine doesn't have is
// gone. The real router, sidebar, chat and hooks run here; only the
// backend is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup, within } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { z } from "zod";

// The first-turn panel has its own test (SetupPanel.test.tsx).
vi.mock("../components/peko/SetupPanel", () => ({ default: () => null }));

import Chat from "../pages/Chat";
import PrincipalSidebar from "../components/PrincipalSidebar";
import { usePrincipalRemove } from "../hooks/usePrincipals";

/** The hub the app's default settings point at. */
const HUB = "https://api.pekohub.ai";
const RUNTIME = `hub:${HUB}`;
/** This computer's runtime DID, as its engine states it. */
const THIS_MAC = "did:key:zThisMac";

interface Saved {
  hubUrl: string;
  owner: string;
  principalName: string;
  hubId?: string;
  fromAccount?: boolean;
  runtimeName?: string | null;
}

let local: Array<Record<string, unknown>> = [];
let saved: Saved[] = [];
let account: Array<Record<string, unknown>> = [];
const adopted: string[] = [];

function peko(name: string, hubId: string | null) {
  return {
    name,
    localId: `prin_${name}`,
    hubId,
    owner: "user:local",
    runtimeId: "local",
    bootState: "organized",
  };
}

/** Removes `name` the way the profile's Remove does. */
function Remove({ name }: { name: string }) {
  const remove = usePrincipalRemove();
  return <button onClick={() => remove.mutate({ name })}>remove {name}</button>;
}

function renderApp(start: string, removing = "pip") {
  const root = createRootRoute({
    component: () => (
      <>
        <Remove name={removing} />
        <nav data-testid="list">
          <PrincipalSidebar />
        </nav>
        <main data-testid="main">
          <Outlet />
        </main>
      </>
    ),
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: Chat,
  });
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/chat",
    component: Chat,
  });
  const chatPeko = createRoute({
    getParentRoute: () => chat,
    path: "$pekoName",
    component: Chat,
    validateSearch: z.object({
      runtimeId: z.string().optional(),
      say: z.string().optional(),
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([index, chat.addChildren([chatPeko])]),
    history: createMemoryHistory({ initialEntries: [start] }),
  });
  const moves: string[] = [];
  router.history.subscribe(({ action }) =>
    moves.push(`${action.type} ${router.history.location.href}`),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, qc, moves };
}

/** The list's row for `name`. */
function row(name: string): HTMLElement | null {
  const label = within(screen.getByTestId("list")).queryByText(name, {
    selector: "span",
  });
  return label?.closest("button") ?? null;
}

async function settle() {
  await act(async () => new Promise((r) => setTimeout(r, 100)));
}

beforeEach(() => {
  localStorage.clear();
  adopted.length = 0;
  local = [peko("nova", "hub-nova"), peko("pip", "hub-pip")];
  saved = [];
  // Signed in: your account lists both pekos of this computer.
  account = ["nova", "pip"].map((name) => ({
    id: `inst-${name}`,
    hubId: `hub-${name}`,
    owner: "maya",
    pekoName: name,
    status: "online",
    localId: `prin_${name}`,
    runtimeName: "this-mac",
    runtimeId: THIS_MAC,
  }));
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, any>;
    switch (cmd) {
      case "principal_list":
        return local;
      case "principal_get":
        return local.find((p) => p.name === a.name) ?? null;
      case "principal_remove":
        local = local.filter((p) => p.name !== a.name);
        return true;
      case "remote_principal_list":
        return saved.map((r) => ({ ...r, runtimeId: `hub:${r.hubUrl}` }));
      case "remote_principal_adopt": {
        adopted.push(a.req.principalName);
        saved = [...saved.filter((r) => r.hubId !== a.req.hubId), { ...a.req }];
        return { ...a.req, runtimeId: `hub:${a.req.hubUrl}` };
      }
      case "remote_principal_remove":
        saved = saved.filter(
          (r) =>
            !(r.hubUrl === a.hubUrl && r.owner === a.owner && r.principalName === a.principalName),
        );
        return true;
      case "remote_principal_adopt_dms":
        return 0;
      case "runtime_did":
        return THIS_MAC;
      case "credential_get_raw":
        return a.provider === "pekohub" ? JSON.stringify({ access_token: "token" }) : null;
      case "hub_get":
        return a.resource === "accessible_pekos"
          ? { status: 200, body: JSON.stringify({ pekos: account }) }
          : { status: 404, body: "" };
      case "principal_log":
        return { messages: [], nextCursor: null, hasMore: false };
      case "settings_list":
      case "model_list":
      case "person_dms":
      case "dm_requests":
      case "principal_approvals":
      case "principal_secret_requests":
      case "principal_turn_changes":
        return [];
      default:
        return null;
    }
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("a peko removed from this computer", () => {
  it("leaves Chats, though your account still lists it here", async () => {
    const { qc } = renderApp("/chat/nova?runtimeId=local");
    await waitFor(() => expect(row("pip")).not.toBeNull());
    // The account's list has been read: what it lists is adopted from here on.
    await waitFor(() => expect(qc.getQueryData(["accessible-principals", HUB])).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByText("remove pip"));
    });
    await settle();

    // Before: the account's list (still naming pip on this computer) saved
    // it back at once as "your peko on this-mac", whose chat opened empty.
    expect(adopted).not.toContain("pip");
    expect(saved).toEqual([]);
    expect(row("pip")).toBeNull();
  });

  it("drops a copy saved before, as a peko on another computer", async () => {
    // How the field report left it: pip removed here, saved back from the
    // account, and the account still lists it on this computer.
    local = [peko("nova", "hub-nova")];
    saved = [
      {
        hubUrl: HUB,
        owner: "maya",
        principalName: "pip",
        hubId: "hub-pip",
        fromAccount: true,
        runtimeName: "this-mac",
      },
    ];
    renderApp("/chat/nova?runtimeId=local");
    await settle();
    await waitFor(() => expect(saved).toEqual([]));
    await waitFor(() => expect(row("pip")).toBeNull());
    expect(adopted).not.toContain("pip");
  });

  it("still lists your pekos on your other computers", async () => {
    local = [peko("nova", "hub-nova")];
    account = [
      ...account.filter((p) => p.pekoName === "nova"),
      {
        id: "inst-kit",
        hubId: "hub-kit",
        owner: "maya",
        pekoName: "kit",
        status: "online",
        localId: "prin_kit",
        runtimeName: "laptop",
        runtimeId: "did:key:zLaptop",
      },
    ];
    renderApp("/chat/nova?runtimeId=local");
    await waitFor(() => expect(adopted).toEqual(["kit"]));
    await waitFor(() => expect(row("kit")).not.toBeNull());
  });
});

describe("moving between chats", () => {
  it("goes from a peko on another computer to one of this computer's in one click", async () => {
    saved = [{ hubUrl: HUB, owner: "bob", principalName: "kit", hubId: "hub-kit" }];
    const { router, moves } = renderApp(`/chat/kit?runtimeId=${encodeURIComponent(RUNTIME)}`);
    await waitFor(() => expect(row("nova")).not.toBeNull());
    await waitFor(() => expect(within(screen.getByTestId("main")).getByText("kit")).toBeTruthy());
    moves.length = 0;

    await act(async () => {
      fireEvent.click(row("nova")!);
    });
    await settle();

    // Before: the chat read the old peko's name with the new runtime
    // ("kit" on this computer), found no such peko, and left — the click
    // was lost on the way to a phantom chat.
    expect(moves).toEqual(["PUSH /chat/nova?runtimeId=local"]);
    expect(router.state.location.href).toBe("/chat/nova?runtimeId=local");
    expect(within(screen.getByTestId("main")).getByText("nova")).toBeTruthy();
  });

  it("leaves a peko on another computer that is no longer saved", async () => {
    // Taken off the list (or gone from your account) with its address open.
    const { router } = renderApp(`/chat/kit?runtimeId=${encodeURIComponent(RUNTIME)}`);
    await settle();
    await waitFor(() => expect(router.state.location.href).toBe("/chat/nova?runtimeId=local"));
  });
});
