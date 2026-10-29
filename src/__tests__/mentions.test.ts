import { describe, it, expect } from "vitest";
import { insertMention, mentionCandidates, mentionQuery } from "../lib/mentions";

describe("mentionQuery", () => {
  it("finds the @word being typed", () => {
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("hi @ju", 6)).toEqual({ start: 3, query: "ju" });
    expect(mentionQuery("hi @juno, and @n", 16)).toEqual({ start: 14, query: "n" });
  });

  it("ignores emails, finished words, and text after the caret", () => {
    expect(mentionQuery("me@juno", 7)).toBeNull();
    expect(mentionQuery("@juno ", 6)).toBeNull();
    expect(mentionQuery("hello", 5)).toBeNull();
    expect(mentionQuery("@ju later", 3)).toEqual({ start: 0, query: "ju" });
  });
});

describe("mentionCandidates", () => {
  it("matches by prefix, case-insensitively", () => {
    expect(mentionCandidates(["juno", "Nova", "jade"], "j")).toEqual(["juno", "jade"]);
    expect(mentionCandidates(["juno", "Nova"], "no")).toEqual(["Nova"]);
    expect(mentionCandidates(["juno"], "")).toEqual(["juno"]);
  });
});

describe("insertMention", () => {
  it("replaces the partial word and leaves the caret after a space", () => {
    expect(insertMention("hi @ju", 3, 6, "juno")).toEqual({ text: "hi @juno ", caret: 9 });
    expect(insertMention("@ju what's up", 0, 3, "juno")).toEqual({
      text: "@juno what's up",
      caret: 6,
    });
  });
});
