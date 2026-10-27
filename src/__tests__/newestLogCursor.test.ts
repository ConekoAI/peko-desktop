// The log watch starts from the newest row the chat already shows, so
// opening a long thread never replays it.

import { describe, it, expect } from "vitest";

import { newestLogCursor } from "../hooks/usePrincipals";

describe("newestLogCursor", () => {
  it("is null for an unloaded or empty thread", () => {
    expect(newestLogCursor(undefined)).toBeNull();
    expect(newestLogCursor([])).toBeNull();
  });

  it("returns the highest `chan_<line>` row number", () => {
    expect(newestLogCursor([{ id: "chan_3" }, { id: "chan_12" }, { id: "chan_7" }])).toBe("12");
  });

  it("ignores ids that carry no row number", () => {
    expect(newestLogCursor([{ id: "chat_9f2c" }, { id: "chan_4" }])).toBe("4");
    expect(newestLogCursor([{ id: "chat_9f2c" }])).toBeNull();
  });
});
