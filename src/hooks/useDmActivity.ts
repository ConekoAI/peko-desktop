/**
 * Watches every local peko's DM for messages the peko writes, so its own
 * initiative (reminders, check-ins, approval requests) is never missed:
 * an unread count per peko, the total on the dock icon, and an OS
 * notification when a peko writes while you aren't looking at its chat.
 * A remote peko writes only in reply; a reply that lands after you've
 * left its chat (the backend's `remote-reply` event) counts the same way.
 *
 * Mounted once, in the layout. Desktop-only: it reads the same
 * `principal_log` / `principal_log_watch` the chat does.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { principalLog, principalLogWatch } from "../lib/api";
import {
  addUnread,
  forgetPeko,
  isFromPerson,
  isLater,
  markRead,
  readUpTo,
  setUnread,
  unreadKey,
  useUnreadCounts,
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

/** A recorded remote reply, as the backend announces it. */
interface RemoteReply {
  runtimeId: string;
  name: string;
  text: string;
  timestamp: string;
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

export function useDmActivity() {
  const { data: principals } = usePrincipals();
  const caller = useCallerSubject();
  const { data: remotes } = useRemotePrincipals();
  const { pathname, search } = useLocation();
  const counts = useUnreadCounts();

  // Read inside watch callbacks without restarting the watches.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activePeko(pathname, (search as Record<string, unknown>)?.runtimeId);

  const names = (principals ?? []).map((p) => p.name);
  const namesKey = names.join("|");
  const remoteKeys = (remotes ?? []).map((r) => unreadKey(r.principalName, r.runtimeId));
  const remotesKey = remoteKeys.join("|");

  // You are looking at a peko's chat: it is read. Also when the window
  // comes back into focus.
  useEffect(() => {
    const read = () => {
      const active = activeRef.current;
      if (active && document.hasFocus()) markRead(active);
    };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [pathname, search]);

  // One watch per local peko.
  useEffect(() => {
    if (names.length === 0) return;
    let cancelled = false;
    const stops: (() => void)[] = [];

    for (const name of names) {
      const seen = new Set<string>();
      const onRow = (raw: unknown) => {
        const row = raw as Row;
        if (!row.timestamp) return;
        // Live rows and their later replays carry different ids.
        const key = `${row.timestamp}|${row.text ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (!isLater(row.timestamp, readUpTo(name))) return;
        if (isFromPerson(row.sender)) {
          // You (or someone you share the DM with) wrote: seen up to here.
          markRead(name, row.timestamp);
          return;
        }
        if (activeRef.current === name && document.hasFocus()) {
          markRead(name, row.timestamp);
          return;
        }
        addUnread(name);
        void notify(name, row.text ?? "");
      };

      void (async () => {
        try {
          const page = await principalLog({ name, peer: caller, limit: 50 });
          if (cancelled) return;
          const read = readUpTo(name);
          const newest = page.messages[page.messages.length - 1]?.timestamp;
          if (!read) {
            // First sight of this peko: its history is not news.
            if (newest) markRead(name, newest);
          } else {
            setUnread(
              name,
              page.messages.filter((m) => !isFromPerson(m.sender) && isLater(m.timestamp, read))
                .length,
            );
          }
          for (const m of page.messages) seen.add(`${m.timestamp}|${m.text ?? ""}`);
          const stop = await principalLogWatch(name, caller, newestLogCursor(page.messages), onRow);
          if (cancelled) stop();
          else stops.push(stop);
        } catch {
          // A peko with no thread yet answers not_found; nothing to count.
        }
      })();
    }

    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, caller]);

  // Remote pekos: counts rebuilt from their saved history, then each
  // recorded reply as it lands.
  useEffect(() => {
    if (!remotes || remotes.length === 0) return;
    let cancelled = false;
    for (const remote of remotes) {
      const key = unreadKey(remote.principalName, remote.runtimeId);
      void (async () => {
        try {
          const page = await principalLog({
            name: remote.principalName,
            runtimeId: remote.runtimeId,
            limit: 50,
          });
          if (cancelled) return;
          const read = readUpTo(key);
          const newest = page.messages[page.messages.length - 1]?.timestamp;
          if (!read) {
            if (newest) markRead(key, newest);
          } else {
            setUnread(
              key,
              page.messages.filter((m) => !isFromPerson(m.sender) && isLater(m.timestamp, read))
                .length,
            );
          }
        } catch {
          // No history yet: nothing to count.
        }
      })();
    }
    const unlisten = listen<RemoteReply>("remote-reply", ({ payload }) => {
      const key = unreadKey(payload.name, payload.runtimeId);
      if (activeRef.current === key && document.hasFocus()) {
        markRead(key, payload.timestamp);
        return;
      }
      addUnread(key);
      void notify(payload.name, payload.text);
    });
    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotesKey]);

  // Pekos that are gone take their counts with them.
  useEffect(() => {
    if (!principals || !remotes) return;
    for (const key of Object.keys(counts)) {
      if (!names.includes(key) && !remoteKeys.includes(key)) forgetPeko(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, remotesKey]);

  // The total on the dock icon.
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  useEffect(() => {
    void getCurrentWindow()
      .setBadgeCount(total > 0 ? total : undefined)
      .catch(() => {});
  }, [total]);
}
