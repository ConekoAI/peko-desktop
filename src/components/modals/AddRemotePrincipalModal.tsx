import { useEffect, useState } from "react";
import { Check, Globe, Link as LinkIcon, X } from "lucide-react";

import {
  parseShareUrl,
  shareLinkFromInput,
  useRemotePrincipalAdd,
  useRemotePrincipalResolve,
} from "../../hooks/useRemotePrincipals";
import { useSettings } from "../../hooks/useSettings";
import { configuredHubUrl } from "../../lib/api";

/**
 * PR #4: paste a pekohub share link, resolve it through the hub's
 * public endpoint, and add the verified principal to the desktop's
 * `~/.peko/remote-principals.json` table.
 *
 * Flow:
 *   1. User pastes a `${hubUrl}/@{owner}/{name}` share URL, or types the
 *      peko's ID, `@owner/name`, which names a peko on the configured
 *      hub (pekohub ADR-009). The older `/peko/...`, `/p/...` and
 *      `/v1/public/principals/...` forms are still accepted.
 *   2. Inline parser rejects obviously bad shapes BEFORE the IPC
 *      round-trip — saves a hub HTTP call on typos.
 *   3. User clicks "Check" → `useRemotePrincipalResolve` hits the
 *      runtime, which fetches the hub and returns the canonical
 *      fields (display name, description, exposure, status).
 *   4. Confirmation card shows the resolved profile.
 *   5. User clicks "Add" → `useRemotePrincipalAdd` persists and
 *      invalidates the sidebar query. Modal closes on success.
 *
 * The shape gate is intentionally permissive: any host is accepted
 * (peko supports self-hosted hubs). The host validation happens
 * server-side when the hub returns 404 for an unknown principal.
 */
export default function AddRemotePrincipalModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: settings } = useSettings();
  const hubUrl = configuredHubUrl(settings);
  const [shareUrl, setShareUrl] = useState("");
  const [parsed, setParsed] = useState<
    | { hubUrl: string; owner: string; principalName: string; inviteToken?: string }
    | null
    >(null);

  const resolveMut = useRemotePrincipalResolve();
  const addMut = useRemotePrincipalAdd();

  // Reset form on open so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setShareUrl("");
      setParsed(null);
      resolveMut.reset();
      addMut.reset();
    }
    // We intentionally exclude mutations to avoid resetting on every
    // status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleUrlChange(value: string) {
    setShareUrl(value);
    setParsed(parseShareUrl(shareLinkFromInput(value, hubUrl)));
    // Any new edit invalidates the prior resolution so the user
    // can't accidentally add stale data after editing the URL.
    if (resolveMut.data) resolveMut.reset();
  }

  function handleCheck() {
    if (!parsed) return;
    resolveMut.mutate(shareLinkFromInput(shareUrl, hubUrl));
  }

  function handleAdd() {
    if (!parsed) return;
    addMut.mutate(shareLinkFromInput(shareUrl, hubUrl), {
      onSuccess: () => {
        onClose();
      },
    });
  }

  if (!open) return null;

  const errorMessage =
    addMut.error instanceof Error
      ? addMut.error.message
      : resolveMut.error instanceof Error
        ? resolveMut.error.message
        : addMut.error
          ? String(addMut.error)
          : resolveMut.error
            ? String(resolveMut.error)
            : null;

  const resolved = resolveMut.data;
  const canCheck = !!parsed && !resolveMut.isPending;
  const canAdd = !!resolved && !addMut.isPending;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel flex w-full max-w-md flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-ok" />
            <h2 className="modal-title">
              Add a peko
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
            Type the ID of someone&apos;s public peko, like{" "}
            <code className="font-mono">@alice/coding-assistant</code>, or paste its
            link from PekoHub.
          </p>

          <div>
            <label
              htmlFor="remote-share-url"
              className="field-label mb-1.5 block"
            >
              Peko ID or link
            </label>
            <div className="relative">
              <LinkIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-fg-subtle" />
              <input
                id="remote-share-url"
                autoFocus
                value={shareUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="@owner/name"
                className="input pl-8 pr-3 font-mono"
              />
            </div>
            {shareUrl.trim() && !parsed && (
              <p className="mt-1 text-xs text-danger">
                That doesn&apos;t look like a peko&apos;s ID or link. Expected{" "}
                <code className="font-mono">@owner/name</code> or{" "}
                <code className="font-mono">https://pekohub.ai/@owner/name</code>.
              </p>
            )}
            {parsed && parsed.inviteToken && (
              <p className="mt-1 text-xs text-ok">
                Invite token detected — the peko&apos;s owner shared this
                link privately with you.
              </p>
            )}
          </div>

          {resolved && (
            <div className="rounded-lg border border-line bg-surface-raised p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-fg">
                  {resolved.displayName}
                </span>
                <ExposureBadge exposure={resolved.exposure} />
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                Owned by <span className="font-mono">{resolved.owner}</span> on{" "}
                <span className="font-mono">{resolved.hubUrl}</span>
              </p>
              {resolved.description && (
                <p className="mt-2 text-xs text-fg-muted">
                  {resolved.description}
                </p>
              )}
              <p className="mt-2 text-[10px] uppercase tracking-wider text-fg-subtle">
                Status: {resolved.status}
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          {!resolved && (
            <button
              onClick={handleCheck}
              disabled={!canCheck}
              className="btn-secondary"
            >
              {resolveMut.isPending ? "Checking…" : "Check"}
            </button>
          )}
          {resolved && (
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {addMut.isPending ? "Adding…" : "Add peko"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Color-coded badge for the four exposure values (PR #2 + PR #4). */
function ExposureBadge({ exposure }: { exposure: string }) {
  const palette: Record<string, string> = {
    public:
      "bg-ok-soft text-ok",
    unlisted:
      "bg-warn-soft text-warn",
    private: "bg-surface-sunken text-fg-soft",
    unexposed:
      "bg-danger-soft text-danger",
  };
  const cls = palette[exposure] ?? palette.private;
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {exposure}
    </span>
  );
}