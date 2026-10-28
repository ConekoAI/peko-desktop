import { useChannelMembers } from "../hooks/useChannels";
import { Globe, Loader2, User } from "lucide-react";
import { usePekoDirectory } from "../hooks/usePekoDirectory";
import PekoAvatar from "./peko/PekoAvatar";
import RuntimeBadge from "./RuntimeBadge";
import type { MemberProvenance } from "../types";

/**
 * PR-1 read-only member list for a single channel. Renders the
 * principals currently in the channel, grouped into "Local" (on
 * this runtime) and "Remote" (on a peer runtime).
 *
 * PR-3b / P1.2 attribution: when the IPC returns `memberProvenance`
 * (parallel array of `{principal, runtimeId}` rows), the list is
 * split by `runtimeId === null` so remote members are visibly
 * attributable. Pre-PR-3b runtimes omit the field and every member
 * is bucketed as local — preserves the PR-1 fallback behavior.
 *
 * Empty provenance ⇒ every member is local. Empty `members` ⇒ the
 * "No members yet" empty state.
 */
export default function MemberList({
  channelId,
  runtimeId,
}: {
  channelId: string;
  runtimeId?: string;
}) {
  const { data, isLoading } = useChannelMembers(channelId, runtimeId);
  const directory = usePekoDirectory();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading members…
      </div>
    );
  }

  const members = data?.members ?? [];
  const provenance = data?.memberProvenance;

  if (members.length === 0) {
    return (
      <div className="p-4 text-xs text-fg-subtle">
        No members yet.
      </div>
    );
  }

  // Build a lookup so we can tell local vs remote when attribution
  // is present. If attribution is missing, fall back to the PR-1
  // "everyone is local" rendering for back-compat.
  const provenanceByPrincipal = new Map<string, MemberProvenance>();
  provenance?.forEach((row) => provenanceByPrincipal.set(row.principal, row));

  const local: string[] = [];
  const remote: MemberProvenance[] = [];
  for (const principal of members) {
    const row = provenanceByPrincipal.get(principal);
    if (row && row.runtimeId !== null) {
      remote.push(row);
    } else {
      local.push(principal);
    }
    // If `row` is undefined (attribution missing for this principal),
    // we treat the principal as local — matches the PR-1 fallback.
  }

  const hasAttribution = provenanceByPrincipal.size > 0;

  return (
    <div className="p-3">
      <section data-testid="channel-members-local">
        <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Local
        </div>
        <ul className="space-y-1">
          {local.map((did) => {
            const who = directory.resolve(did);
            return (
              <li
                key={did}
                title={did}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-soft hover:bg-surface-sunken"
                data-testid={`channel-member-${did}`}
              >
                {who.peko ? (
                  <PekoAvatar peko={who.peko} size="sm" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
                    <User className="h-3.5 w-3.5 text-fg-muted" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{who.label}</span>
                <RuntimeBadge runtimeId="local" />
              </li>
            );
          })}
        </ul>
      </section>

      {remote.length > 0 && (
        <section className="mt-3" data-testid="channel-members-remote">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            Remote
          </div>
          <ul className="space-y-1">
            {remote.map((row) => (
              <li
                key={row.principal}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-soft hover:bg-surface-sunken"
                data-testid={`channel-member-${row.principal}`}
              >
                <Globe className="h-4 w-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate font-medium" title={row.principal}>
                  {directory.resolve(row.principal).label}
                </span>
                <RuntimeBadge
                  runtimeId={row.runtimeId ?? "local"}
                  showLabel={hasAttribution}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}