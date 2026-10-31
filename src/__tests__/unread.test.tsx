// Unread peko messages: counted from the thread on start, kept live by
// the DM watch, cleared when you look, and announced when you aren't.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const principalLogMock = vi.fn();
const watchCallbacks: Record<string, (row: unknown) => void> = {};
vi.mock("../lib/api", () => ({
  principalLog: (args: { name: string }) => principalLogMock(args),
  principalLogWatch: async (name: string, _peer: unknown, _since: unknown, cb: (r: unknown) => void) => {
    watchCallbacks[name] = cb;
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

// Remote pekos write only in reply; the backend announces each one.
const REMY_HUB = "hub:http://localhost:3000";
const remotesState: { data: unknown[] } = { data: [] };
vi.mock("../hooks/useRemotePrincipals", () => ({
  useRemotePrincipals: () => remotesState,
}));
const eventListeners: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    eventListeners[name] = cb;
    return () => {
      delete eventListeners[name];
    };
  },
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({ data: [{ name: "nova" }, { name: "juno" }] }),
  useCallerSubject: () => "user:local",
  newestLogCursor: () => null,
}));

import { useDmActivity } from "../hooks/useDmActivity";
import { isFromPerson, markRead, resetUnread, useUnreadCounts } from "../lib/unread";

const row = (sender: unknown, timestamp: string, text: string) => ({ id: "x", sender, timestamp, text });
const page = (messages: unknown[]) => ({ peer: "user:local", messages, nextCursor: null, hasMore: false });

function renderActivity() {
  return renderHook(() => {
    useDmActivity();
    return useUnreadCounts();
  });
}

beforeEach(() => {
  resetUnread();
  notifyMock.mockReset();
  badgeMock.mockClear();
  principalLogMock.mockReset();
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
  it("treats a peko's existing history as read the first time", async () => {
    principalLogMock.mockResolvedValue(page([row("principal:prin_j", "2026-10-30T09:00:00Z", "old news")]));
    const { result } = renderActivity();
    await waitFor(() => expect(watchCallbacks.juno).toBeDefined());
    expect(result.current.juno ?? 0).toBe(0);
  });

  it("counts what a peko wrote since you last looked", async () => {
    markRead("juno", "2026-10-30T09:00:00Z");
    principalLogMock.mockImplementation(async ({ name }: { name: string }) =>
      name === "juno"
        ? page([
            row("user:local", "2026-10-30T08:59:00Z", "hi"),
            row("principal:prin_j", "2026-10-30T09:05:00Z", "reminder"),
            row("principal:prin_j", "2026-10-30T09:06:00Z", "again"),
          ])
        : page([]),
    );
    const { result } = renderActivity();
    await waitFor(() => expect(result.current.juno).toBe(2));
    await waitFor(() => expect(badgeMock).toHaveBeenLastCalledWith(2));
  });

  it("counts and announces a live message from a peko you aren't looking at", async () => {
    principalLogMock.mockResolvedValue(page([]));
    const { result } = renderActivity();
    await waitFor(() => expect(watchCallbacks.juno).toBeDefined());
    act(() => watchCallbacks.juno({ ...row({ kind: "principal", id: "prin_j" }, "2026-10-30T10:00:00Z", "Time to stretch!") }));
    expect(result.current.juno).toBe(1);
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith({ title: "juno", body: "Time to stretch!" }));
    // A replay of the same message is not counted twice.
    act(() => watchCallbacks.juno({ ...row({ kind: "principal", id: "prin_j" }, "2026-10-30T10:00:00Z", "Time to stretch!"), id: "chan_9" }));
    expect(result.current.juno).toBe(1);
  });

  it("does not count the chat you are looking at", async () => {
    principalLogMock.mockResolvedValue(page([]));
    const { result } = renderActivity();
    await waitFor(() => expect(watchCallbacks.nova).toBeDefined());
    act(() => watchCallbacks.nova(row("principal:prin_n", "2026-10-30T10:00:00Z", "reply")));
    expect(result.current.nova ?? 0).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("counts the open chat when the window is in the background", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    principalLogMock.mockResolvedValue(page([]));
    const { result } = renderActivity();
    await waitFor(() => expect(watchCallbacks.nova).toBeDefined());
    act(() => watchCallbacks.nova(row("principal:prin_n", "2026-10-30T10:00:00Z", "done!")));
    expect(result.current.nova).toBe(1);
  });

  it("clears a peko's count when you open its chat", async () => {
    location.pathname = "/chat/juno";
    principalLogMock.mockResolvedValue(page([]));
    const { result, rerender } = renderActivity();
    await waitFor(() => expect(watchCallbacks.juno).toBeDefined());
    location.pathname = "/chat/nova";
    rerender();
    // A reply from after the watch started (a fixed date here went
    // stale once the clock passed it).
    const later = new Date(Date.now() + 60_000).toISOString();
    act(() => watchCallbacks.juno(row("principal:prin_j", later, "ping")));
    expect(result.current.juno).toBe(1);
    location.pathname = "/chat/juno";
    rerender();
    await waitFor(() => expect(result.current.juno).toBe(0));
  });

  it("counts a remote peko's reply that lands after you leave its chat", async () => {
    remotesState.data = [{ principalName: "remy", runtimeId: REMY_HUB }];
    principalLogMock.mockResolvedValue(page([]));
    // You were in remy's chat, then switched to nova before it replied.
    markRead(`${REMY_HUB}#remy`, new Date(Date.now() - 60_000).toISOString());
    const { result, rerender } = renderActivity();
    await waitFor(() => expect(eventListeners["remote-reply"]).toBeDefined());
    const reply = { runtimeId: REMY_HUB, name: "remy", text: "done!", timestamp: new Date().toISOString() };
    act(() => eventListeners["remote-reply"]({ payload: reply }));
    expect(result.current[`${REMY_HUB}#remy`]).toBe(1);
    // A local peko of the same name keeps its own count.
    expect(result.current.remy).toBeUndefined();
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());

    // Looking at remy's chat (on its hub) reads it.
    location.pathname = "/chat/remy";
    location.search = { runtimeId: REMY_HUB };
    rerender();
    await waitFor(() => expect(result.current[`${REMY_HUB}#remy`]).toBe(0));
  });
});
