import { useState } from "react";
import { Check, Circle, Copy, Loader2, Trash2, X } from "lucide-react";
import { useRemotePeko, useRemotePrincipalRemove } from "../../hooks/useRemotePrincipals";
import { statusBadge } from "../../hooks/usePrincipalStatus";
import PekoAvatar from "../peko/PekoAvatar";

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
  const { record, status, identity, description } = useRemotePeko(runtimeId, principalName);
  const removeMut = useRemotePrincipalRemove();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const badge = statusBadge(status.data?.status ?? "unknown");
  const shareUrl = record
    ? `${record.hubUrl.replace(/\/$/, "")}/peko/${record.owner}/${record.principalName}`
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-label={`${principalName}'s profile`}
        className="flex max-h-[75vh] w-full max-w-lg flex-col rounded-xl border border-line bg-surface shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
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
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-surface-sunken hover:text-fg-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          {!record ? (
            <p className="text-fg-muted">This peko is no longer in your list.</p>
          ) : (
            <>
              <Row label="Status">
                <span className="inline-flex items-center gap-1.5">
                  <Circle className={`h-2.5 w-2.5 fill-current ${badge.color}`} aria-hidden="true" />
                  <span data-testid="remote-status-label">
                    {status.isLoading && !status.data ? "…" : badge.label}
                  </span>
                  <span className="text-[10px] font-normal text-fg-subtle">via PekoHub</span>
                </span>
              </Row>
              <Row label="Runs on">{record.owner}'s runtime</Row>
              <Row label="Reached through">{hostOf(record.hubUrl)}</Row>
              <Row label="Access">
                {record.hasInviteToken ? "Invite link" : record.exposure === "private" ? "Private" : "Public"}
              </Row>
              {shareUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-fg-soft">{shareUrl}</code>
                  <button
                    type="button"
                    onClick={copyShareUrl}
                    aria-label="Copy share link"
                    className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-card hover:text-fg-soft"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {record && (
          <div className="shrink-0 border-t border-line px-5 py-3">
            {confirmingRemove ? (
              <div className="space-y-2">
                <p className="text-sm text-fg-soft">
                  Remove {principalName} from your list? The peko keeps running on {record.owner}'s
                  runtime; you can connect again with its share link.
                </p>
                {removeError && <p className="text-xs text-danger">{removeError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-fg-soft hover:bg-surface-sunken"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={removeMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {removeMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg-muted hover:bg-surface-sunken hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove from your list
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
