import { useState } from "react";
import { Hash, Users, ChevronDown, ChevronUp, UserPlus, LogOut } from "lucide-react";
import { useChannel } from "../hooks/useChannels";
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
  const [showMembers, setShowMembers] = useState(false);

  if (!detail) {
    return (
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm text-slate-400 dark:border-slate-800">
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

  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="h-4 w-4 shrink-0 text-slate-400" />
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
            {detail.name}
          </h2>
          <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
            {detail.channelId}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <RuntimeBadge runtimeId={detail.runtimeId || "local"} />
          {showInvite && (
            <button
              type="button"
              onClick={onInviteClick}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
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
              title={isCreator ? "Leave channel (you'll remain the creator)" : "Leave channel"}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              data-testid="channel-leave-button"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Leave</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
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
      <div className="px-4 pb-2 text-xs text-slate-500 dark:text-slate-400">
        Created by <span className="font-mono">{detail.creator}</span> ·{" "}
        {new Date(detail.createdAt).toLocaleString()}
      </div>
      {showMembers && (
        <div className="border-t border-slate-200 dark:border-slate-800">
          <MemberList channelId={channelId} runtimeId={runtimeId} />
        </div>
      )}
    </div>
  );
}