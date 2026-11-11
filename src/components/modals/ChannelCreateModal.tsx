import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { t as translate } from "../../i18n";

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
  const { t } = useTranslation();
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
      className="modal-backdrop"
    >
      <div className="modal-panel flex w-full max-w-md flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-text" />
            <h2
              id="channel-create-modal-title"
              className="modal-title"
            >
              {t("channel.create.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="btn-icon -mr-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm text-fg-soft">
          <p className="text-xs text-fg-muted">
            {t("channel.create.intro")}
          </p>

          <div>
            <label
              htmlFor="channel-name"
              className="field-label mb-1.5 block"
            >
              {t("channel.create.name")} <span className="text-danger">*</span>
            </label>
            <input
              id="channel-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="team"
              maxLength={64}
              className="input"
              data-testid="channel-create-name"
            />
            {name && !nameValid && (
              <p className="mt-1 text-xs text-danger">
                {t("channel.create.nameInvalid")}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="channel-creator"
              className="field-label mb-1.5 block"
            >
              {t("channel.create.startedBy")} <span className="text-danger">*</span>
            </label>
            {principalsLoading && (
              <p className="text-xs text-fg-muted">
                {t("channel.create.loadingPekos")}
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
                className="select"
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

        <div className="modal-footer shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            {t("common.cancel")}
          </button>
          {(principalsLoading || principalItems.length > 0) && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary"
            data-testid="channel-create-submit"
          >
            <Check className="h-3.5 w-3.5" />
            {createMut.isPending ? t("channel.create.creating") : t("channel.create.create")}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** What you ask a peko of yours to do when it starts a group for you. */
export function askToStart(groupName: string): string {
  return translate("channel.create.askToStart", { name: groupName });
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
  const { t } = useTranslation();
  return (
    <div
      className="space-y-2 text-xs text-fg-muted"
      data-testid="channel-create-no-peko"
    >
      <p>
        {t("channel.create.noPekoHere")}
      </p>
      {yoursElsewhere.length > 0 && (
        <>
          <p>
            {groupName
              ? t("channel.create.askElsewhere")
              : t("channel.create.nameFirst")}
          </p>
          <div className="flex flex-wrap gap-2">
            {yoursElsewhere.map((peko) => (
              <button
                key={`${peko.runtimeId}/${peko.principalName}`}
                type="button"
                disabled={!groupName}
                onClick={() => onAsk(peko)}
                className="btn-primary btn-sm"
                data-testid={`channel-create-ask-${peko.principalName}`}
              >
                {t("channel.create.ask", { name: peko.displayName || peko.principalName })}
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
          {t("channel.create.createPekoHere")}
        </button>
      )}
    </div>
  );
}
