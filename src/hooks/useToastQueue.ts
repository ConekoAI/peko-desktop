import { useCallback, useEffect, useRef, useState } from "react";

/**
 * P1.6: FIFO toast queue for `ChannelInviteToast`. The previous
 * single-slot state replaced the latest item on every inbound invite,
 * so a burst of invites from a peer runtime looked like a single
 * notification. This hook holds a max-length FIFO and surfaces only
 * the head item to the consumer.
 *
 * Behavior:
 *  - `enqueue(item)`: appends to the tail. Drops silently if the
 *    queue is already at `maxLength` (the user can re-open from the
 *    sidebar) — better than flooding the screen.
 *  - `current`: the head item, or `null` if the queue is empty. The
 *    consumer renders exactly this and passes `dismiss()` to its
 *    `onDismiss` handler.
 *  - `dismiss()`: removes the head item (FIFO). The next item becomes
 *    `current`; if the queue empties, `current` becomes `null`.
 *  - Each rendered toast auto-dismisses after `autoDismissMs`
 *    (default 6 s) via `setTimeout` that the hook owns. The timer
 *    is cleared on unmount so a fast route change doesn't leave a
 *    stray fire-after-unmount.
 *
 * Convention: this hook is consumer-agnostic — any ephemeral
 * notification UI can use it. ChannelInviteToast was the motivating
 * case; future PRs can drop in error toasts etc.
 */
export function useToastQueue<T>({
  maxLength = 4,
  autoDismissMs = 6_000,
}: {
  maxLength?: number;
  autoDismissMs?: number;
} = {}) {
  const [queue, setQueue] = useState<T[]>([]);
  const dismissTimer = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const enqueue = useCallback(
    (item: T) => {
      setQueue((q) => {
        if (q.length >= maxLength) {
          // Drop silently — keeps the screen stable under bursts.
          return q;
        }
        return [...q, item];
      });
    },
    [maxLength],
  );

  // Auto-dismiss the head item after `autoDismissMs`. We re-arm the
  // timer on every queue change (so a freshly-head item gets a full
  // window, and a previously-queued item that just became head also
  // gets a full window — FIFO ordering implies "6 s from when this
    // item became visible", which is what the user expects).
  useEffect(() => {
    if (queue.length === 0) {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      return;
    }
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
    }
    dismissTimer.current = window.setTimeout(() => {
      dismiss();
    }, autoDismissMs);
    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [queue, autoDismissMs, dismiss]);

  // Cleanup on unmount: any pending timer must be cleared so the
  // unmounted component doesn't try to setState after the fact.
  useEffect(() => {
    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, []);

  return {
    current: queue[0] ?? null,
    pendingCount: Math.max(0, queue.length - 1),
    enqueue,
    dismiss,
  } as const;
}