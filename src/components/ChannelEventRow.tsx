import { Bot, Plus, Minus } from "lucide-react";
import type { ChannelEvent } from "../lib/api";
import RuntimeBadge from "./RuntimeBadge";

/**
 * PR-2a: per-event row, extracted from `ChannelView.tsx` so the
 * composer and the eventual message-bubble variants (PR-3 reply
 * threading, edit/delete) can share the rendering.
 *
 * `Posted` events get a body card with author chip + body text.
 * `Created` events get a single-line emerald CTA (channel birth).
 * `MemberJoined` / `MemberLeft` events get a muted meta row.
 *
 * The PR-2b live-stream emit feeds new events into the parent list;
 * this component renders whatever it's handed.
 */
export default function ChannelEventRow({
  event,
  showRuntimeBadge = true,
}: {
  event: ChannelEvent;
  showRuntimeBadge?: boolean;
}) {
  switch (event.kind) {
    case "posted":
      return (
        <div
          className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          data-testid="channel-event-row-posted"
        >
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Bot className="h-3.5 w-3.5" />
            <span className="font-mono">{event.author}</span>
            <span>·</span>
            <span>{new Date(event.at).toLocaleString()}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">
            {event.text}
          </div>
        </div>
      );
    case "created":
      return (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          data-testid="channel-event-row-created"
        >
          Channel <span className="font-mono font-semibold">{event.name}</span>{" "}
          created by <span className="font-mono">{event.creator}</span> ·{" "}
          {new Date(event.at).toLocaleString()}
        </div>
      );
    case "member_joined":
      return (
        <div
          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
          data-testid="channel-event-row-member-joined"
        >
          <Plus className="h-3.5 w-3.5" />
          <Bot className="h-3.5 w-3.5" />
          <span className="font-mono">{event.member}</span>
          <span>joined</span>
          {showRuntimeBadge && <RuntimeBadge runtimeId="local" />}
          <span>· {new Date(event.at).toLocaleString()}</span>
        </div>
      );
    case "member_left":
      return (
        <div
          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
          data-testid="channel-event-row-member-left"
        >
          <Minus className="h-3.5 w-3.5" />
          <Bot className="h-3.5 w-3.5" />
          <span className="font-mono">{event.member}</span>
          <span>left</span>
          <span>· {new Date(event.at).toLocaleString()}</span>
        </div>
      );
  }
}