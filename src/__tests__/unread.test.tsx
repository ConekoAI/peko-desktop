// What you have not read: counted by the engine's read mark (runtime
// ADR-108 D5), so reading on your phone clears it here; looking at a chat
// here tells the engine; and a peko writing while you aren't looking is
// announced.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const principalLogMock = vi.fn();
const readStateMock = vi.fn();
const markReadMock = vi.fn(async (_channel: string, _at: string) => true);
const watchCallbacks: Record<string, (row: unknown) => void> = {};
vi.mock("../lib/api", () => ({
  principalLog: (args: { name: string }) => principalLogMock(args),
  readState: () => readStateMock(),
  markRead: (channel: string, at: string) => markReadMock(channel, at),
  principalLogWatch: async (
    name: string,
    _peer: unknown,
    _since: unknown,
    cb: (r: unknown) => void,
    runtimeId?: string,
  ) => {
    // Remote pekos are watched through their DM, keyed by hub.
    watchCallbacks[runtimeId ? `${runtimeId}#${name}` : name] = cb;
    return () => {};
  },
}));

const notifyMock = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  sendNotification: (n: unknown) => notifyMock(n),
}));

const badgeMock = vi.fn(async (_n?: number) => {});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setBadgeCount: badgeMock }),
}));

const location: { pathname: string; search: Record<string, string> } = {
  pathname: "/chat/nova",
  search: {},
};
vi.mock("@tanstack/react-router", () => ({ useLocation: () => location }));

// A remote peko's thread is the runtime's DM with it, watched like a local one.
const REMY_HUB = "hub:http://localhost:3000";
const remotesState: { data: unknown[] } = { data: [] };
vi.mock("../hooks/useRemotePrincipals", () => ({
  useRemotePrincipals: () => remotesState,
}));
vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({
    data: [
      { name: "nova", localId: "prin_n" },
      { name: "juno", localId: "prin_j" },
    ],
  }),
  useCallerSubject: () => "user:local",
  newestLogCursor: () => null,
}));

import { useDmActivity } from "../hooks/useDmActivity";
import {
  adoptLegacyReadMarks,
  isFromPerson,
  resetUnread,
  setReadState,
  useGroupUnread,
  useUnreadCounts,
} from "../lib/unread";

const row = (sender: unknown, timestamp: string, text: string) => ({ id: "x", sender, timestamp, text });
const page = (messages: unknown[]) => ({ peer: "user:local", messages, nextCursor: null, hasMore: false });

/** One conversation as the engine reports it. */
const dm = (channel: string, localId: string | null, unread: number, more: object = {}) => ({
  channel,
  kind: "dm",
  peerKind: "principal",
  peerLocalId: localId,
  peerHubId: null,
  unread,
  marked: true,
  ...more,
});
const NOVA = dm("dm_nova", "prin_n", 0);
const JUNO = dm("dm_juno", "prin_j", 0);

function renderActivity() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(
    () => {
      useDmActivity();
      return { chats: useUnreadCounts(), groups: useGroupUnread() };
    },
    { wrapper },
  );
}

beforeEach(() => {
  resetUnread();
  // This window already handed its old positions over.
  localStorage.setItem("peko.readMarksAdopted", "1");
  notifyMock.mockReset();
  badgeMock.mockClear();
  principalLogMock.mockReset();
  principalLogMock.mockResolvedValue(page([]));
  readStateMock.mockReset();
  readStateMock.mockResolvedValue([NOVA, JUNO]);
  markReadMock.mockClear();
  for (const key of Object.keys(watchCallbacks)) delete watchCallbacks[key];
  location.pathname = "/chat/nova";
  location.search = {};
  remotesState.data = [];
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

describe("isFromPerson", () => {
  it("reads both wire shapes", () => {
    expect(isFromPerson("user:local")).toBe(true);
    expect(isFromPerson({ kind: "visitor", id: "v1" })).toBe(true);
    expect(isFromPerson({ kind: "principal", id: "prin_a" })).toBe(false);
    expect(isFromPerson("principal:prin_a")).toBe(false);
  });
});

describe("useDmActivity", () => {
  it("shows the engine's counts: pekos by name, people and groups by conversation", async () => {
    readStateMock.mockResolvedValue([
      NOVA,
      dm("dm_juno", "prin_j", 2),
      { channel: "dm_noah", kind: "dm", peerKind: "user", peerHubId: "noah-id", unread: 1, marked: true },
      { channel: "chan_trip", kind: "group", unread: 4, marked: true },
      // A DM with a peko this app does not list is not counted anywhere.
      dm("dm_ghost", "prin_gone", 9),
    ]);
    const { result } = renderActivity();
    await waitFor(() => expect(result.current.chats).toEqual({ juno: 2, dm_noah: 1 }));
    expect(result.current.groups).toEqual({ chan_trip: 4 });
    // The dock icon counts all of it.
    await waitFor(() => expect(badgeMock).toHaveBeenLastCalledWith(7));
  });

  it("clears a count when you read it somewhere else", async () => {
    readStateMock.mockResolvedValue([NOVA, dm("dm_juno", "prin_j", 3)]);
    const { result } = renderActivity();
    await waitFor(() => expect(result.current.chats.juno).toBe(3));
    // You read it on your phone: the next look at the engine says so.
    readStateMock.mockResolvedValue([NOVA, JUNO]);
    await waitFor(() => expect(result.current.chats.juno).toBeUndefined(), { timeout: 8000 });
    expect(markReadMock).not.toHaveBeenCalled();
  }, 10_000);

  it("announces a live message from a peko you aren't looking at, and counts it", async () => {
    const { result } = renderActivity();
    await waitFor(() => expect(watchCallbacks.juno).toBeDefined());
    await waitFor(() => expect(readStateMock).toHaveBeenCalled());
    readStateMock.mockResolvedValue([NOVA, dm("dm_juno", "prin_j", 1)]);
    const at = new Date().toISOString();
    act(() => watchCallbacks.juno(row({ kind: "principal", id: "prin_j" }, at, "Time to stretch!")));
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith({ title: "juno", body: "Time to stretch!" }));
    // The count comes from the engine, asked again because a peko wrote.
    await waitFor(() => expect(result.current.chats.juno).toBe(1));
    expect(markReadMock).not.toHaveBeenCalled();
    // A replay of the same message is not announced twice.
    act(() => watchCallbacks.juno({ ...row({ kind: "principal", id: "prin_j" }, at, "Time to stretch!"), id: "chan_9" }));
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("tells the engine at once when the peko writes in the chat you are looking at", async () => {
    const { result } = renderActivity();
    await waitFor(() => expect(watchCallbacks.nova).toBeDefined());
    await waitFor(() => expect(readStateMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.chats).toEqual({}));
    act(() => watchCallbacks.nova(row("principal:prin_n", "2026-10-30T10:00:00Z", "reply")));
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith("dm_nova", "2026-10-30T10:00:00Z"));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does not call the open chat read while the window is in the background", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderActivity();
    await waitFor(() => expect(watchCallbacks.nova).toBeDefined());
    await waitFor(() => expect(readStateMock).toHaveBeenCalled());
    act(() => watchCallbacks.nova(row("principal:prin_n", new Date().toISOString(), "done!")));
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it("marks a chat read when you open it, and when what you wrote arrives", async () => {
    readStateMock.mockResolvedValue([NOVA, dm("dm_juno", "prin_j", 2)]);
    const { result, rerender } = renderActivity();
    await waitFor(() => expect(result.current.chats.juno).toBe(2));
    expect(markReadMock).not.toHaveBeenCalled();
    location.pathname = "/chat/juno";
    readStateMock.mockResolvedValue([NOVA, JUNO]);
    rerender();
    await waitFor(() => expect(markReadMock).toHaveBeenCalledTimes(1));
    expect(markReadMock.mock.calls[0][0]).toBe("dm_juno");
    await waitFor(() => expect(result.current.chats.juno).toBeUndefined());

    // Your own message in another chat: seen up to it.
    await waitFor(() => expect(watchCallbacks.nova).toBeDefined());
    const later = new Date(Date.now() + 60_000).toISOString();
    act(() => watchCallbacks.nova(row("user:local", later, "thanks")));
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith("dm_nova", later));
  });

  it("counts a remote peko under its own key, by its PekoHub ID", async () => {
    remotesState.data = [{ principalName: "remy", runtimeId: REMY_HUB, hubId: "156f1a95" }];
    readStateMock.mockResolvedValue([
      NOVA,
      JUNO,
      dm("dm_remy", null, 1, { peerHubId: "156f1a95" }),
    ]);
    const { result, rerender } = renderActivity();
    await waitFor(() => expect(result.current.chats[`${REMY_HUB}#remy`]).toBe(1));
    // A local peko of the same name keeps its own count.
    expect(result.current.chats.remy).toBeUndefined();

    // Looking at remy's chat (on its hub) reads it.
    location.pathname = "/chat/remy";
    location.search = { runtimeId: REMY_HUB };
    rerender();
    await waitFor(() => expect(markReadMock).toHaveBeenCalled());
    expect(markReadMock.mock.calls[0][0]).toBe("dm_remy");
    await waitFor(() => expect(result.current.chats[`${REMY_HUB}#remy`]).toBeUndefined());
  });
});

describe("adoptLegacyReadMarks", () => {
  const pekos = [
    { key: "nova", localId: "prin_n" },
    { key: "juno", localId: "prin_j" },
  ];

  it("hands this window's old positions to the engine, once", () => {
    localStorage.removeItem("peko.readMarksAdopted");
    localStorage.setItem("peko.readUpTo", JSON.stringify({ juno: "2026-11-01T09:00:00.000Z" }));
    const rows = [
      // Already marked by the engine: left alone.
      dm("dm_nova", "prin_n", 3),
      // This window remembers where you were.
      dm("dm_juno", "prin_j", 40, { marked: false }),
      // Nothing remembered: what is already there is not news.
      { channel: "chan_trip", kind: "group", unread: 12, marked: false },
    ];
    const before = Date.now();
    expect(adoptLegacyReadMarks(rows, pekos)).toBe(true);
    const calls = Object.fromEntries(markReadMock.mock.calls.map(([channel, at]) => [channel, at]));
    expect(Object.keys(calls).sort()).toEqual(["chan_trip", "dm_juno"]);
    expect(calls.dm_juno).toBe("2026-11-01T09:00:00.000Z");
    expect(Date.parse(calls.chan_trip)).toBeGreaterThanOrEqual(before);
    expect(localStorage.getItem("peko.readUpTo")).toBeNull();

    // The second time there is nothing to hand over.
    markReadMock.mockClear();
    expect(adoptLegacyReadMarks(rows, pekos)).toBe(false);
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it("does not report the same moment twice", () => {
    setReadState([dm("dm_juno", "prin_j", 1)], pekos);
    localStorage.removeItem("peko.readMarksAdopted");
    adoptLegacyReadMarks([dm("dm_juno", "prin_j", 1, { marked: false })], pekos);
    expect(markReadMock).toHaveBeenCalledTimes(1);
  });
});
