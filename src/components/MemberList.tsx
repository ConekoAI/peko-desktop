import { useChannelInfo, useChannelMembers, useSetChannelWake } from "../hooks/useChannels";
import type { WakePolicy } from "../lib/api";
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
  const { data: info } = useChannelInfo(channelId);
  // Wake policy per peko hosted here, by local id (groups only: a DM
  // always wakes on human posts).
  const wakeOf = new Map(
    info?.kind === "group" ? info.pekos.map((p) => [p.localId, p] as const) : [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-fg-subtle">
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
            const wakePeko = wakeOf.get(did.replace(/^principal:(local:)?/, ""));
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
                {wakePeko ? (
                  <WakePicker channelId={channelId} pekoName={wakePeko.name} wake={wakePeko.wake} />
                ) : (
                  <RuntimeBadge runtimeId="local" />
                )}
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
const WAKE_OPTIONS: { value: WakePolicy; label: string; hint: string }[] = [
  { value: "human", label: "Every message", hint: "Replies to every message from a person" },
  { value: "mention", label: "@mentions", hint: "Replies when someone @mentions it" },
  { value: "off", label: "Never", hint: "Reads along; replies only when it checks in" },
];

/**
 * What starts a turn for one of your pekos in this group (ADR-082):
 * every human message, @mentions (the default), or nothing. Saved as
 * soon as it changes; a refusal (not your peko) shows inline.
 */
function WakePicker({
  channelId,
  pekoName,
  wake,
}: {
  channelId: string;
  pekoName: string;
  wake: WakePolicy;
}) {
  const setWake = useSetChannelWake(channelId);
  const current = setWake.isPending ? setWake.variables?.wake ?? wake : wake;
  return (
    <span className="flex shrink-0 flex-col items-end">
      <select
        aria-label={`When ${pekoName} replies`}
        value={current}
        disabled={setWake.isPending}
        title={WAKE_OPTIONS.find((o) => o.value === current)?.hint}
        onChange={(e) => setWake.mutate({ pekoName, wake: e.target.value as WakePolicy })}
        className="rounded-md border border-line bg-surface-card px-1.5 py-0.5 text-[11px] text-fg-soft outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-60"
      >
        {WAKE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {setWake.error && (
        <span role="alert" className="mt-0.5 max-w-[12rem] truncate text-[10px] text-danger" title={setWake.error.message}>
          {setWake.error.message}
        </span>
      )}
    </span>
  );
}
