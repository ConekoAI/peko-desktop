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
      className="modal-backdrop"
    >
      <div className="modal-panel max-w-md p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft">
            <LogOut className="h-5 w-5 text-warn" />
          </div>
          <h2
            id="channel-leave-modal-title"
            className="modal-title"
          >
            Leave {channelName || <span className="font-mono">{channelId}</span>}?
          </h2>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="btn-icon -mr-2 ml-auto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-sm text-fg-muted">
          You&apos;ll stop seeing new messages here. A member can add you
          back later.
        </p>

        {isCreator && (
          <p className="note-warn mb-6 text-xs">
            You created this group. Leaving doesn&apos;t delete it — the
            remaining members keep their access.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn-danger-solid"
            data-testid="channel-leave-confirm"
          >
            Leave group
          </button>
        </div>
      </div>
    </div>
  );
}