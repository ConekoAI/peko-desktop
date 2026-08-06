import { useEffect, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import ChannelHeader from "../components/ChannelHeader";
import { useChannelEvents, useChannelStreamInvalidator } from "../hooks/useChannelEvents";
import { Loader2, Bot } from "lucide-react";
import RuntimeBadge from "../components/RuntimeBadge";
import type { ChannelEvent } from "../lib/api";

/**
 * PR-1 read-only channel view. Renders the event log chronologically.
 * `Posted` events get a body row; `Created` / `MemberJoined` /
 * `MemberLeft` events get a one-line meta row (small, muted). The
 * composer (PR-2) and the invite / leave affordances (PR-3) slot in
 * below the event list.
 *
 * The view subscribes to `peko-stream` via `useChannelStreamInvalidator`
 * — the listener is wired in PR-1 so the UI surface is stable; the
 * daemon-side emit that drives it lands in PR-2's runtime commit.
 */
export default function ChannelView() {
  const params = useParams({ strict: false });
  const channelId =
    (params as Record<string, string | undefined>).channelId ?? "";
  const runtimeId =
    (params as Record<string, string | undefined>).runtimeId;

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
                {renderEvent(e)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-600">
            No events yet.
          </div>
        )}
      </div>
    </div>
  );
}

function renderEvent(e: ChannelEvent) {
  switch (e.kind) {
    case "posted":
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Bot className="h-3.5 w-3.5" />
            <span className="font-mono">{e.author}</span>
            <span>·</span>
            <span>{new Date(e.at).toLocaleString()}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">
            {e.text}
          </div>
        </div>
      );
    case "created":
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Channel <span className="font-mono font-semibold">{e.name}</span>{" "}
          created by <span className="font-mono">{e.creator}</span> ·{" "}
          {new Date(e.at).toLocaleString()}
        </div>
      );
    case "member_joined":
      return (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Bot className="h-3.5 w-3.5" />
          <span className="font-mono">{e.member}</span>
          <span>joined</span>
          <RuntimeBadge runtimeId="local" />
          <span>· {new Date(e.at).toLocaleString()}</span>
        </div>
      );
    case "member_left":
      return (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Bot className="h-3.5 w-3.5" />
          <span className="font-mono">{e.member}</span>
          <span>left</span>
          <span>· {new Date(e.at).toLocaleString()}</span>
        </div>
      );
  }
}