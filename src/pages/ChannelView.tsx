import { useEffect, useRef, useState } from "react";
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
  useChannelLeave,
} from "../hooks/useChannels";
import {
  useChannelEvents,
  useChannelEventsWatch,
  useChannelStreamInvalidator,
} from "../hooks/useChannelEvents";
import { useToastQueue } from "../hooks/useToastQueue";
import { usePrincipals } from "../hooks/usePrincipals";

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
  const senderName = search.sender ?? "";

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
  const memberSet = new Set(membersData?.members ?? []);
  const isMember = localPrincipals.some((p) => memberSet.has(p.name));
  const isCreator = !!detail && localPrincipals.some(
    (p) => p.name === detail.creator,
  );

  const leaveMut = useChannelLeave(channelId, runtimeId);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [events?.length]);

  function handleLeaveConfirm() {
    if (!senderName) {
      // No local sender to leave as — close the modal and bail.
      setLeaveOpen(false);
      return;
    }
    leaveMut.mutate(
      { principalName: senderName },
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
      <ChannelHeader
        channelId={channelId}
        runtimeId={runtimeId}
        isMember={isMember}
        isCreator={isCreator}
        onInviteClick={() => setInviteOpen(true)}
        onLeaveClick={() => setLeaveOpen(true)}
      />

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        data-testid="channel-events"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading events…
          </div>
        ) : eventsError ? (
          <div
            className="mx-auto my-6 max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
            aria-live="assertive"
            data-testid="channel-events-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Couldn't load channel events.</p>
                <p className="mt-1 opacity-80">
                  {eventsError instanceof Error
                    ? eventsError.message
                    : String(eventsError)}
                </p>
                <button
                  type="button"
                  onClick={() => void refetchEvents()}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
                  data-testid="channel-events-retry"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : events && events.length > 0 ? (
          <ul className="space-y-3">
            {events.map((e, i) => (
              <li key={i} data-testid="channel-event-row">
                <ChannelEventRow event={e} />
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="mx-auto my-12 max-w-md text-center"
            data-testid="channel-events-empty"
          >
            <div className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              No events yet.
            </div>
            {detail?.name && (
              <div className="text-xs text-slate-400 dark:text-slate-500">
                Be the first to post in <span className="font-mono">{detail.name}</span>.
              </div>
            )}
            {!isMember && (
              <div className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Ask a current member to invite you, then return to
                this channel to start posting.
              </div>
            )}
          </div>
        )}
      </div>

      {senderName ? (
        <ChannelComposer
          channelId={channelId}
          senderName={senderName}
          runtimeId={runtimeId}
        />
      ) : (
        <div
          className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          data-testid="channel-composer-no-sender"
        >
          Select a channel from the sidebar to start posting.
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
        isCreator={isCreator}
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