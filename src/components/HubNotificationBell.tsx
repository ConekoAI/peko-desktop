import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePekohubBundle } from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";
import {
  configuredHubUrl,
  hubNotifications,
  markHubNotificationsRead,
  type HubNotification,
  type HubNotificationList,
} from "../lib/api";

/** How often the bell asks PekoHub for news while signed in. */
const POLL_MS = 60_000;

/** "5 min ago", "3 h ago", or the date. */
function ago(at: string): string {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * PekoHub notifications in the app rail — a peko offered to you, a new
 * sign-in, a moderator's action (the Hub sends no email). Shown only while
 * signed in to PekoHub. Opening the list marks what it shows as read; an
 * item opens its page on the PekoHub website, where it is acted on.
 */
export default function HubNotificationBell() {
  const { data: settings } = useSettings();
  const { data: bundle } = usePekohubBundle();
  const queryClient = useQueryClient();
  const hub = configuredHubUrl(settings);
  const signedIn = Boolean(bundle);
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const key = ["hub-notifications", hub];

  const list = useQuery({
    queryKey: key,
    queryFn: () => hubNotifications(hub),
    enabled: signedIn,
    refetchInterval: POLL_MS,
    retry: false,
  });
  const items = list.data?.notifications ?? [];
  const unread = list.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!signedIn) return null;

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const unreadIds = items.filter((item) => !item.readAt).map((item) => item.id);
    setFresh(new Set(unreadIds));
    if (unreadIds.length === 0) return;
    const now = new Date().toISOString();
    queryClient.setQueryData<HubNotificationList>(key, (data) =>
      data && {
        unread: Math.max(0, data.unread - unreadIds.length),
        notifications: data.notifications.map((item) =>
          unreadIds.includes(item.id) ? { ...item, readAt: now } : item,
        ),
      },
    );
    markHubNotificationsRead(hub, unreadIds).catch(() => {
      void queryClient.invalidateQueries({ queryKey: key });
    });
  }

  function openItem(item: HubNotification) {
    setOpen(false);
    if (item.url) void openUrl(item.url);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `PekoHub notifications, ${unread} unread` : "PekoHub notifications"}
        title="PekoHub notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-fg-muted transition-all hover:bg-surface-sunken hover:text-fg-soft"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="PekoHub notifications"
          className="absolute bottom-0 left-full z-50 ml-2 w-80 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">PekoHub</div>
          {list.isError ? (
            <p className="px-3 py-4 text-sm text-slate-500">Couldn&apos;t reach PekoHub.</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    role="menuitem"
                    onClick={() => openItem(item)}
                    className={[
                      "w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900",
                      fresh.has(item.id) ? "bg-indigo-50 dark:bg-indigo-950/40" : "",
                    ].join(" ")}
                  >
                    <p className="text-sm text-slate-800 dark:text-slate-200">{item.text}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{ago(item.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
