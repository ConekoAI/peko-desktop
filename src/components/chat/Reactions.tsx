import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, SmilePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QUICK_EMOJI, looksLikeEmoji, quoteText, type Reaction } from "../../lib/reactions";

/**
 * Runtime ADR-126: the reactions on a message, as chips under it. A
 * chip shows the emoji and how many put it there; yours is marked, and
 * choosing it takes yours off (or puts it on). Names show on hover.
 */
export function ReactionChips({
  reactions,
  isMine,
  nameOf,
  onToggle,
}: {
  reactions: Reaction[];
  /** Whether an address is you. */
  isMine: (address: string) => boolean;
  /** What to call an address. */
  nameOf: (address: string) => string;
  /** Put the emoji on (`mine` false) or take yours off; absent: read only. */
  onToggle?: (emoji: string, mine: boolean) => void;
}) {
  const { t } = useTranslation();
  if (reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid="reaction-chips">
      {reactions.map((r) => {
        const mine = r.by.some(isMine);
        const names = r.by.map((a) => (isMine(a) ? t("chat.message.you") : nameOf(a))).join(", ");
        return (
          <button
            key={r.emoji}
            type="button"
            disabled={!onToggle}
            onClick={() => onToggle?.(r.emoji, mine)}
            title={t("chat.message.reactedBy", { names, emoji: r.emoji })}
            aria-pressed={mine}
            data-testid="reaction-chip"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              mine
                ? "border-brand bg-brand-soft text-brand-text"
                : "border-line bg-surface-card text-fg-soft hover:border-line-strong"
            }`}
          >
            <span>{r.emoji}</span>
            <span className="tabular-nums">{r.by.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Runtime ADR-126: the React button on a message. It opens a few emoji
 * and a field for any other single emoji.
 */
export function ReactButton({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (emoji: string) => {
    setOpen(false);
    setTyped("");
    onPick(emoji);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("chat.message.react")}
        title={t("chat.message.react")}
        aria-expanded={open}
        data-testid="message-react"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
      >
        <SmilePlus className="h-3.5 w-3.5" />
        {t("chat.message.react")}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="reaction-picker"
          className="absolute right-0 top-7 z-20 flex items-center gap-0.5 rounded-lg border border-line bg-surface-card p-1 shadow-pop"
        >
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => pick(emoji)}
              className="rounded px-1.5 py-1 text-base hover:bg-surface-sunken"
            >
              {emoji}
            </button>
          ))}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && looksLikeEmoji(typed)) pick(typed.trim());
              if (e.key === "Escape") setOpen(false);
            }}
            aria-label={t("chat.message.otherEmoji")}
            placeholder={t("chat.message.otherEmoji")}
            className="ml-1 w-20 rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
          />
        </div>
      )}
    </div>
  );
}

/** Runtime ADR-126 D6: the Reply button on a message. */
export function ReplyButton({ onReply }: { onReply: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onReply}
      aria-label={t("chat.message.reply")}
      title={t("chat.message.reply")}
      data-testid="message-reply"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
    >
      <CornerUpLeft className="h-3.5 w-3.5" />
      {t("chat.message.reply")}
    </button>
  );
}

/**
 * Runtime ADR-126 D6: the message a reply answers, above it: its author
 * and the start of what it said. Choosing it jumps to the message. A
 * message this copy does not hold reads as not loaded.
 */
export function QuotedLine({
  quoted,
  onJump,
}: {
  quoted: { author: string; text: string } | null;
  onJump?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!quoted || !onJump}
      data-testid="reply-quote"
      className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-fg-subtle hover:text-fg-muted"
    >
      <CornerUpLeft className="h-3 w-3 shrink-0" />
      {quoted ? (
        <>
          <span className="shrink-0 font-medium text-fg-muted">{quoted.author}</span>
          <span className="truncate">{quoteText(quoted.text)}</span>
        </>
      ) : (
        <span className="italic">{t("chat.message.notLoaded")}</span>
      )}
    </button>
  );
}

/**
 * Runtime ADR-126 D6: over the composer while you are replying: whom you
 * reply to and the start of the message, with a way out.
 */
export function ReplyingBar({
  author,
  text,
  onCancel,
}: {
  author: string;
  text: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="mb-1.5 flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs text-fg-muted"
      data-testid="replying-bar"
    >
      <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0">{t("chat.message.replyingTo", { name: author })}</span>
      <span className="min-w-0 truncate text-fg-subtle">{quoteText(text, 80)}</span>
      <button
        type="button"
        onClick={onCancel}
        className="link ml-auto shrink-0"
        data-testid="replying-cancel"
      >
        {t("common.cancel")}
      </button>
    </div>
  );
}
