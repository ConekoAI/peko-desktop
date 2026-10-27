import { useEffect, useRef } from "react";
import { Send, Square } from "lucide-react";

/** A configured model the picker offers for one message. */
export interface ComposerModel {
  id: string;
  displayName: string;
}

/** Max textarea height before it scrolls, in px. */
const MAX_HEIGHT = 200;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The chat input: a textarea that grows with its text, where ⌘↵ (Ctrl+↵
 * off macOS) sends and Enter adds a line, plus a per-message model
 * picker and Stop while the peko is working. Sending while it works
 * queues the message for its running turn.
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
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to MAX_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const canSend = value.trim().length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      className="rounded-xl border border-slate-200 bg-slate-50 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900"
    >
      <textarea
        ref={ref}
        rows={1}
        aria-label="Message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={busy ? "Add to what it's doing…" : "Message your peko…"}
        className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        {models.length > 0 && (
          <select
            aria-label="Model for this message"
            value={model ?? ""}
            onChange={(e) => onModelChange(e.target.value || null)}
            className="max-w-[14rem] truncate rounded-md border-none bg-transparent px-2 py-1 text-xs text-slate-500 outline-none hover:bg-slate-200 focus:ring-1 focus:ring-emerald-500 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <option value="">Peko&apos;s model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline dark:text-slate-500">
          {IS_MAC ? "⌘↵" : "Ctrl+↵"} to send
        </span>
        {busy && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            title="Stop"
            aria-label="Stop"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        )}
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          title={`Send (${IS_MAC ? "⌘↵" : "Ctrl+↵"})`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
