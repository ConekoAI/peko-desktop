import { useState, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Search, Hash, Loader2, Plus } from "lucide-react";
import { useChannels } from "../hooks/useChannels";
import { usePrincipals } from "../hooks/usePrincipals";
import RuntimeBadge from "./RuntimeBadge";

/**
 * PR-1 read-only channel sidebar. Mirrors `PrincipalSidebar.tsx`:
 * `w-60` surface, search box, runtime-grouped list, per-row active
 * indicator, footer CTAs (PR-3 adds the "New channel" modal behind
 * `Plus`).
 *
 * The list is built by `useChannels` which fans out across the
 * local principals and dedupes by `channelId`. For PR-1 every
 * channel lives on the local runtime (no remote-join yet); the
 * group-by-runtime structure is in place so PR-3 can flip on the
 * runtime attribution without changing the row component.
 */
export default function ChannelSidebar({
  onCreateClick,
}: {
  onCreateClick?: () => void;
} = {}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const channelId =
    (params as Record<string, string | undefined>).channelId ?? "";
  const [search, setSearch] = useState("");

  const { data: principals } = usePrincipals();
  const principalNames = useMemo(
    () => (principals ?? []).map((p) => p.name),
    [principals],
  );

  const { data: channels, isLoading } = useChannels(principalNames);

  const filtered = useMemo(() => {
    if (!channels) return [];
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter((c) => c.channelId.toLowerCase().includes(q));
  }, [channels, search]);

  function handleSelect(
    selectedId: string,
    runtimeId: string,
    memberPrincipals: string[],
  ) {
    // PR-2a: stamp `sender` from the first member principal so the
    // composer is wired without forcing the user to edit the URL.
    // PR-3 will replace this with a proper "post as" selector that
    // surfaces the choice when the user is a member of the channel
    // via multiple principals.
    const sender = memberPrincipals[0];
    navigate({
      to: "/channels/$channelId",
      params: { channelId: selectedId },
      search: sender ? { runtimeId, sender } : { runtimeId },
    });
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          Channels
        </h3>
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
          Multi-principal chat
        </p>
      </div>

      <div className="border-b border-slate-200 p-2 dark:border-slate-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            data-testid="channel-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            <span className="text-xs text-slate-400">Loading…</span>
          </div>
        ) : filtered.length > 0 ? (
          <div className="space-y-1">
            {filtered.map((c) => {
              const active = c.channelId === channelId;
              return (
                <button
                  key={c.channelId}
                  onClick={() =>
                    handleSelect(
                      c.channelId,
                      c.runtimeId || "local",
                      c.memberPrincipals,
                    )
                  }
                  data-testid={`channel-row-${c.channelId}`}
                  className={[
                    "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  ].join(" ")}
                >
                  <Hash className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {c.channelId}
                  </span>
                  <RuntimeBadge runtimeId={c.runtimeId || "local"} />
                  {active && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="px-2 py-8 text-center text-xs text-slate-400 dark:text-slate-600"
            data-testid="channel-empty"
          >
            {search.trim()
              ? "No channels match"
              : "No channels yet. Create one with `peko channel create`."}
          </div>
        )}
      </div>

      {onCreateClick && (
        <div className="border-t border-slate-200 p-2 dark:border-slate-800">
          <button
            type="button"
            onClick={onCreateClick}
            disabled
            title="Available in PR-3"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-400 transition-colors dark:text-slate-600"
            data-testid="channel-new"
          >
            <Plus className="h-4 w-4" />
            <span>New channel</span>
          </button>
        </div>
      )}
    </div>
  );
}