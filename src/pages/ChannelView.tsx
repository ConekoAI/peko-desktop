import { useEffect, useRef } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import ChannelHeader from "../components/ChannelHeader";
import ChannelComposer from "../components/ChannelComposer";
import ChannelEventRow from "../components/ChannelEventRow";
import { useChannelEvents, useChannelStreamInvalidator } from "../hooks/useChannelEvents";
import { Loader2 } from "lucide-react";

/**
 * PR-1 read-only channel view + PR-2a composer. Renders the event log
 * chronologically. `Posted` events get a body row; `Created` /
 * `MemberJoined` / `MemberLeft` events get a one-line meta row
 * (small, muted). The composer mounts at the bottom for PR-2a;
 * invite / leave affordances (PR-3) slot into the header.
 *
 * The view subscribes to `peko-stream` via `useChannelStreamInvalidator`
 * — the listener is wired in PR-1 so the UI surface is stable; the
 * daemon-side emit that drives it lands in PR-2b.
 */
export default function ChannelView() {
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false }) as {
    runtimeId?: string;
    sender?: string;
  };
  const channelId =
    (params as Record<string, string | undefined>).channelId ?? "";
  const runtimeId = search.runtimeId;
  const senderName = search.sender ?? "";

  useChannelStreamInvalidator(channelId, runtimeId);

  const { data: events, isLoading } = useChannelEvents(channelId, null, runtimeId);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [events?.length]);

  return (
    <div className="flex h-full flex-col">
      <ChannelHeader channelId={channelId} runtimeId={runtimeId} />

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
    </div>
  );
}