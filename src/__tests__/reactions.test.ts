// Runtime ADR-126: the reactions fold, the quote rule, and the emoji check.
import { describe, it, expect } from "vitest";
import { foldReactions, isMessage, looksLikeEmoji, showsQuote } from "../lib/reactions";

const post = (msg_id: string, author: string, at: string, react?: { to: string; emoji: string; remove?: boolean }) => ({
  kind: "posted",
  author,
  at,
  msg_id,
  ...(react && { react }),
});

describe("reactions", () => {
  it("folds adds and removes, latest op winning, in either order", () => {
    const add = post("r1", "user:local", "2026-11-25T10:00:01Z", { to: "m1", emoji: "👍" });
    const off = post("r2", "user:local", "2026-11-25T10:00:02Z", { to: "m1", emoji: "👍", remove: true });
    const peko = post("r3", "principal:local:p", "2026-11-25T10:00:03Z", { to: "m1", emoji: "👍" });
    for (const log of [[add, off, peko], [peko, off, add]]) {
      expect(foldReactions(log).get("m1")).toEqual([{ emoji: "👍", by: ["principal:local:p"] }]);
    }
  });

  it("ignores a reaction to a reaction and caps a message at 20 emoji", () => {
    const log = [
      post("r1", "user:local", "2026-11-25T10:00:01Z", { to: "m1", emoji: "👍" }),
      post("r2", "principal:local:p", "2026-11-25T10:00:02Z", { to: "r1", emoji: "😂" }),
      ...Array.from({ length: 21 }, (_, i) =>
        post(`s${i}`, "user:local", `2026-11-25T10:01:${String(i).padStart(2, "0")}Z`, {
          to: "m2",
          emoji: String.fromCodePoint(0x1f600 + i),
        }),
      ),
    ];
    const folded = foldReactions(log);
    expect(folded.get("r1")).toBeUndefined();
    expect(folded.get("m2")).toHaveLength(20);
  });

  it("tells a message from a reaction", () => {
    expect(isMessage(post("m1", "user:local", "t"))).toBe(true);
    expect(isMessage(post("r1", "user:local", "t", { to: "m1", emoji: "👍" }))).toBe(false);
  });

  it("quotes a reply unless it directly follows its message", () => {
    expect(showsQuote("m1", "m1")).toBe(false);
    expect(showsQuote("m1", "m2")).toBe(true);
    expect(showsQuote(null, "m2")).toBe(false);
  });

  it("accepts one emoji only", () => {
    for (const ok of ["👍", "❤️", "👍🏽", "🇯🇵", "1️⃣", "👨‍👩‍👧"]) expect(looksLikeEmoji(ok)).toBe(true);
    for (const bad of ["", "ok", "👍👍", ":+1:", "a"]) expect(looksLikeEmoji(bad)).toBe(false);
  });
});
