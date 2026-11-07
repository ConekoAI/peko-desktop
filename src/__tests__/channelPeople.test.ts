import { describe, expect, it } from "vitest";
import { findPerson, mentionablePekos, namedMentions } from "../lib/channelPeople";
import type { ChannelPerson } from "../lib/api";

const people: ChannelPerson[] = [
  { address: "user:local:local", aliases: ["user:hub:6666", "user:local"], kind: "user", name: "Frank", you: true, here: true },
  { address: "principal:hub:b1ec", aliases: ["did:key:z6Mkii"], kind: "principal", name: "ada", you: false, here: false },
  { address: "principal:hub:9b3a", aliases: [], kind: "principal", name: "bix", you: false, here: false },
  { address: "user:hub:7777", aliases: [], kind: "user", name: "Gina", you: false, here: false },
];

describe("channel people", () => {
  it("finds a member by address or any alias", () => {
    expect(findPerson("did:key:z6Mkii", people)?.name).toBe("ada");
    expect(findPerson("user:hub:6666", people)?.you).toBe(true);
    expect(findPerson("user:hub:nobody", people)).toBeNull();
  });

  it("offers every peko in the group to mention, wherever it lives", () => {
    expect(mentionablePekos(people)).toEqual(["ada", "bix"]);
  });

  it("reads pekos' address mentions as names", () => {
    expect(
      namedMentions("done. @principal:hub:b1ec, please pull; @peko:hub:9b3a review. @Gina hi", people),
    ).toBe("done. @ada, please pull; @bix review. @Gina hi");
    expect(namedMentions("@principal:hub:unknown hello", people)).toBe("@principal:hub:unknown hello");
  });
});
