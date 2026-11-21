import { describe, expect, it } from "vitest";
import { answersComplete, dmCardStates, groupCardStates, renderAnswers } from "../lib/questions";
import type { Ask } from "../types";

const ask: Ask = {
  questions: [{ text: "Which day?", options: ["Tue", "Thu"] }, { text: "Anything else?" }],
};

describe("question cards (runtime ADR-114)", () => {
  it("renders answers the way the runtime does", () => {
    expect(
      renderAnswers(ask, { to: "m", picks: [{ chosen: ["Tue"], other: "after 6" }, { other: "no" }] }),
    ).toBe("Which day? → Tue — after 6\nAnything else? → no");
  });

  it("needs a choice or words for every question", () => {
    expect(answersComplete([{ chosen: ["Tue"] }, {}], ask)).toBe(false);
    expect(answersComplete([{ chosen: ["Tue"] }, { other: "  " }], ask)).toBe(false);
    expect(answersComplete([{ chosen: ["Tue"] }, { other: "no" }], ask)).toBe(true);
  });

  it("closes a DM card when answered, replaced, or you write — not on the peko's other posts", () => {
    const asked = { isUser: false, ask, msgId: "m1" };
    expect(dmCardStates([asked, { isUser: false }])[0]?.open).toBe(true);
    expect(dmCardStates([asked, { isUser: true }])[0]?.open).toBe(false);
    expect(dmCardStates([asked, { isUser: false, ask, msgId: "m2" }])[0]?.open).toBe(false);
    const answered = dmCardStates([asked, { isUser: true, answers: { to: "m1", picks: [] } }])[0];
    expect(answered).toEqual({ open: false, answered: { to: "m1", picks: [] } });
    expect(dmCardStates([{ isUser: false }])[0]).toBeUndefined();
  });

  it("keeps a group card open while others talk, until answered, replaced, or answered in words", () => {
    const asked = { author: "principal:local:p", ask, msgId: "m1" };
    const forBob = { ...asked, ask: { ...ask, for: "user:hub:bob" } };
    const peko = { author: "principal:local:q", root: true };
    const reply = { author: "user:hub:x", root: false };
    expect(groupCardStates([asked, peko, reply])[0]?.open).toBe(true);
    // Whom it is for writing on their own is their answer in words.
    expect(groupCardStates([asked, { author: "user:hub:x", root: true }])[0]?.open).toBe(false);
    expect(groupCardStates([forBob, { author: "user:hub:x", root: true }])[0]?.open).toBe(true);
    expect(groupCardStates([forBob, { author: "user:hub:bob", root: true }])[0]?.open).toBe(false);
    expect(groupCardStates([asked, { author: "principal:local:p", ask }])[0]?.open).toBe(false);
    expect(groupCardStates([asked, { author: "principal:local:q", ask }])[0]?.open).toBe(true);
    expect(
      groupCardStates([asked, { author: "user:hub:x", answers: { to: "m1", picks: [] } }])[0]?.open,
    ).toBe(false);
  });
});
