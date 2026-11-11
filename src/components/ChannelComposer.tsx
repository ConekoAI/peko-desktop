import { useMemo, useState, useRef, type KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChannelPost } from "../hooks/useChannelPost";
import { useChannelInfo } from "../hooks/useChannels";
import { insertMention, mentionCandidates, mentionQuery } from "../lib/mentions";
import { mentionablePekos } from "../lib/channelPeople";
import { isChannelForbidden } from "../lib/channelErrors";
import type { RuntimeId } from "../lib/api";

/**
 * PR-2a post composer. Mounts at the bottom of `<ChannelView>`. The
 * submit path is `useChannelPost` (a TanStack Query mutation) — the
 * mutation invalidates `["channel-events", channelId]` on success so
 * the new message appears in the list without a manual refresh.
 *
 * Enter submits and Shift+Enter adds a line, like the chat composer
 * (`src/components/chat/Composer.tsx`). Submit is disabled while the
 * mutation is pending; the textarea stays focusable so the user can
 * keep typing into a follow-up message while the previous one
 * commits.
 *
 * You post as yourself (ADR-082): a human post is what wakes the
 * group's pekos. Posting as a peko would wake no one. Typing `@` lists
 * the group's pekos; a peko that replies on mentions answers `@name`.
 */
export default function ChannelComposer({
  channelId,
  channelName,
  runtimeId,
  withPerson = false,
}: {
  channelId: string;
  /** The group's name, for the placeholder. */
  channelName?: string;
  runtimeId?: RuntimeId;
  /** A DM with another person (runtime ADR-095 D6): no peko to mention. */
  withPerson?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mutation = useChannelPost(runtimeId);
  const { data: info } = useChannelInfo(channelId);
  // The group's pekos: those here, and those on other computers.
  const pekoNames = useMemo(() => {
    const names = (info?.pekos ?? []).map((p) => p.name);
    for (const name of mentionablePekos(info?.people)) {
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }, [info]);
  // The `@word` under the caret, and which suggestion is highlighted.
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const query = mentionQuery(draft, caret);
  const suggestions =
    query && query.start !== dismissedAt ? mentionCandidates(pekoNames, query.query) : [];
  const menuOpen = suggestions.length > 0;

  function track(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? el.value.length);
  }

  function choose(name: string) {
    if (!query) return;
    const next = insertMention(draft, query.start, caret, name);
    setDraft(next.text);
    setCaret(next.caret);
    setHighlight(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  }

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !mutation.isPending;
  // Computed outside the JSX: the `isChannelForbidden` type guard
  // narrows `mutation.error` to `never` in the generic branch.
  const errorMessage = mutation.error?.message ?? t("channel.composer.postFailed");

  async function submit() {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        channelId,
        senderName: null,
        text: trimmed,
        parent: null,
      });
      setDraft("");
      textareaRef.current?.focus();
    } catch {
      // Error rendered inline below; keep the draft so the user
      // can edit + retry rather than losing their input.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // While mentioning: arrows pick, Enter/Tab insert, Escape closes.
    if (menuOpen && !e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        choose(suggestions[Math.min(highlight, suggestions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(query?.start ?? null);
        return;
      }
    }
    // Enter sends; Shift+Enter adds a line; never mid-IME-composition.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  }

  return (
    <div className="bg-surface px-4 pb-4 pt-2">
      {mutation.isError && (
        isChannelForbidden(mutation.error) ? (
          <div
            className="note-warn mb-2 text-xs"
            data-testid="channel-composer-forbidden"
          >
            {t("channel.composer.forbidden")}
          </div>
        ) : (
          <div
            className="note-danger mb-2 text-xs"
            data-testid="channel-composer-error"
          >
            {errorMessage}
          </div>
        )
      )}
      <div className="relative flex items-end gap-2 rounded-xl border border-line-strong bg-surface-card p-1.5 shadow-sm transition-colors focus-within:border-peko-500 focus-within:ring-2 focus-within:ring-peko-500/20">
        {menuOpen && (
          <ul
            role="listbox"
            aria-label={t("channel.composer.mentionLabel")}
            className="popover absolute bottom-full left-0 mb-2 min-w-48"
          >
            {suggestions.map((name, i) => (
              <li
                key={name}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(name);
                }}
                className={[
                  "cursor-pointer rounded-lg px-2.5 py-1.5 text-sm",
                  i === highlight ? "bg-brand-soft text-fg" : "text-fg-soft hover:bg-surface-sunken",
                ].join(" ")}
              >
                @{name}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            track(e.target);
            setHighlight(0);
          }}
          onSelect={(e) => track(e.currentTarget)}
          onKeyDown={onKeyDown}
          placeholder={
            withPerson
              ? channelName
                ? t("channel.composer.messagePerson", { name: channelName })
                : t("channel.composer.messageThem")
              : channelName
                ? t("channel.composer.messageGroupNamed", { name: channelName })
                : t("channel.composer.messageGroup")
          }
          rows={2}
          disabled={mutation.isPending}
          data-testid="channel-composer-input"
          className="block max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          data-testid="channel-composer-send"
          className="btn-primary h-9 w-9 shrink-0 p-0"
          aria-label={t("channel.composer.send")}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}