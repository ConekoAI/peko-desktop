import { Minus, Plus, User } from "lucide-react";
import type { ChannelEvent } from "../lib/api";
import RuntimeBadge from "./RuntimeBadge";
import PekoAvatar from "./peko/PekoAvatar";
import Markdown from "./chat/Markdown";
import { usePekoDirectory, type ActorDisplay } from "../hooks/usePekoDirectory";

/**
 * PR-2a: per-event row, extracted from `ChannelView.tsx` so the
 * composer and the eventual message-bubble variants (PR-3 reply
 * threading, edit/delete) can share the rendering.
 *
 * `Posted` events show the author's face and name (pekos on this
 * runtime by name, the local user as "You") over the markdown body.
 * `Created` events get a single-line brand notice (channel birth).
 * `MemberJoined` / `MemberLeft` events get a muted meta row. The raw
 * actor id stays available as a tooltip.
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
  const directory = usePekoDirectory();
  switch (event.kind) {
    case "posted": {
      const who = directory.resolve(event.author);
      return (
        <div className="flex gap-3 px-1 py-1" data-testid="channel-event-row-posted">
          <ActorFace who={who} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-sm font-semibold text-fg" title={event.author}>
                {who.label}
              </span>
              <span className="text-fg-subtle">{new Date(event.at).toLocaleString()}</span>
            </div>
            <div className="mt-0.5 text-sm text-fg-soft">
              {who.isYou ? (
                <p className="whitespace-pre-wrap break-words">{event.text}</p>
              ) : (
                <Markdown>{event.text}</Markdown>
              )}
            </div>
          </div>
        </div>
      );
    }
    case "created":
      return (
        <div
          className="rounded-lg bg-brand-soft p-3 text-xs text-brand"
          data-testid="channel-event-row-created"
        >
          Group <span className="font-semibold">{event.name}</span> created by{" "}
          <span title={event.creator}>{directory.resolve(event.creator).label}</span> ·{" "}
          {new Date(event.at).toLocaleString()}
        </div>
      );
    case "member_joined":
      return (
        <div
          className="flex items-center gap-2 text-xs text-fg-muted"
          data-testid="channel-event-row-member-joined"
        >
          <Plus className="h-3.5 w-3.5" />
          <span title={event.member}>{directory.resolve(event.member).label}</span>
          <span>joined</span>
          {showRuntimeBadge && <RuntimeBadge runtimeId="local" />}
          <span>· {new Date(event.at).toLocaleString()}</span>
        </div>
      );
    case "member_left":
      return (
        <div
          className="flex items-center gap-2 text-xs text-fg-muted"
          data-testid="channel-event-row-member-left"
        >
          <Minus className="h-3.5 w-3.5" />
          <span title={event.member}>{directory.resolve(event.member).label}</span>
          <span>left</span>
          <span>· {new Date(event.at).toLocaleString()}</span>
        </div>
      );
  }
}

function ActorFace({ who }: { who: ActorDisplay }) {
  if (who.peko) return <PekoAvatar peko={who.peko} size="md" />;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
      <User className="h-4 w-4 text-fg-muted" />
    </span>
  );
}
