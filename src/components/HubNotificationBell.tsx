import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { currentLocale, t as translate } from "../i18n";
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
  if (minutes < 1) return translate("hub.notifications.justNow");
  if (minutes < 60) return translate("hub.notifications.minutesAgo", { count: minutes });
  if (minutes < 24 * 60) {
    return translate("hub.notifications.hoursAgo", { count: Math.round(minutes / 60) });
  }
  return new Date(at).toLocaleDateString(currentLocale());
}

/**
 * PekoHub notifications in the app rail — a peko offered to you, a new
 * sign-in, a moderator's action (the Hub sends no email). Shown only while
 * signed in to PekoHub. Opening the list marks what it shows as read; an
 * item opens its page on the PekoHub website, where it is acted on.
 */
export default function HubNotificationBell() {
  const { t } = useTranslation();
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
        aria-label={
          unread > 0
            ? t("hub.notifications.labelUnread", { count: unread })
            : t("hub.notifications.label")
        }
        title={t("hub.notifications.label")}
        className="relative flex h-11 w-11 items-center justify-center rounded-[22px] bg-surface-sunken text-fg-soft transition-all duration-200 hover:rounded-xl hover:bg-brand hover:text-white"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="count-badge absolute -bottom-1 -right-1 ring-[3px] ring-surface-rail">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("hub.notifications.label")}
          className="popover absolute bottom-0 left-full z-50 ml-3 w-80"
        >
          <div className="eyebrow px-2.5 pb-1.5 pt-2">PekoHub</div>
          {list.isError ? (
            <p className="px-3 py-4 text-sm text-fg-muted">{t("hub.notifications.unreachable")}</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-fg-muted">{t("hub.notifications.empty")}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    role="menuitem"
                    onClick={() => openItem(item)}
                    className={[
                      "w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-sunken",
                      fresh.has(item.id) ? "bg-brand-soft" : "",
                    ].join(" ")}
                  >
                    <p className="text-sm text-fg">{item.text}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{ago(item.createdAt)}</p>
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
