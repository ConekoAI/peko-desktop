import { useState, useRef, type KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { useChannelPost } from "../hooks/useChannelPost";
import type { RuntimeId } from "../lib/api";

/**
 * PR-2a post composer. Mounts at the bottom of `<ChannelView>`. The
 * submit path is `useChannelPost` (a TanStack Query mutation) — the
 * mutation invalidates `["channel-events", channelId]` on success so
 * the new message appears in the list without a manual refresh.
 *
 * `Cmd+Enter` submits, matching the established chat composer pattern
 * (`src/components/ChatComposer.tsx`). Submit is disabled while the
 * mutation is pending; the textarea stays focusable so the user can
 * keep typing into a follow-up message while the previous one
 * commits.
 *
 * The `senderName` is required: the runtime enforces sender
 * membership, so posting from an empty/non-member name errors out.
 * PR-3 will let users pick from a dropdown; for PR-2a we accept the
 * currently-active principal via the `senderName` prop.
 */
export default function ChannelComposer({
  channelId,
  senderName,
  runtimeId,
}: {
  channelId: string;
  senderName: string;
  runtimeId?: RuntimeId;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mutation = useChannelPost(runtimeId);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !mutation.isPending;

  async function submit() {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        channelId,
        senderName,
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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      {mutation.isError && (
        <div
          className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          data-testid="channel-composer-error"
        >
          {mutation.error?.message ?? "Failed to post message"}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message #${channelId} (Cmd+Enter to send)`}
          rows={2}
          disabled={mutation.isPending}
          data-testid="channel-composer-input"
          className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          data-testid="channel-composer-send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          aria-label="Send message"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
        Sending as <span className="font-mono">{senderName}</span>
      </div>
    </div>
  );
}