/**
 * The model picked in the composer for each peko ("Peko's model" when
 * none). Kept in localStorage, so switching pekos — or restarting —
 * keeps each peko's pick. Keyed like unread counts (`unreadKey`): a
 * remote peko never shares a pick with a local peko of the same name.
 */
import { unreadKey } from "./unread";

const CHOICE_KEY = "peko.modelChoice";

function load(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The model picked for `name` (on `runtimeId`), or `null` for the peko's own. */
export function savedModelChoice(name: string, runtimeId?: string | null): string | null {
  return load()[unreadKey(name, runtimeId)] ?? null;
}

/** Remember `model` for `name` (on `runtimeId`); `null` goes back to the peko's own. */
export function saveModelChoice(name: string, runtimeId: string | null | undefined, model: string | null) {
  const choices = load();
  const key = unreadKey(name, runtimeId);
  if (model) choices[key] = model;
  else delete choices[key];
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choices));
  } catch {
    // A full or unavailable store only forgets the pick.
  }
}
