import { useEffect, useRef } from "react";
import { Paperclip, Send, Square } from "lucide-react";

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
 * picker and Stop while the peko is working. Sending while it works
 * queues the message for its running turn. Files picked with the
 * paperclip (or dropped on the window) show as chips above the text
 * and go with the next message; a message may be files alone.
 */
export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  stopping,
  models,
  model,
  onModelChange,
  attachments = [],
  onAttach,
  onRemoveAttachment,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  stopping: boolean;
  models: ComposerModel[];
  /** The model for the next message; `null` is the peko's own. */
  model: string | null;
  onModelChange: (model: string | null) => void;
  /** Paths of the files going with the next message. */
  attachments?: string[];
  /** Pick files to attach; absent where attaching is unavailable. */
  onAttach?: () => void;
  onRemoveAttachment?: (path: string) => void;
}) {
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
      className="rounded-xl border border-line bg-surface-raised focus-within:border-brand focus-within:ring-1 focus-within:ring-brand"
    >
      <PendingAttachments paths={attachments} onRemove={(path) => onRemoveAttachment?.(path)} />
      <textarea
        ref={ref}
        rows={1}
        aria-label="Message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={busy ? "Add to what it's doing…" : "Message your peko…"}
        className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-fg outline-none placeholder:text-slate-400"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        {onAttach && (
          <button
            type="button"
            onClick={onAttach}
            aria-label="Attach files"
            title="Attach files — or drop them on the window"
            className="inline-flex items-center rounded-md p-1.5 text-fg-muted hover:bg-surface-sunken hover:text-fg-soft"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}
        {models.length > 0 && (
          <select
            aria-label="Model for this message"
            value={model ?? ""}
            onChange={(e) => onModelChange(e.target.value || null)}
            className="max-w-[14rem] truncate rounded-md border-none bg-transparent px-2 py-1 text-xs text-fg-muted outline-none hover:bg-surface-sunken focus:ring-1 focus:ring-brand"
          >
            <option value="">Peko&apos;s model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto hidden text-[11px] text-fg-subtle sm:inline">
          ↵ to send · ⇧↵ for a new line
        </span>
        {busy && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            title="Stop"
            aria-label="Stop"
            className="inline-flex items-center rounded-lg border border-line bg-surface-card p-2 text-fg-soft transition-colors hover:bg-surface-sunken disabled:opacity-50"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        )}
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          title="Send (Enter)"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
