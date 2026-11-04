import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import ChannelHeader from "../components/ChannelHeader";
import ChannelComposer from "../components/ChannelComposer";
import ChannelEventRow from "../components/ChannelEventRow";
import ChannelInviteModal from "../components/modals/ChannelInviteModal";
import ChannelLeaveConfirmModal from "../components/modals/ChannelLeaveConfirmModal";
import ChannelInviteToast, {
  type InviteToastItem,
} from "../components/ChannelInviteToast";
import {
  useChannel,
  useChannelMembers,
  useChannelLeave, LOCAL_USER } from "../hooks/useChannels";
import {
  useChannelEvents,
  useChannelEventsWatch,
  useChannelStreamInvalidator,
} from "../hooks/useChannelEvents";
import { useToastQueue } from "../hooks/useToastQueue";
import { usePrincipals } from "../hooks/usePrincipals";
import { isChannelForbidden } from "../lib/channelErrors";
import { groupHistoryOlder, personDms, personGroups } from "../lib/api";
import { personLabel } from "../lib/people";
import type { ChannelEvent } from "../types";

/**
 * Channel view. PR-1 read-only + PR-2a composer + PR-3
 * create/invite/leave surface.
 *
 * `useChannelStreamInvalidator` drives two concerns:
 *   1. invalidate `["channel-events", channelId]` on inbound events
 *      (auto-refresh)
 *   2. show a transient `ChannelInviteToast` when the runtime emits
 *      a `peko-stream` event whose inner `payload.payload.kind ===
 *      "channel_invite_received"` — the user's first signal that
 *      they were added to a remote channel.
 *
 * The PR-3 modals (Invite / Leave) hoist from this page so the
 * header buttons stay presentational. `useChannelLeave` is called
 * directly here (rather than from the modal) because the page is
 * the navigation-aware owner — on a successful leave it sends the
 * user back to `/channels`.
 */
export default function ChannelView() {
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false }) as {
    runtimeId?: string;
    sender?: string;
  };
  const navigate = useNavigate();
  const channelId =
    (params as Record<string, string | undefined>).channelId ?? "";
  const runtimeId = search.runtimeId;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // P1.6: toast queue replaces the single-slot state. Inbound invites
  // append to the tail; the head is rendered. The hook auto-dismisses
  // after 6s and rotates the head on dismiss.
  const inviteToastQueue = useToastQueue<InviteToastItem>();
  const inviteToast = inviteToastQueue.current;

  useChannelStreamInvalidator(channelId, runtimeId, (incomingChannelId) => {
    inviteToastQueue.enqueue({ channelId: incomingChannelId });
  });

  const {
    data: events,
    isLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = useChannelEvents(channelId, null, runtimeId);
  // PR-2b: kick off the long-lived `ChannelEventsWatch` subscription
  // for this channel. The runtime replays events from the start of
  // the log (since=null) then forwards live events via the
  // `peko-stream` Tauri event channel — `useChannelStreamInvalidator`
  // (above) is the listener half and invalidates the matching query
  // keys. The hook is best-effort: failures log a `console.warn`
  // and the page falls back to the `refetchInterval` polling path
  // baked into `useChannelEvents`.
  useChannelEventsWatch(channelId, null, runtimeId);
  const { data: detail } = useChannel(channelId, runtimeId);
  const { data: membersData } = useChannelMembers(channelId, runtimeId);
  const { data: principals } = usePrincipals();

  // Local membership: derived from `useChannelMembers` + the local
  // principal set. A local principal that matches a `ChannelMembers`
  // row means the user can post + invite + leave.
  const localPrincipals = principals ?? [];
  // Rosters name actors by id (`user:local`, `principal:<id>`), not by
  // peko name: compared with names, you never counted as a member.
  const memberSet = new Set(membersData?.members ?? []);
  const isMember = memberSet.has(LOCAL_USER);
  const isCreator = !!detail && localPrincipals.some(
    (p) => p.name === detail.creator,
  );

  const leaveMut = useChannelLeave(channelId, runtimeId);

  // Runtime ADR-092 D3: in a group you joined from another computer, this
  // copy goes back as far as it caught up; earlier messages come from the
  // group's home on request, and aren't stored here.
  const { data: joinedGroups } = useQuery({ queryKey: ["person-groups"], queryFn: personGroups });
  // Runtime ADR-095 D6: a DM with another person. No peko is in it; until
  // they accept, what you write stays on your computers.
  const { data: people } = useQuery({
    queryKey: ["person-dms"],
    queryFn: personDms,
    refetchInterval: 15_000,
  });
  const person = (people ?? []).find((p) => p.channelId === channelId) ?? null;
  const fromAnotherComputer = (joinedGroups ?? []).some((g) => g.channelId === channelId);
  const [older, setOlder] = useState<ChannelEvent[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  useEffect(() => {
    setOlder([]);
    setOlderDone(false);
    setOlderError(null);
  }, [channelId]);
  const shown = useMemo(() => [...older, ...(events ?? [])], [older, events]);
  const oldestId = useMemo(() => {
    for (const e of shown) {
      if (e.kind === "posted" && e.msg_id) return e.msg_id;
    }
    return null;
  }, [shown]);
  async function loadOlder() {
    if (!oldestId || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await groupHistoryOlder(channelId, oldestId);
      setOlder((prev) => [...page.events, ...prev]);
      if (!page.hasMore) setOlderDone(true);
    } catch (err) {
      setOlderError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [events?.length]);

  // Computed outside the JSX: the `isChannelForbidden` type guard
  // narrows `eventsError` to `never` in the generic branch.
  const eventsErrorMessage =
    eventsError == null
      ? null
      : eventsError instanceof Error
        ? eventsError.message
        : String(eventsError);

  function handleLeaveConfirm() {
    // You leave the group yourself; your pekos stay.
    leaveMut.mutate(
      { principalName: null },
      {
        onSuccess: () => {
          setLeaveOpen(false);
          navigate({ to: "/channels" });
        },
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      {person ? (
        <ChannelHeader
          channelId={channelId}
          runtimeId={runtimeId}
          isMember={isMember}
          title={personLabel(person)}
        />
      ) : (
        <ChannelHeader
          channelId={channelId}
          runtimeId={runtimeId}
          isMember={isMember}
          isCreator={isCreator}
          onInviteClick={() => setInviteOpen(true)}
          onLeaveClick={() => setLeaveOpen(true)}
        />
      )}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        data-testid="channel-events"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-fg-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading events…
          </div>
        ) : eventsError ? (
          isChannelForbidden(eventsError) ? (
            <div
              className="mx-auto my-6 max-w-md rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-warn"
              role="alert"
              aria-live="assertive"
              data-testid="channel-events-forbidden"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">
                    You aren&apos;t in this group.
                  </p>
                  <p className="mt-1 opacity-80">
                    Only members can read it. Ask a current
                    member to invite you — the invite mints your membership.
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <div
            className="mx-auto my-6 max-w-md rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-xs text-danger"
            role="alert"
            aria-live="assertive"
            data-testid="channel-events-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Couldn't load this group's messages.</p>
                <p className="mt-1 opacity-80">
                  {eventsErrorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => void refetchEvents()}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100"
                  data-testid="channel-events-retry"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            </div>
          </div>
          )
        ) : events && events.length > 0 ? (
          <>
            {fromAnotherComputer && oldestId && !olderDone && (
              <div className="mb-3 flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-sunken disabled:opacity-50"
                >
                  {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                  Load earlier messages
                </button>
                {olderError && <span className="text-xs text-danger">{olderError}</span>}
              </div>
            )}
            <ul className="space-y-3">
              {shown.map((e, i) => (
                <li key={i} data-testid="channel-event-row">
                  <ChannelEventRow event={e} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div
            className="mx-auto my-12 max-w-md text-center"
            data-testid="channel-events-empty"
          >
            <div className="mb-2 text-sm text-fg-muted">
              No events yet.
            </div>
            {person ? (
              <div className="text-xs text-fg-subtle">
                Say hello to <strong>{personLabel(person)}</strong>.
              </div>
            ) : (
              detail?.name && (
                <div className="text-xs text-fg-subtle">
                  Be the first to post in <strong>{detail.name}</strong>.
                </div>
              )
            )}
            {!isMember && !person && (
              <div className="mt-3 text-xs text-fg-subtle">
                Ask a current member to invite you, then return to
                this group to start posting.
              </div>
            )}
          </div>
        )}
      </div>

      {person?.waiting && (
        <div
          className="border-t border-line bg-surface-raised px-4 py-2 text-xs text-fg-subtle"
          data-testid="person-dm-waiting"
        >
          Waiting for {personLabel(person)} to accept. What you write here reaches them when they do.
        </div>
      )}
      {isMember || person ? (
        <ChannelComposer
          channelId={channelId}
          channelName={person ? personLabel(person) : detail?.name}
          runtimeId={runtimeId}
        />
      ) : (
        <div
          className="border-t border-line bg-surface-raised px-4 py-3 text-xs text-fg-muted"
          data-testid="channel-composer-no-sender"
        >
          You can read this group but not post in it.
        </div>
      )}

      <ChannelInviteModal
        open={inviteOpen}
        channel={channelId}
        detail={detail ?? null}
        members={membersData ?? null}
        onClose={() => setInviteOpen(false)}
      />

      <ChannelLeaveConfirmModal
        open={leaveOpen}
        channelId={channelId}
        channelName={detail?.name}
        // You leave as yourself; the creator is one of your pekos.
        isCreator={false}
        onConfirm={handleLeaveConfirm}
        onCancel={() => setLeaveOpen(false)}
      />

      {inviteToast && (
        <ChannelInviteToast
          item={inviteToast}
          runtimeId={runtimeId}
          pendingCount={inviteToastQueue.pendingCount}
          onDismiss={inviteToastQueue.dismiss}
        />
      )}
    </div>
  );
}