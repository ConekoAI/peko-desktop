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
import QuestionCard from "./chat/QuestionCard";
import type { Answers } from "../types";
import type { CardState } from "../lib/questions";
import type { Reaction } from "../lib/reactions";
import { QuotedLine, ReactButton, ReactionChips, ReplyButton } from "./chat/Reactions";

/**
 * PR-2a: per-event row, extracted from `ChannelView.tsx` so the
 * composer and the eventual message-bubble variants (PR-3 reply
 * threading, edit/delete) can share the rendering.
 *
 * `Posted` events show the author's face and name (pekos on this
 * runtime by name, the local user by their own name) over the markdown body.
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
  card,
  onAnswer,
  reactions,
  quote,
  onJumpToQuote,
  onReply,
  onReact,
}: {
  event: ChannelEvent;
  /** Runtime ADR-126: the emoji on this post. */
  reactions?: Reaction[];
  /**
   * The message this post replies to, when its quote shows (D6):
   * `null` is one this copy does not hold.
   */
  quote?: { author: string; text: string } | null;
  onJumpToQuote?: () => void;
  /** Reply to this post; absent where you can't post. */
  onReply?: () => void;
  /** Put an emoji on this post or take yours off. */
  onReact?: (emoji: string, remove: boolean) => void;
  /** This post's question card state (runtime ADR-114), if it asks. */
  card?: CardState;
  /** Answer a card as you; absent when you can't post here. */
  onAnswer?: (text: string, answers: Answers) => Promise<void>;
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
      // Runtime ADR-126 D2: a reaction is not a message; it shows on its
      // post's chips.
      if (event.react) return null;
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
        <div className="group relative flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-raised" data-testid="channel-event-row-posted">
          <ActorFace who={who} />
          <div className="min-w-0 flex-1">
            {quote !== undefined && <QuotedLine quoted={quote} onJump={onJumpToQuote} />}
            <div className="flex items-baseline gap-2 text-xs">
              <span
                className="text-sm font-semibold text-fg"
                title={who.handle ? `@${who.handle}` : shownAddress(event.author)}
              >
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
            {reactions && reactions.length > 0 && (
              <ReactionChips
                reactions={reactions}
                isMine={(a) => directory.resolve(a).isYou}
                nameOf={(a) => directory.resolve(a).label}
                onToggle={onReact}
              />
            )}
            {event.ask && card && (() => {
              // A card for someone else reads as theirs to answer.
              const forWho = event.ask.for ? directory.resolve(event.ask.for) : undefined;
              const mine = !forWho || forWho.isYou;
              return (
                <QuestionCard
                  ask={event.ask}
                  msgId={event.msg_id}
                  open={card.open}
                  answered={card.answered}
                  forLabel={forWho && !forWho.isYou ? forWho.label : undefined}
                  onSend={mine ? onAnswer : undefined}
                />
              );
            })()}
          </div>
          {(onReply || onReact) && (
            <div className="absolute -top-3 right-3 flex gap-0.5 rounded-lg border border-line bg-surface-card p-0.5 opacity-0 shadow-pop transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {onReply && <ReplyButton onReply={onReply} />}
              {onReact && <ReactButton onPick={(emoji) => onReact(emoji, false)} />}
            </div>
          )}
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
