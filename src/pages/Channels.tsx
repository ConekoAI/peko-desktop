import { useEffect } from "react";
import { Hash, Plus } from "lucide-react";
import { useSearch } from "@tanstack/react-router";

/**
 * Channels landing page. The active channel list lives in
 * `ChannelSidebar` (mounted by `Layout`), so this page hosts an
 * empty-state hint when no channel is selected.
 *
 * P1.7 polish: the empty state now offers an in-app "+ New channel"
 * CTA. Reads `?newChannel=1` from the URL on mount and removes it
 * after dispatching — this lets the sidebar's "+ New channel"
 * button navigate to `/channels?newChannel=1` and open the layout-
 * level `ChannelCreateModal` without prop-drilling an opener
 * callback through the route tree.
 *
 * The CLI hint remains as a fallback for headless / scripted
 * workflows (tests, automation).
 */
export default function Channels() {
  const search = useSearch({ strict: false }) as { newChannel?: string };

  useEffect(() => {
    if (search.newChannel !== "1") return;
    // Dispatch a `CustomEvent` the layout-level modal listens for.
    // Using a synthetic event keeps the URL-side flag the source of
    // truth (no shared mutable state across mount boundaries) and
    // means a deep link to `/channels?newChannel=1` "just works".
    window.dispatchEvent(new CustomEvent("peko:open-channel-create"));
    // Strip the param so a refresh doesn't reopen the modal.
    const url = new URL(window.location.href);
    url.searchParams.delete("newChannel");
    window.history.replaceState({}, "", url.toString());
  }, [search.newChannel]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Hash className="h-10 w-10 text-slate-300 dark:text-slate-700" />
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300">
        Channels
      </h2>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Select a channel from the sidebar to start posting, or create
        a new one.
      </p>
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("peko:open-channel-create"));
        }}
        className="mt-1 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        data-testid="channels-empty-new-button"
      >
        <Plus className="h-4 w-4" />
        New channel
      </button>
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        Or via the CLI:{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
          peko channel create
        </code>
      </p>
    </div>
  );
}