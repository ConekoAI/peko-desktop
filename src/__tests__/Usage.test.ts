// Usage counts (pekohub ADR-014): the window asks the native side for an
// event by name; what it derives itself (ranges, the update check, the
// first reply) is checked here.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((_cmd: string, _args?: unknown) => Promise.resolve(null));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));

import { sinceInstall, track, trackAppOpened, trackFirstReply, usageApiFormat } from "../lib/usage";

const sent = () => invoke.mock.calls.map(([, args]) => args as { name: string; properties: Record<string, unknown> });

beforeEach(() => {
  invoke.mockClear();
  localStorage.clear();
});

describe("usage counts", () => {
  it("asks the native side by name, with the properties given", () => {
    track("group_created");
    track("message_sent", { kind: "dm", has_attachment: true });
    expect(invoke.mock.calls[0][0]).toBe("usage_event");
    expect(sent()).toEqual([
      { name: "group_created", properties: {} },
      { name: "message_sent", properties: { kind: "dm", has_attachment: true } },
    ]);
  });

  it("names a model's format only when it is a known one", () => {
    expect(usageApiFormat("anthropic")).toBe("anthropic");
    expect(usageApiFormat("https://llm.internal.example/v1")).toBe("other");
    expect(usageApiFormat(undefined)).toBe("other");
  });

  it("puts the time since install into five ranges", () => {
    const minute = 60_000;
    expect(sinceInstall(0, 30_000)).toBe("under_1m");
    expect(sinceInstall(0, 4 * minute)).toBe("under_5m");
    expect(sinceInstall(0, 29 * minute)).toBe("under_30m");
    expect(sinceInstall(0, 23 * 60 * minute)).toBe("under_1d");
    expect(sinceInstall(0, 3 * 24 * 60 * minute)).toBe("over_1d");
  });

  it("counts each open, and an update only when the version changed", () => {
    trackAppOpened("0.2.0", 1000);
    trackAppOpened("0.2.0", 2000);
    trackAppOpened("0.3.0", 3000);
    expect(sent().map((e) => e.name)).toEqual(["app_opened", "app_opened", "app_opened", "update_installed"]);
    expect(sent()[3].properties).toEqual({ from_version: "0.2.0", to_version: "0.3.0" });
  });

  it("counts the first reply once, with how long after install it came", () => {
    trackAppOpened("0.2.0", 0);
    invoke.mockClear();
    trackFirstReply(3 * 60_000);
    trackFirstReply(9 * 60_000);
    expect(sent()).toEqual([{ name: "first_reply_received", properties: { since_install: "under_5m" } }]);
  });
});
