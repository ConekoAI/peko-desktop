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
      className="fixed right-4 top-12 z-50 flex max-w-sm items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-emerald-900 dark:bg-slate-900"
      data-testid="channel-invite-toast"
    >
      <Hash className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <button
        onClick={handleOpen}
        className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400"
        data-testid="channel-invite-toast-open"
      >
        Added to{" "}
        <span className="font-mono font-medium">
          {item.channelName || item.channelId}
        </span>
      </button>
      {pendingCount > 0 && (
        <span
          className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
          data-testid="channel-invite-toast-pending"
          title={`${pendingCount} more invite${pendingCount === 1 ? "" : "s"} pending`}
        >
          +{pendingCount}
        </span>
      )}
      <button
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        aria-label="Dismiss invite toast"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}