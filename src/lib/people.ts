import type { PersonDm } from "./api";

/**
 * What a DM with a person is called (runtime ADR-095 D6): the name their
 * computer gave, else their PekoHub account ID.
 */
export function personLabel(p: Pick<PersonDm, "name" | "account">): string {
  return p.name ?? p.account;
}
