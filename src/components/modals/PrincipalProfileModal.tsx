import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  usePrincipal,
  usePrincipalRemove,
  usePrincipalUpdate,
} from "../../hooks/usePrincipals";
import { useModels } from "../../hooks/useModels";
import { useSettings } from "../../hooks/useSettings";
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
} from "lucide-react";

interface PrincipalProfileModalProps {
  open: boolean;
  principalName: string;
  onClose: () => void;
  onRemoved?: () => void;
}

const STATUS_OPTIONS = [
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

  const { data: settings } = useSettings();
  const pekohubBaseUrl = useMemo(
    () =>
      settings?.find((s) => s.key === "pekohub.base_url")?.value ??
      "https://pekohub.org",
    [settings],
  );
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
              <Row label="Status" value={principal.status || "—"} />
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
                <div>
                  <label
                    htmlFor="principal-status"
                    className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    Status
                  </label>
                  <select
                    id="principal-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
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
