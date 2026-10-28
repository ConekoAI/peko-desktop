import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Search, Hash, Loader2, Plus } from "lucide-react";
import { useChannelInfo, useChannels } from "../hooks/useChannels";
import { usePrincipals } from "../hooks/usePrincipals";
import RuntimeBadge from "./RuntimeBadge";

/**
 * Channel sidebar. Mirrors `PrincipalSidebar.tsx`: `w-60` surface,
 * search box, runtime-grouped list, per-row active indicator,
 * footer CTAs. PR-3 wires the "+ New channel" button to a layout-
 * level `ChannelCreateModal` (matches the `CreatePrincipalModal`
 * hoist pattern at `Layout.tsx:222`).
 *
 * The list is built by `useChannels` which fans out across the
 * local principals and dedupes by `channelId`. For PR-1 every
 * channel lived on the local runtime; PR-3's receiver-bootstrap
 * path (`ChannelStore::join_remote`) lets the sidebar also surface
 * channels that were invited in from a peer runtime. The runtime-
 * badge column already handles the runtime attribution so PR-3
 * doesn't need to touch the row component.
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
  const qc = useQueryClient();

  // Search by the group's name (once its info has loaded) or its id.
  const filtered = useMemo(() => {
    if (!channels) return [];
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter((c) => {
      const name = qc.getQueryData<{ name?: string }>(["channel-info", c.channelId])?.name ?? "";
      return name.toLowerCase().includes(q) || c.channelId.toLowerCase().includes(q);
    });
  }, [channels, search, qc]);

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
    <div className="flex h-full w-60 flex-col border-r border-line bg-surface-raised">
      <div className="border-b border-line p-3">
        <h3 className="truncate text-sm font-semibold text-fg">
          Groups
        </h3>
      </div>

      <div className="border-b border-line p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-fg-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="w-full rounded-lg border border-line bg-surface-card py-1.5 pl-8 pr-3 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            data-testid="channel-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />
            <span className="text-xs text-fg-subtle">Loading…</span>
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
                      ? "bg-brand-soft text-brand"
                      : "text-fg-soft hover:bg-surface-sunken",
                  ].join(" ")}
                >
                  <Hash className="h-4 w-4 shrink-0 text-fg-subtle" />
                  <GroupName channelId={c.channelId} />
                  {c.runtimeId && c.runtimeId !== "local" && (
                    <RuntimeBadge runtimeId={c.runtimeId} />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="px-2 py-8 text-center text-xs text-fg-subtle"
            data-testid="channel-empty"
          >
            {search.trim()
              ? "No groups match"
              : "No groups yet."}
          </div>
        )}
      </div>

      {onCreateClick && (
        <div className="border-t border-line p-2">
          <button
            type="button"
            onClick={onCreateClick}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
            data-testid="channel-new"
          >
            <Plus className="h-4 w-4" />
            <span>New group</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** A group's name; its id until the name loads (or if it has none). */
function GroupName({ channelId }: { channelId: string }) {
  const { data: info } = useChannelInfo(channelId);
  return info?.name ? (
    <span className="min-w-0 flex-1 truncate">{info.name}</span>
  ) : (
    <span className="min-w-0 flex-1 truncate font-mono text-xs">{channelId}</span>
  );
}
