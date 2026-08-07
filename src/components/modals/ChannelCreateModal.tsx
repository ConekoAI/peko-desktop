import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Hash, X } from "lucide-react";

import { useChannelCreate } from "../../hooks/useChannels";
import { usePrincipals } from "../../hooks/usePrincipals";
import { useModalA11y } from "../../hooks/useModalA11y";

/**
 * PR-3: in-app channel creation. Wires the desktop to the runtime's
 * `channel_create` IPC variant. The user picks a local principal as
 * the creator and supplies a channel name; the runtime mints the
 * `ChannelId` and returns it so the modal can navigate to
 * `/channels/<id>` without a follow-up list refresh.
 *
 * Mirrors `CreatePrincipalModal` shape:
 *   - reset-on-open (avoids stale form bleed-in)
 *   - mutation.reset() on open so a previous failure doesn't linger
 *   - error displayed in a red card; the modal stays open on error
 *     so the user can fix + retry without losing context
 *
 * Tier selector: the runtime ships Runtime-tier only for now
 * (`peko_runtime::ipc::packet::RequestPacket::ChannelCreate` is the
 * only create variant). Shared-tier pinning is a separate
 * `ChannelPinToShared` command and isn't surfaced here yet — that's
 * a follow-up that lands with the shared-tier UX work.
 */
export default function ChannelCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (channelId: string) => void;
}) {
  const { data: principals, isLoading: principalsLoading } = usePrincipals();
  const [name, setName] = useState("");
  const [creatorName, setCreatorName] = useState<string | null>(null);

  // Default creator selection: pick the first local principal. If the
  // user has none, we leave creatorName unset and the submit button
  // stays disabled until they explicitly pick one.
  useEffect(() => {
    if (open && !creatorName && principals && principals.length > 0) {
      setCreatorName(principals[0].name);
    }
  }, [open, principals, creatorName]);

  const createMut = useChannelCreate();

  // Reset form when reopened so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setName("");
      setCreatorName(principals && principals.length > 0 ? principals[0].name : null);
      createMut.reset();
    }
    // We intentionally exclude `createMut` to avoid resetting on every
    // mutation status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 64;
  const canSubmit =
    !!creatorName && nameValid && !createMut.isPending && (principals?.length ?? 0) > 0;

  function handleSubmit() {
    if (!creatorName || !nameValid) return;
    createMut.mutate(
      { creatorName, name: trimmedName },
      {
        onSuccess: (channelId) => {
          if (channelId) {
            onCreated?.(channelId);
          }
          onClose();
        },
      },
    );
  }

  const principalItems = useMemo(
    () =>
      (principals ?? []).map((p) => ({
        name: p.name,
        label: p.description ? `${p.name} — ${p.description}` : p.name,
      })),
    [principals],
  );

  const errorMessage =
    createMut.error instanceof Error
      ? createMut.error.message
      : createMut.error
        ? String(createMut.error)
        : null;

  if (!open) return null;

  // P1.5: Escape closes the modal + focus is trapped inside it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(open, containerRef, onClose);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-create-modal-title"
      onClick={(e) => {
        // Backdrop click closes the modal — clicking inside the
        // inner card stops propagation so the form fields don't
        // accidentally dismiss the dialog. P1.5 UX parity.
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2
              id="channel-create-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-white"
            >
              Create a Channel
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Channels are multi-principal chats. The creator owns the
            channel and can invite other principals (local or on
            remote runtimes) to join.
          </p>

          <div>
            <label
              htmlFor="channel-name"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Channel name <span className="text-red-500">*</span>
            </label>
            <input
              id="channel-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="team"
              maxLength={64}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              data-testid="channel-create-name"
            />
            {name && !nameValid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Use 1–64 characters.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="channel-creator"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Creator <span className="text-red-500">*</span>
            </label>
            {principalsLoading && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Loading principals…
              </p>
            )}
            {!principalsLoading && principalItems.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No local principals yet. Create one first via the
                Principals sidebar.
              </p>
            )}
            {!principalsLoading && principalItems.length > 0 && (
              <select
                id="channel-creator"
                value={creatorName ?? ""}
                onChange={(e) => setCreatorName(e.target.value || null)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                data-testid="channel-create-creator"
              >
                {principalItems.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            data-testid="channel-create-submit"
          >
            <Check className="h-3.5 w-3.5" />
            {createMut.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}