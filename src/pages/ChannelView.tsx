import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
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
import { usePrincipals } from "../hooks/usePrincipals";
import { Loader2 } from "lucide-react";

/**
 * Channel view. PR-1 read-only + PR-2a composer + PR-3
 * create/invite/leave surface.
 *
 * `useChannelStreamInvalidator` drives two concerns:
 *   1. invalidate `["channel-events", channelId]` on inbound events
 *      (auto-refresh)
 *   2. show a transient `ChannelInviteToast` when the runtime
 *      emits `kind: "channel_invite_received"` — the user's first
 *      signal that they were added to a remote channel.
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
  const [inviteToast, setInviteToast] = useState<InviteToastItem | null>(null);

  // Auto-dismiss the toast after 6s — a queue of inbound invites
  // shouldn't stack banners forever.
  useEffect(() => {
    if (!inviteToast) return;
    const t = window.setTimeout(() => setInviteToast(null), 6_000);
    return () => window.clearTimeout(t);
  }, [inviteToast]);

  useChannelStreamInvalidator(channelId, runtimeId, (incomingChannelId) => {
    setInviteToast({ channelId: incomingChannelId });
  });

  const { data: events, isLoading } = useChannelEvents(channelId, null, runtimeId);
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
        ) : events && events.length > 0 ? (
          <ul className="space-y-3">
            {events.map((e, i) => (
              <li key={i} data-testid="channel-event-row">
                <ChannelEventRow event={e} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-600">
            No events yet.
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
          onDismiss={() => setInviteToast(null)}
        />
      )}
    </div>
  );
}