import { useEffect, useState } from "react";
import { Check, Globe, Link as LinkIcon, X } from "lucide-react";

import {
  parseShareUrl,
  useRemotePrincipalAdd,
  useRemotePrincipalResolve,
} from "../../hooks/useRemotePrincipals";

/**
 * PR #4: paste a pekohub share link, resolve it through the hub's
 * public endpoint, and add the verified principal to the desktop's
 * `~/.peko/remote-principals.json` table.
 *
 * Flow:
 *   1. User pastes a `${hubUrl}/p/{owner}/{name}` (or legacy
 *      `${hubUrl}/v1/public/principals/...`) URL.
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
    setParsed(parseShareUrl(value.trim()));
    // Any new edit invalidates the prior resolution so the user
    // can't accidentally add stale data after editing the URL.
    if (resolveMut.data) resolveMut.reset();
  }

  function handleCheck() {
    if (!parsed) return;
    resolveMut.mutate(shareUrl.trim());
  }

  function handleAdd() {
    if (!parsed) return;
    addMut.mutate(shareUrl.trim(), {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Connect to a Remote Principal
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
            Paste a pekohub share link to add a principal published by
            someone else. The link looks like{" "}
            <code className="font-mono">https://pekohub.org/p/alice/coding-assistant</code>.
          </p>

          <div>
            <label
              htmlFor="remote-share-url"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Share link
            </label>
            <div className="relative">
              <LinkIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                id="remote-share-url"
                autoFocus
                value={shareUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://pekohub.org/p/owner/name"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            {shareUrl.trim() && !parsed && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                That doesn&apos;t look like a pekohub share link. Expected{" "}
                <code className="font-mono">/p/owner/name</code> or{" "}
                <code className="font-mono">/v1/public/principals/owner/name</code>.
              </p>
            )}
            {parsed && parsed.inviteToken && (
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                Invite token detected — the principal&apos;s owner shared this
                link privately with you.
              </p>
            )}
          </div>

          {resolved && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-slate-900 dark:text-white">
                  {resolved.displayName}
                </span>
                <ExposureBadge exposure={resolved.exposure} />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Owned by <span className="font-mono">{resolved.owner}</span> on{" "}
                <span className="font-mono">{resolved.hubUrl}</span>
              </p>
              {resolved.description && (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                  {resolved.description}
                </p>
              )}
              <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Status: {resolved.status}
              </p>
            </div>
          )}

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
          {!resolved && (
            <button
              onClick={handleCheck}
              disabled={!canCheck}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-4 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:bg-slate-900 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              {resolveMut.isPending ? "Checking…" : "Check"}
            </button>
          )}
          {resolved && (
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {addMut.isPending ? "Adding…" : "Add"}
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
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    unlisted:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    private: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    unexposed:
      "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
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