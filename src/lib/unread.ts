/**
 * Unread peko messages, per peko. A peko's DM is where its own
 * initiative shows up (reminders, check-ins, approval requests), so the
 * sidebar counts what it wrote since you last looked.
 *
 * `readUpTo` (the newest message time you have seen, per peko) survives
 * restarts in localStorage; counts are rebuilt from the thread on start
 * and then kept live.
 */
import { useSyncExternalStore } from "react";

const READ_KEY = "peko.readUpTo";

type Counts = Record<string, number>;

/**
 * The key a peko's count and read mark live under: its name for a peko
 * on this computer, its runtime and name for a remote one, so a remote
 * peko never shares a count with a local peko of the same name.
 */
export function unreadKey(name: string, runtimeId?: string | null): string {
  return runtimeId && runtimeId !== "local" ? `${runtimeId}#${name}` : name;
}

let counts: Counts = {};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function loadRead(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** The newest message time you have seen in `peko`'s DM (ISO), if any. */
export function readUpTo(peko: string): string | undefined {
  return loadRead()[peko];
}

/** You have seen `peko`'s DM up to `at` (ISO; default now). */
export function markRead(peko: string, at: string = new Date().toISOString()) {
  const read = loadRead();
  if (isLater(at, read[peko])) {
    read[peko] = at;
    localStorage.setItem(READ_KEY, JSON.stringify(read));
  }
  if (counts[peko]) {
    counts = { ...counts, [peko]: 0 };
    emit();
  }
}

/** Set `peko`'s count (rebuilt from its thread). */
export function setUnread(peko: string, n: number) {
  if ((counts[peko] ?? 0) === n) return;
  counts = { ...counts, [peko]: n };
  emit();
}

/** One more unread message from `peko`. */
export function addUnread(peko: string) {
  counts = { ...counts, [peko]: (counts[peko] ?? 0) + 1 };
  emit();
}

/** Forget a peko (removed). */
export function forgetPeko(peko: string) {
  const read = loadRead();
  delete read[peko];
  localStorage.setItem(READ_KEY, JSON.stringify(read));
  if (peko in counts) {
    const { [peko]: _gone, ...rest } = counts;
    counts = rest;
    emit();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Unread counts by peko name. */
export function useUnreadCounts(): Counts {
  return useSyncExternalStore(subscribe, () => counts);
}

/** For tests. */
export function resetUnread() {
  counts = {};
  localStorage.removeItem(READ_KEY);
  emit();
}

/**
 * Whether a DM row was written by a person (you, or another user) rather
 * than the peko. Rows carry the sender as `kind:id` or `{ kind, id }`.
 */
export function isFromPerson(sender: unknown): boolean {
  const kind =
    typeof sender === "string"
      ? sender.split(":")[0]
      : sender && typeof sender === "object"
        ? (sender as { kind?: string }).kind
        : undefined;
  return kind === "user" || kind === "visitor";
}

/** Whether `at` is later than `than` (both ISO times). */
export function isLater(at: string, than: string | undefined): boolean {
  if (!than) return true;
  return Date.parse(at) > Date.parse(than);
}
