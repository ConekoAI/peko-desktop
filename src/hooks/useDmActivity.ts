/**
 * Keeps what you have not read in step with the engine, so a peko's own
 * initiative (reminders, check-ins, approval requests) is never missed:
 * an unread count per conversation, the total on the dock icon, and an
 * OS notification when a peko writes while you aren't looking at its
 * chat.
 *
 * The read mark is the engine's (runtime ADR-108 D5): the counts are
 * read from it every few seconds and whenever a peko writes, so reading
 * on your phone or another computer clears them here; and looking at a
 * chat here tells the engine, so your phone is not told about it.
 *
 * Every local peko's DM is watched for new rows, and a remote peko's
 * thread (the DM this computer holds with it) the same way.
 *
 * Mounted once, in the layout. Desktop-only: it reads the same
 * `principal_log` / `principal_log_watch` the chat does.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { principalLog, principalLogWatch, readState } from "../lib/api";
import {
  adoptLegacyReadMarks,
  isFromPerson,
  markSeen,
  setReadState,
  setReadStateRefresher,
  unreadKey,
  useGroupUnread,
  useUnreadCounts,
  type KnownPeko,
} from "../lib/unread";
import { newestLogCursor, useCallerSubject, usePrincipals } from "./usePrincipals";
import { useRemotePrincipals } from "./useRemotePrincipals";

/** A DM row as the watch delivers it. */
interface Row {
  id?: string;
  sender?: unknown;
  timestamp?: string;
  text?: string;
}

/** The unread key of the peko whose chat is on screen, if any. */
function activePeko(pathname: string, runtimeId: unknown): string | null {
  const m = /^\/chat\/([^/?#]+)/.exec(pathname);
  if (!m) return null;
  return unreadKey(decodeURIComponent(m[1]), typeof runtimeId === "string" ? runtimeId : null);
}

let permission: Promise<boolean> | null = null;

/** Ask once for permission; later calls reuse the answer. */
function canNotify(): Promise<boolean> {
  permission ??= (async () => {
    try {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();
  return permission;
}

async function notify(peko: string, text: string) {
  if (!(await canNotify())) return;
  const body = text.replace(/\s+/g, " ").trim();
  sendNotification({ title: peko, body: body.length > 160 ? `${body.slice(0, 157)}…` : body });
}

/** How often the read state is asked for (ms). */
const READ_STATE_MS = 5000;

/**
 * Follow one peko's thread from its newest row on. A row from a person
 * (you) means you have seen the thread up to it. A row from the peko is
 * seen at once when its chat is on screen; otherwise it is announced and
 * the counts are read again.
 */
function follow(opts: {
  key: string;
  title: string;
  isActive: () => boolean;
  load: () => Promise<{ messages: { id: string; sender?: unknown; timestamp: string; text?: string }[] }>;
  watch: (cursor: string | null, onRow: (raw: unknown) => void) => Promise<() => void>;
  isCancelled: () => boolean;
  stops: (() => void)[];
  refresh: () => void;
}) {
  const { key, title } = opts;
  const since = Date.now();
  const seen = new Set<string>();
  const onRow = (raw: unknown) => {
    const row = raw as Row;
    if (!row.timestamp) return;
    // Live rows and their later replays carry different ids.
    const id = `${row.timestamp}|${row.text ?? ""}`;
    if (seen.has(id)) return;
    seen.add(id);
    if (isFromPerson(row.sender) || (opts.isActive() && document.hasFocus())) {
      // You wrote, or you are looking at it: seen up to here.
      markSeen(key, row.timestamp);
      return;
    }
    opts.refresh();
    // A replay of something from before this window opened is not news.
    if (Date.parse(row.timestamp) >= since - 60_000) void notify(title, row.text ?? "");
  };

  void (async () => {
    try {
      const page = await opts.load();
      if (opts.isCancelled()) return;
      for (const m of page.messages) seen.add(`${m.timestamp}|${m.text ?? ""}`);
      const stop = await opts.watch(newestLogCursor(page.messages), onRow);
      if (opts.isCancelled()) stop();
      else opts.stops.push(stop);
    } catch {
      // A peko with no thread yet answers not_found; nothing to follow.
    }
  })();
}

export function useDmActivity() {
  const { data: principals } = usePrincipals();
  const caller = useCallerSubject();
  const { data: remotes } = useRemotePrincipals();
  const { pathname, search } = useLocation();
  const counts = useUnreadCounts();
  const groupCounts = useGroupUnread();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["read-state"] });

  // Read inside watch callbacks without restarting the watches.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activePeko(pathname, (search as Record<string, unknown>)?.runtimeId);

  const names = (principals ?? []).map((p) => p.name);
  const namesKey = names.join("|");
  const remoteKeys = (remotes ?? []).map((r) => unreadKey(r.principalName, r.runtimeId));
  const remotesKey = remoteKeys.join("|");

  // The engine's read state: every few seconds, and when asked.
  const { data: rows } = useQuery({
    queryKey: ["read-state"],
    queryFn: readState,
    refetchInterval: READ_STATE_MS,
    staleTime: 0,
  });
  const known: KnownPeko[] = [
    ...(principals ?? []).map((p) => ({ key: p.name, localId: p.localId, hubId: p.hubId })),
    ...(remotes ?? []).map((r) => ({
      key: unreadKey(r.principalName, r.runtimeId),
      hubId: r.hubId,
    })),
  ];
  const knownKey = known.map((p) => `${p.key}:${p.localId ?? ""}:${p.hubId ?? ""}`).join("|");
  useEffect(() => {
    setReadStateRefresher(refresh);
    return () => setReadStateRefresher(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!rows || !principals || !remotes) return;
    // Once: the positions this window used to keep go to the engine.
    if (!adoptLegacyReadMarks(rows, known)) setReadState(rows, known);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, knownKey]);

  // You are looking at a peko's chat: it is read. Also when the window
  // comes back into focus, and when something new is counted for it.
  const activeCount = activeRef.current ? (counts[activeRef.current] ?? 0) : 0;
  useEffect(() => {
    const read = () => {
      const active = activeRef.current;
      if (active && document.hasFocus()) markSeen(active);
    };
    if (activeCount > 0) read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [pathname, search, activeCount]);

  // One watch per local peko.
  useEffect(() => {
    if (names.length === 0) return;
    let cancelled = false;
    const stops: (() => void)[] = [];
    for (const name of names) {
      follow({
        key: name,
        title: name,
        isActive: () => activeRef.current === name,
        load: () => principalLog({ name, peer: caller, limit: 50 }),
        watch: (cursor, onRow) => principalLogWatch(name, caller, cursor, onRow),
        isCancelled: () => cancelled,
        stops,
        refresh,
      });
    }
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, caller]);

  // One watch per remote peko: its thread is the DM this computer's
  // runtime holds with it (runtime ADR-090), watched the same way.
  useEffect(() => {
    if (!remotes || remotes.length === 0) return;
    let cancelled = false;
    const stops: (() => void)[] = [];
    for (const remote of remotes) {
      const key = unreadKey(remote.principalName, remote.runtimeId);
      follow({
        key,
        title: remote.displayName || remote.principalName,
        isActive: () => activeRef.current === key,
        load: () => principalLog({ name: remote.principalName, runtimeId: remote.runtimeId, limit: 50 }),
        watch: (cursor, onRow) =>
          principalLogWatch(remote.principalName, undefined, cursor, onRow, remote.runtimeId),
        isCancelled: () => cancelled,
        stops,
        refresh,
      });
    }
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotesKey]);

  // The total on the dock icon.
  const total = [...Object.values(counts), ...Object.values(groupCounts)].reduce((a, b) => a + b, 0);
  useEffect(() => {
    void getCurrentWindow()
      .setBadgeCount(total > 0 ? total : undefined)
      .catch(() => {});
  }, [total]);
}
