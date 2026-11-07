import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Users, X } from "lucide-react";

import { useNavigate } from "@tanstack/react-router";

import { useChannelCreate } from "../../hooks/useChannels";
import { usePrincipals } from "../../hooks/usePrincipals";
import { useRemotePrincipals } from "../../hooks/useRemotePrincipals";
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
  onCreatePeko,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (channelId: string) => void;
  /** Open the new-peko flow (no peko lives on this computer). */
  onCreatePeko?: () => void;
}) {
  const { data: principals, isLoading: principalsLoading } = usePrincipals();
  // A group lives with the peko that starts it. With none here, one of
  // your pekos on another computer can start it for you.
  const { data: remotes } = useRemotePrincipals();
  const yoursElsewhere = useMemo(
    () => (remotes ?? []).filter((r) => r.fromAccount),
    [remotes],
  );
  const navigate = useNavigate();
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
        label: p.name,
      })),
    [principals],
  );

  const errorMessage =
    createMut.error instanceof Error
      ? createMut.error.message
      : createMut.error
        ? String(createMut.error)
        : null;

  // Escape closes the modal and focus stays inside it. Hooks run on

  // every render, open or not: called after the early return, they

  // crashed the app the first time the dialog opened (React #310).

  const containerRef = useRef<HTMLDivElement | null>(null);

  useModalA11y(open, containerRef, onClose);


  if (!open) return null;

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
      <div className="flex w-full max-w-md flex-col rounded-xl border border-line bg-surface-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand" />
            <h2
              id="channel-create-modal-title"
              className="text-base font-semibold text-fg"
            >
              New group
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm text-fg-soft">
          <p className="text-xs text-fg-muted">
            A group is a chat with you and several pekos. You can add more
            people and pekos later.
          </p>

          <div>
            <label
              htmlFor="channel-name"
              className="mb-1 block text-xs font-medium text-fg-muted"
            >
              Group name <span className="text-red-500">*</span>
            </label>
            <input
              id="channel-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="team"
              maxLength={64}
              className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              data-testid="channel-create-name"
            />
            {name && !nameValid && (
              <p className="mt-1 text-xs text-danger">
                Use 1–64 characters.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="channel-creator"
              className="mb-1 block text-xs font-medium text-fg-muted"
            >
              Started by <span className="text-red-500">*</span>
            </label>
            {principalsLoading && (
              <p className="text-xs text-fg-muted">
                Loading your pekos…
              </p>
            )}
            {!principalsLoading && principalItems.length === 0 && (
              <NoPekoHere
                groupName={trimmedName}
                yoursElsewhere={yoursElsewhere}
                onAsk={(peko) => {
                  onClose();
                  navigate({
                    to: "/chat/$pekoName",
                    params: { pekoName: peko.principalName },
                    search: { runtimeId: peko.runtimeId, say: askToStart(trimmedName) },
                  });
                }}
                onCreatePeko={onCreatePeko}
              />
            )}
            {!principalsLoading && principalItems.length > 0 && (
              <select
                id="channel-creator"
                value={creatorName ?? ""}
                onChange={(e) => setCreatorName(e.target.value || null)}
                className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
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
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-surface-card px-4 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          {(principalsLoading || principalItems.length > 0) && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50"
            data-testid="channel-create-submit"
          >
            <Check className="h-3.5 w-3.5" />
            {createMut.isPending ? "Creating…" : "Create"}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** What you ask a peko of yours to do when it starts a group for you. */
export function askToStart(groupName: string): string {
  return `Please start a group called "${groupName}", add me to it, and register it on PekoHub (invite only) so it reaches my other computers.`;
}

/**
 * No peko lives on this computer, and a group lives with the peko that
 * starts it: ask one of yours on another computer, or make one here.
 */
function NoPekoHere({
  groupName,
  yoursElsewhere,
  onAsk,
  onCreatePeko,
}: {
  groupName: string;
  yoursElsewhere: {
    principalName: string;
    displayName: string;
    runtimeId: string;
  }[];
  onAsk: (peko: { principalName: string; runtimeId: string }) => void;
  onCreatePeko?: () => void;
}) {
  return (
    <div
      className="space-y-2 text-xs text-fg-muted"
      data-testid="channel-create-no-peko"
    >
      <p>
        A group lives on the computer of the peko that starts it, and none of
        your pekos live on this one.
      </p>
      {yoursElsewhere.length > 0 && (
        <>
          <p>
            {groupName
              ? "Ask one of yours on another computer to start it; it adds you, and the group shows up here too."
              : "Name the group, then ask one of yours on another computer to start it."}
          </p>
          <div className="flex flex-wrap gap-2">
            {yoursElsewhere.map((peko) => (
              <button
                key={`${peko.runtimeId}/${peko.principalName}`}
                type="button"
                disabled={!groupName}
                onClick={() => onAsk(peko)}
                className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
                data-testid={`channel-create-ask-${peko.principalName}`}
              >
                Ask {peko.displayName || peko.principalName}
              </button>
            ))}
          </div>
        </>
      )}
      {onCreatePeko && (
        <button
          type="button"
          onClick={onCreatePeko}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft hover:bg-surface-sunken"
          data-testid="channel-create-new-peko"
        >
          Create a peko on this computer
        </button>
      )}
    </div>
  );
}
