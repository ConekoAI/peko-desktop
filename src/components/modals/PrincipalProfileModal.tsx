import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  usePrincipal,
  usePrincipalRemove,
  usePrincipalUpdate,
} from "../../hooks/usePrincipals";
import {
  usePrincipalStatus,
  statusBadge,
  type PrincipalStatusValue,
} from "../../hooks/usePrincipalStatus";
import { useModels } from "../../hooks/useModels";
import { useSettings } from "../../hooks/useSettings";
import { principalSetStatus, principalMintInvite, principalRevokeInvite, type MintedInvite } from "../../lib/api";
import {
  X,
  Bot,
  Activity,
  MessageSquare,
  Loader2,
  Settings,
  Trash2,
  AlertTriangle,
  Link2,
  Copy,
  Check,
  Circle,
} from "lucide-react";

interface PrincipalProfileModalProps {
  open: boolean;
  principalName: string;
  onClose: () => void;
  onRemoved?: () => void;
}

const STATUS_OPTIONS: Array<{ value: PrincipalStatusValue; label: string }> = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "busy", label: "Busy" },
  { value: "error", label: "Error" },
];

const EXPOSURE_OPTIONS = [
  { value: "unexposed", label: "Unexposed" },
  { value: "private", label: "Private" },
  // PR #4 / PR #2: `unlisted` ships in the runtime's Exposure enum
  // (peko-rs/auth/src/host.rs). It means "chat-reachable by URL but
  // not discoverable" — the recommended default when sharing with a
  // specific friend who has a share link but you don't want to be
  // in the public directory.
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

/**
 * Principal detail / settings modal. Supports viewing the current
 * config, editing mutable fields (description, status, exposure, pinned
 * model), and removing the principal with a confirmation step.
 */
export default function PrincipalProfileModal({
  open,
  principalName,
  onClose,
  onRemoved,
}: PrincipalProfileModalProps) {
  const navigate = useNavigate();
  const { data: principal, isLoading } = usePrincipal(principalName);
  const { data: models, isLoading: modelsLoading } = useModels();
  const { data: settings } = useSettings();
  const pekohubBaseUrl = useMemo(
    () =>
      settings?.find((s) => s.key === "pekohub.base_url")?.value ??
      "https://pekohub.org",
    [settings],
  );

  // PR #9: the displayed status is the LIVE runtime/hub heartbeat,
  // not the snapshot captured in `principal.status`. The hook splits
  // local vs remote by `principal.runtimeId`: local → principal_get
  // IPC at 10s; remote → hub /v1/public/principals poll at 30s.
  // `hubUrlForRemote` is forwarded only when the runtime is a hub
  // remote, and resolved from the persisted pekohub.base_url setting
  // (same source the share-link panel uses below) so polling lands
  // on the same hub that minted the share URL.
  const isRemote = !!principal && principal.runtimeId !== "local" && !!principal.runtimeId;
  const statusQuery = usePrincipalStatus(
    principal?.runtimeId ?? "local",
    principalName,
    isRemote ? principal?.owner : undefined,
    isRemote ? pekohubBaseUrl : undefined,
  );
  const liveStatus = statusQuery.data;
  const currentStatus: PrincipalStatusValue = liveStatus?.status ?? "unknown";

  const updateMut = usePrincipalUpdate();
  const removeMut = usePrincipalRemove();

  const [isEditing, setIsEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [exposure, setExposure] = useState("");
  const [modelId, setModelId] = useState<string>("");
  // Toggles `Copy` → `Check` icon for 2s after a successful clipboard
  // write. Lives in local component state — the icon swap is purely
  // cosmetic and resetting on remount is fine (no need to lift).
  const [copied, setCopied] = useState(false);

  // PR #11: invite-link generation. `mintedInvite` is the most
  // recent successful `principal_mint_invite` response (carries the
  // token, the share URL, and the full claims incl. `jti` and
  // `exp`). `mintingInvite` tracks the in-flight call so the
  // button shows a spinner. `mintError` is shown inline if the
  // daemon rejects (e.g. caller lacks `ManageSettings`).
  const [mintedInvite, setMintedInvite] = useState<MintedInvite | null>(null);
  const [mintingInvite, setMintingInvite] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [revokingInvite, setRevokingInvite] = useState(false);

  const handleMintInvite = async () => {
    if (!principal) return;
    setMintingInvite(true);
    setMintError(null);
    try {
      const minted = await principalMintInvite({
        name: principal.name,
        scope: ["chat"],
        ttlSecs: 7 * 24 * 60 * 60,
        runtimeId: principal.runtimeId,
      });
      setMintedInvite(minted);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : String(err));
    } finally {
      setMintingInvite(false);
    }
  };

  const handleRevokeInvite = async () => {
    if (!mintedInvite || !principal) return;
    setRevokingInvite(true);
    setMintError(null);
    try {
      await principalRevokeInvite({
        name: principal.name,
        jti: mintedInvite.claims.jti,
        runtimeId: principal.runtimeId,
      });
      // Clear the rendered link so the user sees the burn took
      // effect. The runtime's in-memory revocation set rejects
      // any subsequent request carrying this token, but the
      // token has already been removed from the user's view.
      setMintedInvite(null);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevokingInvite(false);
    }
  };

  const shareUrl = useMemo(() => {
    if (!principal) return null;
    if (principal.exposure !== "public") return null;
    return `${pekohubBaseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(
      principal.owner,
    )}/${encodeURIComponent(principal.name)}`;
  }, [principal, pekohubBaseUrl]);

  const modelItems = useMemo(() => resolveModelItems(models), [models]);
  const selectedModel = useMemo(
    () => modelItems.find((m) => m.id === modelId),
    [modelItems, modelId],
  );

  useEffect(() => {
    if (!open) {
      setIsEditing(false);
      setConfirmingRemove(false);
      setDescription("");
      setStatus("");
      setExposure("");
      setModelId("");
      setCopied(false);
      setMintedInvite(null);
      setMintError(null);
      updateMut.reset();
      removeMut.reset();
      return;
    }
  }, [open]);

  useEffect(() => {
    if (principal) {
      setDescription(principal.description ?? "");
      setStatus(principal.status ?? "");
      setExposure(principal.exposure ?? "");
      setModelId(principal.preferredModelId ?? "");
    }
  }, [principal]);

  if (!open) return null;

  function handleSave() {
    if (!principal) return;
    const payload = {
      name: principalName,
      description: description.trim() || undefined,
      status: status || undefined,
      exposure: exposure || undefined,
      preferredModelId: modelId || undefined,
    };
    updateMut.mutate(payload, {
      onSuccess: () => setIsEditing(false),
    });
  }

  // PR #9: status is a single-action edit (no other fields to bundle).
  // Fire-and-forget through `principalSetStatus` so the heartbeat
  // picks up the new value on the next poll cycle (~10s for local).
  // Only valid for local principals — the Rust IPC rejects non-local
  // runtime_ids, and the dropdown is hidden for remotes above.
  function handleQuickStatusChange(next: string) {
    setStatus(next);
    if (!principal) return;
    principalSetStatus({
      name: principalName,
      status: next,
      runtimeId: principal.runtimeId,
    }).catch((err: unknown) => {
      // The Save flow surfaces its own error; for the inline status
      // edit we just log so the modal doesn't deadlock on Save
      // failure.
      console.error("principalSetStatus failed", err);
    });
  }

  function handleRemove() {
    removeMut.mutate(
      { name: principalName },
      {
        onSuccess: () => {
          onRemoved?.();
          onClose();
        },
      },
    );
  }

  async function handleCopyShareLink() {
    if (!shareUrl) return;
    // navigator.clipboard is unavailable in older WebViews and some
    // Tauri permission profiles; fall back to a hidden-textarea
    // selection so the action still works in either environment.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Swallow: clipboard write failed (permissions / non-secure
      // context). The button is non-destructive — user can still copy
      // by selecting the URL bar text manually.
    }
  }

  const updateError =
    updateMut.error instanceof Error
      ? updateMut.error.message
      : updateMut.error
        ? String(updateMut.error)
        : null;

  const removeError =
    removeMut.error instanceof Error
      ? removeMut.error.message
      : removeMut.error
        ? String(removeMut.error)
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[75vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/50">
              <Bot className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : principal ? (
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {principal.name}
                </h2>
                {principal.description && !isEditing && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {principal.description}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Principal not found
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {principal && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                title="Edit"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          {principal && !isEditing && (
            <>
              <Row label="Description" value={principal.description || "—"} />
              {/* PR #9: live status badge, polled via usePrincipalStatus.
                  For local principals we also surface a "Quick status"
                  dropdown inside `isEditing` (PR #3 added the
                  `principalSetStatus` IPC arm). For remote principals,
                  status is owner-controlled via the pekohub dashboard
                  and we deliberately don't expose the editor here. */}
              <StatusBadgeRow
                status={currentStatus}
                loading={statusQuery.isLoading && !liveStatus}
                isRemote={isRemote}
              />
              <Row label="Exposure" value={principal.exposure || "—"} />
              <Row
                label="Preferred model"
                value={
                  selectedModel?.displayName ??
                  principal.preferredModelId ??
                  "—"
                }
              />
              <Row label="Owner" value={principal.owner} />
              <Row label="Runtime" value={principal.runtimeId} />
              {/* Public share link (PR-D). Only meaningful when exposure
                  is `public` — otherwise the link would 404 on the
                  hub. Mirrors the BundleCard copy-install-command
                  pattern: read-only URL + a click-to-copy button that
                  briefly swaps to a check mark. */}
              {shareUrl !== null && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <div className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-emerald-900 dark:text-emerald-200">
                        Share link
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                        {shareUrl}
                      </p>
                      <button
                        onClick={handleCopyShareLink}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                        data-testid="copy-share-link"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copy link
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* PR #11: invite link (share with one friend). A signed
                  token embedded in the URL — anyone with the URL can
                  chat until the owner revokes the `jti`. The mint
                  button is hidden for `unexposed` / `private` (no
                  point — the recipient would 404 on the hub); for
                  `public` / `unlisted` we offer it as a one-click
                  alternative to the world-readable share link above. */}
              {(principal.exposure === "public" ||
                principal.exposure === "unlisted") && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
                  <div className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-violet-900 dark:text-violet-200">
                        Invite link
                      </p>
                      <p className="mt-0.5 text-[11px] text-violet-700 dark:text-violet-300">
                        Share with one friend. Burns immediately on revoke.
                      </p>
                      {mintError && (
                        <p
                          className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
                          data-testid="invite-error"
                        >
                          {mintError}
                        </p>
                      )}
                      {mintedInvite ? (
                        <>
                          <p
                            className="mt-2 break-all font-mono text-[11px] text-violet-700 dark:text-violet-300"
                            data-testid="invite-url"
                          >
                            {mintedInvite.url}
                          </p>
                          <p className="mt-1 text-[10px] text-violet-600/70 dark:text-violet-400/70">
                            jti {mintedInvite.claims.jti.slice(0, 8)}…
                            {" · "}
                            expires{" "}
                            {new Date(
                              mintedInvite.claims.exp * 1000,
                            ).toLocaleString()}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    mintedInvite.url,
                                  );
                                } catch {
                                  /* clipboard denied — non-fatal */
                                }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300 dark:hover:bg-violet-950"
                              data-testid="copy-invite-link"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </button>
                            <button
                              onClick={handleRevokeInvite}
                              disabled={revokingInvite}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-950"
                              data-testid="burn-invite"
                            >
                              {revokingInvite ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              Burn
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={handleMintInvite}
                          disabled={mintingInvite}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300 dark:hover:bg-violet-950"
                          data-testid="generate-invite"
                        >
                          {mintingInvite ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5" />
                          )}
                          Generate invite link
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {principal && isEditing && (
            <>
              <div>
                <label
                  htmlFor="principal-description"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Description
                </label>
                <textarea
                  id="principal-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this principal does"
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* PR #9: live status badge is shown above in the
                    read-only view. The "Quick status" dropdown here
                    is local-only — remote principals' status is
                    owner-controlled from the pekohub dashboard (PR
                    #7) and the runtime IPC doesn't accept
                    `set-status` for a hub remote. Keeping the field
                    out of the layout also avoids the empty-cell
                    rendering trap that would otherwise shift the
                    exposure select to a 1/2 grid by itself. */}
                {!isRemote && (
                  <div>
                    <label
                      htmlFor="principal-status"
                      className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      Quick status
                    </label>
                    <select
                      id="principal-status"
                      value={status}
                      onChange={(e) => handleQuickStatusChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                    >
                      <option value="">—</option>
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="principal-exposure"
                    className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    Exposure
                  </label>
                  <select
                    id="principal-exposure"
                    value={exposure}
                    onChange={(e) => setExposure(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">—</option>
                    {EXPOSURE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="principal-model"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Preferred model
                </label>
                {modelsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : modelItems.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No configured models. Add one in Settings → Models first.
                  </p>
                ) : (
                  <select
                    id="principal-model"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">— None —</option>
                    {modelItems.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}

          {(updateError || removeError) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {updateError || removeError}
            </div>
          )}

          {confirmingRemove && principal && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <div className="text-xs text-red-800 dark:text-red-300">
                  <p className="font-medium">
                    Remove <code>{principal.name}</code>?
                  </p>
                  <p className="mt-1">
                    This deletes the principal workspace and all its sessions.
                    This cannot be undone.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          {principal && (isEditing || confirmingRemove) ? (
            <button
              onClick={() =>
                confirmingRemove
                  ? setConfirmingRemove(false)
                  : setConfirmingRemove(true)
              }
              disabled={removeMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmingRemove ? "Cancel remove" : "Remove"}
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {principal && !isEditing && !confirmingRemove && (
              <>
                <button
                  onClick={() => {
                    onClose();
                    navigate({
                      to: "/chat/$principalName",
                      params: { principalName: principal.name },
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat
                </button>
                <button
                  onClick={() => {
                    onClose();
                    navigate({
                      to: "/log/$principalName",
                      params: { principalName: principal.name },
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Activity className="h-3.5 w-3.5" />
                  Activity Log
                </button>
              </>
            )}

            {isEditing && (
              <>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    if (principal) {
                      setDescription(principal.description ?? "");
                      setStatus(principal.status ?? "");
                      setExposure(principal.exposure ?? "");
                      setModelId(principal.preferredModelId ?? "");
                    }
                  }}
                  disabled={updateMut.isPending}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {updateMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Save
                </button>
              </>
            )}

            {confirmingRemove && (
              <>
                <button
                  onClick={() => setConfirmingRemove(false)}
                  disabled={removeMut.isPending}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemove}
                  disabled={removeMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {removeMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Confirm remove
                </button>
              </>
            )}

            {!isEditing && !confirmingRemove && (
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

/**
 * PR #9: live status badge row. Replaces the old `Row label="Status"
 * value={principal.status || "—"}` which always rendered the
 * at-load-time snapshot — a value that drifts out of date as soon as
 * the runtime's heartbeat updates.
 *
 * `loading` is `true` only until the first polled value lands; after
 * that we keep the last-known badge visible (no skeleton flicker
 * between polls). The icon is selected by `statusBadge(value)` so the
 * color and shape stay in lockstep with the sidebar's
 * `RuntimeIndicator` in PR #61.
 */
function StatusBadgeRow({
  status,
  loading,
  isRemote,
}: {
  status: PrincipalStatusValue;
  loading: boolean;
  isRemote: boolean;
}) {
  const badge = statusBadge(status);
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Status
      </span>
      <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
        <Circle
          className={`h-2.5 w-2.5 fill-current ${badge.color}`}
          aria-hidden="true"
        />
        <span data-testid="live-status-label">{loading ? "…" : badge.label}</span>
        <span className="ml-1 text-[10px] font-normal text-slate-400 dark:text-slate-500">
          {isRemote ? "hub heartbeat" : "runtime heartbeat"}
        </span>
      </span>
    </div>
  );
}

interface ModelItem {
  id: string;
  displayName: string;
}

function resolveModelItems(models: unknown): ModelItem[] {
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const obj = m as Record<string, unknown>;
      const id =
        typeof obj.id === "string"
          ? obj.id
          : typeof obj.model_id === "string"
            ? obj.model_id
            : null;
      const displayName =
        typeof obj.displayName === "string"
          ? obj.displayName
          : typeof obj.display_name === "string"
            ? obj.display_name
            : id;
      if (!id) return null;
      return { id, displayName: displayName ?? id };
    })
    .filter((x): x is ModelItem => x !== null);
}
