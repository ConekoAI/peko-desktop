import { Hash, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

/**
 * PR-3 + P1.6: ephemeral toast for inbound channel invites. Fired by
 * the `useChannelStreamInvalidator` listener when the runtime emits
 * a `peko-stream` event whose `payload.payload.kind ===
 * "channel_invite_received"` (the inner event is the runtime's
 * `ChannelEvent` JSON, which carries the invite tag). Click
 * navigates to `/channels/$channelId`; X dismisses without
 * navigating.
 *
 * Self-dismissing via the `useToastQueue` hook on the consumer side
 * (default 6s). Bursts of invites render one toast at a time with a
 * "+N more" pill when the queue is deeper than the head item.
 */
export interface InviteToastItem {
  channelId: string;
  channelName?: string;
}

export default function ChannelInviteToast({
  item,
  runtimeId,
  pendingCount = 0,
  onDismiss,
}: {
  item: InviteToastItem;
  runtimeId?: string;
  pendingCount?: number;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();

  function handleOpen() {
    onDismiss();
    navigate({
      to: "/channels/$channelId",
      params: { channelId: item.channelId },
      search: runtimeId ? { runtimeId } : {},
    });
  }

  return (
    <div
      className="popover fixed right-4 top-12 z-50 flex max-w-sm items-center gap-2 px-3 py-2 text-xs"
      data-testid="channel-invite-toast"
    >
      <Hash className="h-3.5 w-3.5 shrink-0 text-brand-text" />
      <button
        onClick={handleOpen}
        className="min-w-0 flex-1 truncate text-left text-fg-soft hover:text-brand-text"
        data-testid="channel-invite-toast-open"
      >
        Added to{" "}
        <span className="font-mono font-medium">
          {item.channelName || item.channelId}
        </span>
      </button>
      {pendingCount > 0 && (
        <span
          className="badge-accent shrink-0"
          data-testid="channel-invite-toast-pending"
          title={`${pendingCount} more invite${pendingCount === 1 ? "" : "s"} pending`}
        >
          +{pendingCount}
        </span>
      )}
      <button
        onClick={onDismiss}
        className="btn-icon shrink-0 p-1"
        aria-label="Dismiss invite toast"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}