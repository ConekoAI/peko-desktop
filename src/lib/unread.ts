/**
 * What you have not read yet, per conversation.
 *
 * The read mark is kept on your computer by the engine (runtime ADR-108
 * D5), not in this window: reading on your phone or another computer
 * clears the count here, and reading here stops your phone being told.
 * This module holds the latest answer, tells the engine when you have
 * seen something, and remembers nothing itself.
 *
 * A peko's chat is counted under its name (see `unreadKey`); a DM with a
 * person and a group are counted under their channel id.
 */
import { useSyncExternalStore } from "react";

import { markRead as sendMarkRead, type ReadState } from "./api";

type Counts = Record<string, number>;

/** A peko as the app lists it, with the ids the engine knows it by. */
export interface KnownPeko {
  /** Its unread key (`unreadKey`). */
  key: string;
  /** A peko on this computer. */
  localId?: string | null;
  /** A peko elsewhere, or one of yours that is on PekoHub. */
  hubId?: string | null;
}

/**
 * The key a peko's count lives under: its name for a peko on this
 * computer, its runtime and name for a remote one, so a remote peko never
 * shares a count with a local peko of the same name.
 */
export function unreadKey(name: string, runtimeId?: string | null): string {
  return runtimeId && runtimeId !== "local" ? `${runtimeId}#${name}` : name;
}

/** Pekos and people: what the Chats list shows. */
let chats: Counts = {};
/** Groups, by channel id. */
let groups: Counts = {};
/** The conversation behind each chat key. */
let channels: Record<string, string> = {};
/** The newest time each conversation was reported seen from here. */
let sent: Record<string, string> = {};
/** Asks for the read state again; set by whoever fetches it. */
let refresh: () => void = () => {};

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function same(a: Counts, b: Counts): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** How the read state is asked for again after something was seen. */
export function setReadStateRefresher(fn: () => void) {
  refresh = fn;
}

/**
 * Take the engine's read state. A DM with a peko the app lists is filed
 * under that peko's key; a DM with a person and a group under their
 * channel id. A DM with a peko the app does not list is left out.
 */
export function setReadState(rows: ReadState[], pekos: KnownPeko[]) {
  const nextChats: Counts = {};
  const nextGroups: Counts = {};
  const nextChannels: Record<string, string> = {};
  for (const row of rows) {
    if (row.kind === "group") {
      nextChannels[row.channel] = row.channel;
      if (row.unread > 0) nextGroups[row.channel] = row.unread;
      continue;
    }
    let key: string | undefined;
    if (row.peerKind === "principal") {
      key = pekos.find(
        (p) =>
          (!!p.localId && p.localId === row.peerLocalId) ||
          (!!p.hubId && p.hubId === row.peerHubId),
      )?.key;
      if (!key) continue;
    } else {
      key = row.channel;
    }
    nextChannels[key] = row.channel;
    nextChannels[row.channel] = row.channel;
    if (row.unread > 0) nextChats[key] = row.unread;
  }
  channels = nextChannels;
  if (same(chats, nextChats) && same(groups, nextGroups)) return;
  chats = nextChats;
  groups = nextGroups;
  emit();
}

/** The conversation behind a chat key or channel id, once known. */
export function channelOf(key: string): string | undefined {
  return channels[key];
}

/**
 * You have seen this conversation up to `at` (ISO; default now). The
 * count drops at once, the engine is told, and through it your phone and
 * your other computers. Nothing is sent for a time already reported, or
 * for a conversation the engine has not listed yet.
 */
export function markSeen(key: string, at: string = new Date().toISOString()) {
  const channel = channels[key];
  if (!channel) return;
  if (chats[key] || chats[channel]) {
    const { [key]: _a, [channel]: _b, ...rest } = chats;
    chats = rest;
    emit();
  }
  if (groups[channel]) {
    const { [channel]: _gone, ...rest } = groups;
    groups = rest;
    emit();
  }
  if (!isLater(at, sent[channel])) return;
  sent[channel] = at;
  void sendMarkRead(channel, at)
    .catch(() => {
      // Not told: let the next look at this conversation try again.
      if (sent[channel] === at) delete sent[channel];
    })
    .finally(() => refresh());
}

/** Unread counts in the Chats list: pekos by key, people by channel id. */
export function useUnreadCounts(): Counts {
  return useSyncExternalStore(subscribe, () => chats);
}

/** Unread counts of groups, by channel id. */
export function useGroupUnread(): Counts {
  return useSyncExternalStore(subscribe, () => groups);
}

/**
 * Read positions this window kept before the engine did (`peko.readUpTo`
 * in localStorage: the newest time seen, per peko key). Read once, to
 * hand them over.
 */
const LEGACY_KEY = "peko.readUpTo";
const ADOPTED_KEY = "peko.readMarksAdopted";

/**
 * Hand this window's old read positions to the engine, once. Every
 * conversation the engine has no mark for is marked seen: up to the time
 * this window remembers for that peko, or up to now (what was already
 * there before the engine kept marks is not news). Conversations that
 * have a mark are left alone. Returns whether anything was sent.
 */
export function adoptLegacyReadMarks(rows: ReadState[], pekos: KnownPeko[]): boolean {
  if (localStorage.getItem(ADOPTED_KEY)) return false;
  let legacy: Record<string, string> = {};
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}") as Record<string, string>;
  } catch {
    legacy = {};
  }
  setReadState(rows, pekos);
  let any = false;
  for (const row of rows) {
    if (row.marked) continue;
    const key = Object.keys(channels).find((k) => channels[k] === row.channel && k !== row.channel);
    const remembered = key ? legacy[key] : undefined;
    markSeen(row.channel, remembered && !isNaN(Date.parse(remembered)) ? remembered : undefined);
    any = true;
  }
  localStorage.setItem(ADOPTED_KEY, "1");
  localStorage.removeItem(LEGACY_KEY);
  return any;
}

/** For tests. */
export function resetUnread() {
  chats = {};
  groups = {};
  channels = {};
  sent = {};
  refresh = () => {};
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(ADOPTED_KEY);
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
