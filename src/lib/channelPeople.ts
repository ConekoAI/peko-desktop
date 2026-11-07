import type { ChannelPerson } from "./api";

/**
 * Who a channel member is, by any form they appear as: their address, or
 * one of its aliases (a remote peko's `did:key`, a person's Hub address).
 */
export function findPerson(
  actor: string,
  people: ChannelPerson[] | undefined,
): ChannelPerson | null {
  if (!people) return null;
  return people.find((p) => p.address === actor || p.aliases.includes(actor)) ?? null;
}

/** Names of the group's pekos one can `@mention`, here or on other computers. */
export function mentionablePekos(people: ChannelPerson[] | undefined): string[] {
  const names: string[] = [];
  for (const p of people ?? []) {
    if (p.kind === "principal" && p.name && !names.includes(p.name)) names.push(p.name);
  }
  return names;
}

/**
 * A post's `@<address>` mentions as `@name`: pekos write each other's
 * addresses (`@principal:hub:<id>`); people read names.
 */
export function namedMentions(text: string, people: ChannelPerson[] | undefined): string {
  if (!people?.length || !text.includes("@")) return text;
  return text.replace(/@((?:principal|user|peko):[\w:.@-]+[\w-])/g, (whole, address: string) => {
    const candidate = address.startsWith("peko:") ? `principal:${address.slice(5)}` : address;
    const who = findPerson(candidate, people);
    return who?.name ? `@${who.name}` : whole;
  });
}
