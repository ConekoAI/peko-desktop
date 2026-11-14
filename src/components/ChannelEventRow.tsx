import { ClipboardList, Minus, Plus, User } from "lucide-react";
import type { ChannelEvent } from "../lib/api";
import RuntimeBadge from "./RuntimeBadge";
import PekoAvatar from "./peko/PekoAvatar";
import Markdown from "./chat/Markdown";
import type { ActorDisplay } from "../hooks/usePekoDirectory";
import { useChannelDirectory } from "../hooks/useChannelDirectory";
import { shownAddress } from "../lib/format";
import { Trans, useTranslation } from "react-i18next";
import { currentLocale } from "../i18n";

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
  people,
  channelId,
}: {
  event: ChannelEvent;
  showRuntimeBadge?: boolean;
  /** The channel, so members on other computers read by name. */
  channelId?: string;
  /**
   * Set in a DM with another person (runtime ADR-095 D6): what to call
   * people by address (`user:hub:<account>`). Its birth reads as a
   * conversation, not a group.
   */
  people?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const directory = useChannelDirectory(channelId ?? event.channel, people);
  switch (event.kind) {
    case "posted": {
      const who = directory.resolve(event.author);
      // Runtime ADR-101: a board change reads as a compact line, not a
      // message; the board itself is above the conversation.
      if (event.board) {
        return (
          <div
            className="flex items-center gap-2 px-2 py-0.5 pl-[3.25rem] text-xs text-fg-muted"
            data-testid="channel-event-row-board"
          >
            <ClipboardList className="h-3.5 w-3.5 shrink-0 text-brand-text" />
            <span className="min-w-0 break-words" title={shownAddress(event.author)}>
              {directory.named(boardLine(event.text, who.label))}
            </span>
            <span className="shrink-0 text-fg-subtle">· {new Date(event.at).toLocaleString(currentLocale())}</span>
          </div>
        );
      }
      return (
        <div className="flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-raised" data-testid="channel-event-row-posted">
          <ActorFace who={who} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-sm font-semibold text-fg" title={shownAddress(event.author)}>
                {who.label}
              </span>
              <span className="text-[11px] text-fg-subtle">{new Date(event.at).toLocaleString(currentLocale())}</span>
            </div>
            <div className="mt-0.5 text-sm text-fg-soft">
              {who.isYou ? (
                <p className="whitespace-pre-wrap break-words">{directory.named(event.text)}</p>
              ) : (
                <Markdown>{directory.named(event.text)}</Markdown>
              )}
            </div>
          </div>
        </div>
      );
    }
    case "created":
      return (
        <div
          className="mx-2 mb-2 rounded-xl border border-line bg-surface-raised px-4 py-3 text-xs text-fg-muted"
          data-testid="channel-event-row-created"
        >
          {people ? (
            // Either side's copy starts when they open or accept it, so
            // who "created" it here says nothing; name the conversation.
            <Trans
              i18nKey="channel.event.conversationWith"
              components={{
                name: (
                  <span className="font-semibold text-fg">
                    {Object.values(people)[0] ?? t("channel.event.them")}
                  </span>
                ),
              }}
            />
          ) : (
            <Trans
              i18nKey="channel.event.groupCreated"
              components={{
                name: <span className="font-semibold text-fg">{event.name}</span>,
                creator: <span title={event.creator}>{directory.resolve(event.creator).label}</span>,
              }}
            />
          )}{" "}
          · {new Date((!people && directory.createdAt) || event.at).toLocaleString(currentLocale())}
        </div>
      );
    case "member_joined":
      return (
        <div
          className="flex items-center gap-2 px-2 pl-[3.25rem] text-xs text-fg-subtle"
          data-testid="channel-event-row-member-joined"
        >
          <Plus className="h-3.5 w-3.5 text-ok" />
          <span className="font-medium text-fg-muted" title={shownAddress(event.member)}>{directory.resolve(event.member).label}</span>
          <span>{t("channel.event.joined")}</span>
          {showRuntimeBadge && <RuntimeBadge runtimeId="local" />}
          <span>· {new Date(event.at).toLocaleString(currentLocale())}</span>
        </div>
      );
    case "member_left":
      return (
        <div
          className="flex items-center gap-2 px-2 pl-[3.25rem] text-xs text-fg-subtle"
          data-testid="channel-event-row-member-left"
        >
          <Minus className="h-3.5 w-3.5" />
          <span className="font-medium text-fg-muted" title={shownAddress(event.member)}>{directory.resolve(event.member).label}</span>
          <span>{t("channel.event.left")}</span>
          <span>· {new Date(event.at).toLocaleString(currentLocale())}</span>
        </div>
      );
  }
}

/**
 * A board post's line without its `board:` prefix, naming its author as
 * the reader knows them (the runtime writes the author's own name).
 */
function boardLine(text: string, label: string): string {
  const body = text.replace(/^board:\s*/, "");
  const cut = body.search(/[ :]/);
  return cut > 0 ? `${label}${body.slice(cut)}` : body;
}

function ActorFace({ who }: { who: ActorDisplay }) {
  if (who.peko) return <PekoAvatar peko={who.peko} size="md" />;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
      <User className="h-4 w-4" />
    </span>
  );
}
