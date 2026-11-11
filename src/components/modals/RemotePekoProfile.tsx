import { useState } from "react";
import { Check, Circle, Copy, Loader2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRemotePeko, useRemotePrincipalRemove } from "../../hooks/useRemotePrincipals";
import { statusBadge } from "../../hooks/usePrincipalStatus";
import PekoAvatar from "../peko/PekoAvatar";
import { hubWebOrigin } from "../../lib/api";

/** `https://pekohub.org/` → `pekohub.org`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-sm text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-fg">{children}</span>
    </div>
  );
}

/**
 * The profile of a peko that runs on someone else's runtime and is
 * reached through a hub. The chat list doesn't tell local and remote
 * pekos apart; this is where you see where one lives, whether it's
 * online, its share link, and where you remove it from your list.
 */
export default function RemotePekoProfile({
  open,
  principalName,
  runtimeId,
  onClose,
  onRemoved,
}: {
  open: boolean;
  principalName: string;
  runtimeId: string;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const { record, status, identity, description } = useRemotePeko(runtimeId, principalName);
  const removeMut = useRemotePrincipalRemove();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const badge = statusBadge(status.data?.status ?? "unknown");
  // The peko's ID is its page on the hub's website (pekohub ADR-009). A
  // private peko has no page there, so it has no link to share.
  const shareUrl =
    record && record.exposure !== "private"
      ? `${hubWebOrigin(record.hubUrl)}/@${record.owner}/${record.principalName}`
      : null;
  const removeError =
    removeMut.error instanceof Error
      ? removeMut.error.message
      : removeMut.error
        ? String(removeMut.error)
        : null;

  function copyShareUrl() {
    if (!shareUrl) return;
    void navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function remove() {
    if (!record) return;
    removeMut.mutate(
      { hubUrl: record.hubUrl, owner: record.owner, principalName: record.principalName },
      {
        onSuccess: () => {
          onClose();
          onRemoved?.();
        },
      },
    );
  }

  return (
    <div className="modal-backdrop">
      <div
        role="dialog"
        aria-label={t("peko.remote.profileLabel", { name: principalName })}
        className="modal-panel flex max-h-[75vh] w-full max-w-lg flex-col"
      >
        <div className="modal-header shrink-0 justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <PekoAvatar peko={identity} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-fg">{principalName}</h2>
              {description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{description}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="btn-icon -mr-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          {!record ? (
            <p className="text-fg-muted">{t("peko.remote.gone")}</p>
          ) : (
            <>
              <Row label={t("common.status")}>
                <span className="inline-flex items-center gap-1.5">
                  <Circle className={`h-2.5 w-2.5 fill-current ${badge.color}`} aria-hidden="true" />
                  <span data-testid="remote-status-label">
                    {status.isLoading && !status.data ? "…" : badge.label}
                  </span>
                  <span className="text-[10px] font-normal text-fg-subtle">{t("peko.remote.viaHub")}</span>
                </span>
              </Row>
              <Row label={t("peko.remote.runsOn")}>
                {record.fromAccount
                  ? t("peko.remote.yourOtherComputer")
                  : t("peko.remote.ownersRuntime", { owner: record.owner })}
              </Row>
              <Row label={t("peko.remote.reachedThrough")}>{hostOf(record.hubUrl)}</Row>
              <Row label={t("peko.remote.access")}>
                {record.hasInviteToken
                  ? t("peko.remote.accessInvite")
                  : record.exposure === "private"
                    ? t("peko.remote.accessPrivate")
                    : t("peko.remote.accessPublic")}
              </Row>
              {shareUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-fg-soft">{shareUrl}</code>
                  <button
                    type="button"
                    onClick={copyShareUrl}
                    aria-label={t("peko.remote.copyShareLink")}
                    className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-card hover:text-fg-soft"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-brand-text" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {record?.fromAccount && (
          <p
            className="shrink-0 border-t border-line px-5 py-3 text-xs text-fg-muted"
            data-testid="own-peko-elsewhere"
          >
            {t("peko.remote.ownElsewhere")}
          </p>
        )}

        {record && !record.fromAccount && (
          <div className="shrink-0 border-t border-line px-5 py-3">
            {confirmingRemove ? (
              <div className="space-y-2">
                <p className="text-sm text-fg-soft">
                  {t("peko.remote.removeConfirm", { name: principalName, owner: record.owner })}
                </p>
                {removeError && <p className="text-xs text-danger">{removeError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-fg-soft hover:bg-surface-sunken"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={removeMut.isPending}
                    className="btn-danger-solid"
                  >
                    {removeMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t("common.remove")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg-muted hover:bg-surface-sunken hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("peko.remote.removeFromList")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
