import { useEffect, useRef } from "react";
import { Paperclip, Send } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PendingAttachments } from "./Attachments";

/** A configured model the picker offers for one message. */
export interface ComposerModel {
  id: string;
  displayName: string;
}

/** Max textarea height before it scrolls, in px. */
const MAX_HEIGHT = 200;


/**
 * The chat input: a textarea that grows with its text, where Enter
 * sends and Shift+Enter adds a line, plus a per-message model
 * picker. It is always open: a message sent while the peko works
 * reaches it at once, like writing to a person who is busy — there is
 * no Stop; saying "stop" is a message too. Files picked with the
 * paperclip (or dropped on the window) show as chips above the text
 * and go with the next message; a message may be files alone.
 */
export default function Composer({
  value,
  onChange,
  onSend,
  models,
  model,
  onModelChange,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  onPasteFiles,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  models: ComposerModel[];
  /** The model for the next message; `null` is the peko's own. */
  model: string | null;
  onModelChange: (model: string | null) => void;
  /** Paths of the files going with the next message. */
  attachments?: string[];
  /** Pick files to attach; absent where attaching is unavailable. */
  onAttach?: () => void;
  onRemoveAttachment?: (path: string) => void;
  /** Files pasted into the message (e.g. a screenshot). */
  onPasteFiles?: (files: File[]) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to MAX_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 || attachments.length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a line; an IME composition's Enter
    // confirms the candidate and never sends.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSend) onSend();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      className="rounded-xl border border-line-strong bg-surface-card shadow-sm transition-colors focus-within:border-peko-500 focus-within:ring-2 focus-within:ring-peko-500/20"
    >
      <PendingAttachments paths={attachments} onRemove={(path) => onRemoveAttachment?.(path)} />
      <textarea
        ref={ref}
        rows={1}
        aria-label={t("chat.composer.label")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length === 0 || !onPasteFiles) return;
          e.preventDefault();
          onPasteFiles(files);
        }}
        placeholder={t("chat.composer.placeholder")}
        className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        {onAttach && (
          <button
            type="button"
            onClick={onAttach}
            aria-label={t("common.attachFiles")}
            title={t("chat.composer.attachTitle")}
            className="btn-icon"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}
        {models.length > 0 && (
          <select
            aria-label={t("chat.composer.modelLabel")}
            value={model ?? ""}
            onChange={(e) => onModelChange(e.target.value || null)}
            className="max-w-[14rem] truncate rounded-md border-none bg-transparent px-2 py-1 text-xs text-fg-muted outline-none hover:bg-surface-sunken focus:ring-1 focus:ring-peko-500"
          >
            <option value="">{t("chat.composer.pekosModel")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto hidden text-[11px] text-fg-subtle sm:inline">
          {t("chat.composer.hint")}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("common.send")}
          title={t("chat.composer.sendTitle")}
          className="btn-primary h-8 w-8 p-0"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
