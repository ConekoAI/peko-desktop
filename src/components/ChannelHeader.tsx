import { useState } from "react";
import { Hash, Users, ChevronDown, ChevronUp, UserPlus, LogOut } from "lucide-react";
import { useChannel, useChannelInfo } from "../hooks/useChannels";
import { usePekoDirectory } from "../hooks/usePekoDirectory";
import RuntimeBadge from "./RuntimeBadge";
import MemberList from "./MemberList";

/**
 * Channel header. Renders the channel's metadata snapshot (name,
 * creator, createdAt, member count) plus a collapsible member-list
 * toggle. PR-3 adds the "Invite" + "Leave" affordances as sibling
 * buttons next to the member toggle — they hoist their modals via
 * callbacks so the header stays presentational.
 *
 * The member count and creator come from `useChannel`, which
 * projects both from the runtime's `channel_peek` response
 * (first `Created` event + MemberJoined - MemberLeft).
 *
 * Action buttons are hidden when the user isn't a member — guest
 * viewers (read-only mirror, no local principal in the channel)
 * shouldn't see an "Invite" button that would fail server-side.
 */
export default function ChannelHeader({
  channelId,
  runtimeId,
  isMember,
  isCreator,
  onInviteClick,
  onLeaveClick,
}: {
  channelId: string;
  runtimeId?: string;
  isMember?: boolean;
  isCreator?: boolean;
  onInviteClick?: () => void;
  onLeaveClick?: () => void;
}) {
  const { data: detail } = useChannel(channelId, runtimeId);
  const { data: info } = useChannelInfo(channelId);
  const directory = usePekoDirectory();
  const [showMembers, setShowMembers] = useState(false);
  // ADR-082: a channel is a DM (two members, always wakes) or a group.
  const kind = info?.kind ?? (channelId.startsWith("dm_") ? "dm" : "group");

  if (!detail) {
    return (
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-fg-subtle">
        <Hash className="h-4 w-4" />
        <span className="truncate font-mono">{channelId}</span>
      </div>
    );
  }

  // Default: treat unknown membership as "show invite, show leave".
  // The owner page (`ChannelView`) passes `isMember` derived from
  // `useChannelMembers`, but the legacy callers (tests, standalone
  // header usage) get the optimistic default so the buttons don't
  // disappear under a stale `null` from a still-fetching query.
  const showInvite = isMember !== false && !!onInviteClick;
  const showLeave = isMember !== false && !!onLeaveClick;
  // P1.10 polish: explicit "View only" chip when the viewer isn't a
  // member. Tells the user why the composer is hidden + why the
  // invite/leave buttons are absent (rather than leaving them to
  // guess from a disabled-looking UI).
  const isGuest = isMember === false;

  return (
    <div className="border-b border-line">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="h-4 w-4 shrink-0 text-fg-subtle" />
          <h2 className="truncate text-base font-semibold text-fg">
            {detail.name}
          </h2>
          <span
            data-testid="channel-kind-badge"
            className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted"
            title={detail.channelId}
          >
            {kind === "dm" ? "Direct message" : "Group"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <RuntimeBadge runtimeId={detail.runtimeId || "local"} />
          {isGuest && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted"
              data-testid="channel-guest-chip"
              title="You aren't in this group — you can read but not post."
            >
              View only
            </span>
          )}
          {showInvite && (
            <button
              type="button"
              onClick={onInviteClick}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-soft transition-colors hover:bg-surface-sunken"
              data-testid="channel-invite-button"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Invite</span>
            </button>
          )}
          {showLeave && (
            <button
              type="button"
              onClick={onLeaveClick}
              title={isCreator ? "Leave group (you'll stay its creator)" : "Leave group"}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-soft transition-colors hover:bg-surface-sunken"
              data-testid="channel-leave-button"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Leave</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-soft transition-colors hover:bg-surface-sunken"
            data-testid="channel-toggle-members"
          >
            <Users className="h-3.5 w-3.5" />
            <span>{detail.memberCount}</span>
            {showMembers ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
      <div className="px-4 pb-2 text-xs text-fg-muted">
        Created by <span title={detail.creator}>{directory.resolve(detail.creator).label}</span> ·{" "}
        {new Date(detail.createdAt).toLocaleString()}
      </div>
      {showMembers && (
        <div className="border-t border-line">
          <MemberList channelId={channelId} runtimeId={runtimeId} />
        </div>
      )}
    </div>
  );
}