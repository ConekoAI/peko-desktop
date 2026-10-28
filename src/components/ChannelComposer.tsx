import { useState, useRef, type KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { useChannelPost } from "../hooks/useChannelPost";
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
  // Computed outside the JSX: the `isChannelForbidden` type guard
  // narrows `mutation.error` to `never` in the generic branch.
  const errorMessage = mutation.error?.message ?? "Failed to post message";

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
    // Enter sends; Shift+Enter adds a line; never mid-IME-composition.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  }

  return (
    <div className="border-t border-line bg-surface p-3">
      {mutation.isError && (
        isChannelForbidden(mutation.error) ? (
          <div
            className="mb-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn"
            data-testid="channel-composer-forbidden"
          >
            You don&apos;t have access to this channel — only members can
            post. Ask a current member to invite you.
          </div>
        ) : (
          <div
            className="mb-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-red-700 dark:text-red-300"
            data-testid="channel-composer-error"
          >
            {errorMessage}
          </div>
        )
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message #${channelId}`}
          rows={2}
          disabled={mutation.isPending}
          data-testid="channel-composer-input"
          className="flex-1 resize-none rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50"
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
      <div className="mt-1 px-1 text-[10px] text-fg-subtle">
        Sending as <span className="font-mono">{senderName}</span>
      </div>
    </div>
  );
}