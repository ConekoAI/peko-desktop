import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  channelEvents,
  channelEventsWatch,
  type ChannelEvent,
  type RuntimeId,
} from "../lib/api";

const DEFAULT_RUNTIME_ID = "local";

function effectiveRuntimeId(runtimeId?: RuntimeId): string {
  return runtimeId ?? DEFAULT_RUNTIME_ID;
}

/**
 * Fetch the full event log for one channel. `since` is the cursor
 * returned by the prior fetch — None / null means "from the start".
 *
 * PR-1 ships read-only with a 10s refetchInterval fallback so the
 * UI auto-refreshes even if the daemon hasn't emitted a `peko-stream`
 * event yet. PR-2 wires the actual event subscription and bumps
 * `staleTime` so the interval becomes a safety net, not the primary
 * mechanism.
 */
export function useChannelEvents(
  channelId: string | undefined,
  since?: string | null,
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery<ChannelEvent[]>({
    queryKey: ["channel-events", rid, channelId, since ?? null] as const,
    enabled: !!channelId,
    queryFn: () => channelEvents(channelId!, since, rid),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

/**
 * PR-2 hook skeleton: subscribe to `peko-stream` and invalidate
 * `["channel-events", channelId]` when a `channel_event` message
 * arrives for this channel. PR-1 already includes the listener
 * skeleton so the hook surface is stable across PRs; the actual
 * `peko-stream` emit on the daemon side lands in PR-2's runtime
 * commit.
 *
 * The `onInviteReceived` callback (PR-3) is also wired here so the
 * toast surface doesn't have to subscribe separately.
 */
export function useChannelStreamInvalidator(
  channelId: string | undefined,
  runtimeId?: RuntimeId,
  onInviteReceived?: (channelId: string) => void,
) {
  const qc = useQueryClient();
  const rid = effectiveRuntimeId(runtimeId);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const handle = await listen<{
          kind: string;
          channelId?: string;
          runtimeId?: string;
        }>("peko-stream", (event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (payload.kind === "channel_event" && payload.channelId === channelId) {
            void qc.invalidateQueries({
              queryKey: ["channel-events", payload.runtimeId ?? rid, channelId],
            });
            void qc.invalidateQueries({
              queryKey: ["channel", payload.runtimeId ?? rid, channelId],
            });
          } else if (
            payload.kind === "channel_invite_received" &&
            payload.channelId === channelId
          ) {
            void qc.invalidateQueries({ queryKey: ["channels", rid] });
            onInviteReceived?.(channelId);
          }
        });
        if (cancelled) {
          handle();
          return;
        }
        unlisten = handle;
      } catch (e) {
        // Tauri event API unavailable (dev / non-desktop). Falls back
        // to the `refetchInterval` polling path above.
        if (!cancelled) {
          console.warn("[peko-desktop] peko-stream subscribe failed:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [channelId, rid, qc, onInviteReceived]);
}

/**
 * PR-2b: kick off the long-lived `ChannelEventsWatch` subscription
 * for `channelId`. The runtime replays events from `since` then
 * forwards live events via the `peko-stream` Tauri event channel —
 * `useChannelStreamInvalidator` (above) is the listener half and
 * invalidates the matching query keys. This hook is the producer
 * half: the Tauri command blocks until the runtime closes the
 * stream, so we run it in a fire-and-forget task and surface
 * failures as `console.warn` rather than blocking the UI.
 *
 * Lifecycle: the subscription survives route changes because the
 * Tauri backend holds the connection, but is torn down on
 * component unmount via `since` cursor swap (the next mount restarts
 * with a fresh `since`). For now this is best-effort — a future
 * PR can hoist it to a top-level provider if multi-page navigation
 * proves flaky.
 */
export function useChannelEventsWatch(
  channelId: string | undefined,
  since?: string | null,
  runtimeId?: RuntimeId,
) {
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    void (async () => {
      try {
        await channelEventsWatch(channelId, since ?? undefined, runtimeId);
      } catch (e) {
        if (!cancelled) {
          console.warn("[peko-desktop] channel_events_watch failed:", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId, since, runtimeId]);
}