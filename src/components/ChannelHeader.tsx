import { useState } from "react";
import { Hash, User, Users, ChevronDown, ChevronUp, UserPlus, LogOut, Share2 } from "lucide-react";
import { useChannel, useChannelInfo } from "../hooks/useChannels";
import { useChannelDirectory } from "../hooks/useChannelDirectory";
import { groupMonogram } from "../lib/format";
import RuntimeBadge from "./RuntimeBadge";
import MemberList from "./MemberList";
import GroupSharePanel from "./GroupSharePanel";

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
  title,
}: {
  channelId: string;
  runtimeId?: string;
  isMember?: boolean;
  isCreator?: boolean;
  onInviteClick?: () => void;
  onLeaveClick?: () => void;
  /** Shown instead of the channel's stored name (a person DM's person). */
  title?: string;
}) {
  const { data: detail } = useChannel(channelId, runtimeId);
  const { data: info } = useChannelInfo(channelId);
  const directory = useChannelDirectory(channelId);
  const [showMembers, setShowMembers] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // ADR-082: a channel is a DM (two members, always wakes) or a group.
  const kind = info?.kind ?? (channelId.startsWith("dm_") ? "dm" : "group");

  if (!detail) {
    return (
      <div className="flex h-14 items-center gap-2 border-b border-line px-4 text-sm text-fg-subtle">
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
  // Runtime ADR-092 D5: a group is shared from its home.
  const share = kind === "group" && isMember !== false && info?.group?.homeHere ? info.group : null;

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="tile h-9 w-9 rounded-xl text-[13px] font-semibold">
            {title ? (
              <User className="h-4 w-4" />
            ) : (
              groupMonogram(detail.name)
            )}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-fg">
                {title ?? detail.name}
              </h2>
              <span
                data-testid="channel-kind-badge"
                className="badge-neutral shrink-0"
                title={detail.channelId}
              >
                {kind === "dm" ? "Direct message" : "Group"}
              </span>
              {isGuest && (
                <span
                  className="badge-warn shrink-0"
                  data-testid="channel-guest-chip"
                  title="You aren't in this group — you can read but not post."
                >
                  View only
                </span>
              )}
            </div>
            {/* A DM with a person (titled for them) starts on each side when
                it is opened or accepted, so who "created" this copy says nothing. */}
            {!title && (
              <div className="truncate text-xs leading-tight text-fg-subtle">
                Created by <span title={detail.creator}>{directory.resolve(detail.creator).label}</span> ·{" "}
                {/* A copy from another computer began when the group did. */}
                {new Date(directory.createdAt ?? detail.createdAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {detail.runtimeId && detail.runtimeId !== "local" && (
            <RuntimeBadge runtimeId={detail.runtimeId} />
          )}
          {share && (
            <button
              type="button"
              onClick={() => setShowShare((v) => !v)}
              className={`btn-ghost btn-sm ${showShare ? "bg-surface-sunken text-fg" : ""}`}
              data-testid="channel-share-button"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Share</span>
            </button>
          )}
          {showInvite && (
            <button
              type="button"
              onClick={onInviteClick}
              className="btn-ghost btn-sm"
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
              className="btn-ghost btn-sm hover:bg-danger-soft hover:text-danger"
              data-testid="channel-leave-button"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Leave</span>
            </button>
          )}
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            aria-expanded={showMembers}
            className={`btn-ghost btn-sm ${showMembers ? "bg-surface-sunken text-fg" : ""}`}
            data-testid="channel-toggle-members"
          >
            <Users className="h-3.5 w-3.5" />
            {/* The roster, not the join events (the creator never "joins"). */}
            <span>{info?.people?.length || info?.members?.length || detail.memberCount}</span>
            {showMembers ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
      {share && showShare && <GroupSharePanel channelId={channelId} group={share} />}
      {showMembers && (
        <div className="border-t border-line">
          <MemberList channelId={channelId} runtimeId={runtimeId} />
        </div>
      )}
    </div>
  );
}