import { useRef } from "react";
import { LogOut, X } from "lucide-react";
import { useModalA11y } from "../../hooks/useModalA11y";

/**
 * PR-3: confirm leaving a channel. Wraps the destructive
 * `channel_leave` IPC. Uses the shared `ConfirmModal` shape — local
 * copy because we want a `LogOut` icon + a creator-specific
 * caveat ("leaving won't delete the channel for other members").
 *
 * The runtime emits a `MemberLeft` event to the log + (for cross-
 * runtime channels) fans out a `TunnelChannelEvent` envelope so the
 * remote members see the leave in their mirrors.
 */
export default function ChannelLeaveConfirmModal({
  open,
  channelId,
  channelName,
  isCreator,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  channelId: string;
  /** The group's name; its id is shown only when it has none. */
  channelName?: string;
  isCreator: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape cancels and focus stays inside. Hooks run on every render,
  // open or not: called after the early return, they crashed the app
  // the first time the dialog opened (React #310).
  const containerRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(open, containerRef, onCancel);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="channel-leave-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-surface-card p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/50">
            <LogOut className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <h2
            id="channel-leave-modal-title"
            className="text-lg font-semibold text-fg"
          >
            Leave {channelName || <span className="font-mono">{channelId}</span>}?
          </h2>
          <button
            onClick={onCancel}
            className="ml-auto rounded-lg p-1 text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-sm text-fg-muted">
          You&apos;ll stop seeing new messages here. A member can add you
          back later.
        </p>

        {isCreator && (
          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
            You created this channel. Leaving doesn&apos;t delete it — the
            remaining members keep their access.
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-line bg-surface-card px-4 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
            data-testid="channel-leave-confirm"
          >
            Leave group
          </button>
        </div>
      </div>
    </div>
  );
}