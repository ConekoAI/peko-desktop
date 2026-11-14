import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useLocalUserAccount,
  usePrincipal,
  usePrincipalExport,
  usePrincipalRemove,
  usePrincipalUpdate,
} from "../../hooks/usePrincipals";
import {
  usePrincipalStatus,
  statusBadge,
  type PrincipalStatusValue,
} from "../../hooks/usePrincipalStatus";
import { isLocalUser } from "../../hooks/usePekoDirectory";
import { useModels } from "../../hooks/useModels";
import { useSettings } from "../../hooks/useSettings";
import {
  configuredHubUrl,
  pekoShareLink,
  principalSetStatus,
  principalMintInvite,
  principalRegister,
  principalRevokeInvite,
  type LocalUserAccount,
  type MintedInvite,
} from "../../lib/api";
import type { ModelSummary, PekoRegistration } from "../../types";
import {
  X,
  MessageSquare,
  Loader2,
  Pencil,
  Trash2,
  AlertTriangle,
  Link2,
  Copy,
  Check,
  Circle,
  Package,
} from "lucide-react";
import PekoAvatar from "../peko/PekoAvatar";
import RemotePekoProfile from "./RemotePekoProfile";
import UsagePanel from "../peko/UsagePanel";
import { AVATAR_SUGGESTIONS, pekoIdentity } from "../../lib/pekoIdentity";
import { currentLocale, t as translate } from "../../i18n";

interface PrincipalProfileModalProps {
  open: boolean;
  principalName: string;
  /** Where the peko runs: `local` (default), or `hub:<url>` for a remote one. */
  runtimeId?: string;
  onClose: () => void;
  onRemoved?: () => void;
}

const STATUS_OPTIONS: PrincipalStatusValue[] = ["online", "offline", "busy", "error"];

/**
 * PekoHub registration states (ADR-081). `hint` is the one-line
 * explainer under the picker so the user sees who can reach the peko.
 */
const REGISTRATION_OPTIONS: readonly PekoRegistration[] = ["local_only", "private", "public"];

function isRegistration(value: string | undefined): value is PekoRegistration {
  return (REGISTRATION_OPTIONS as readonly string[]).includes(value ?? "");
}

function registrationLabel(exposure: string | undefined): string {
  return isRegistration(exposure)
    ? translate(`peko.profile.registration.${exposure}.label`)
    : (exposure ?? "—");
}

/**
 * Where a peko of this computer really is: its configured registration
 * once it has a PekoHub ID, else local only. A peko made here says
 * "private" before this computer signs in and puts it on PekoHub;
 * showing that as Private claimed reach it didn't have.
 */
export function effectiveRegistration(p: {
  exposure?: string;
  hubId?: string | null;
}): string {
  if (p.hubId === null && p.exposure !== "local_only") return "local_only";
  return p.exposure ?? "";
}

/**
 * The Owner row. This computer's person is one owner whether the
 * runtime calls them `user:local` or by their linked PekoHub account
 * (runtime ADR-081 D3), so both read "You", with the account when
 * there is one.
 */
export function ownerLabel(owner: string, linked: LocalUserAccount | null | undefined): string {
  if (!owner) return "—";
  if (!isLocalUser(owner, linked?.id)) return owner;
  if (!linked) return translate("peko.profile.ownerLocal");
  return linked.name
    ? translate("peko.profile.ownerHubNamed", { name: linked.name })
    : translate("peko.profile.ownerHub");
}

/**
 * Backend error prefix for the one-online-copy gate (ADR-081):
 * registering a peko the hub already has registered from another
 * runtime rejects with a message starting with this tag. The modal renders a dedicated inline
 * alert instead of the generic error box, with the tag stripped.
 */
const EXPOSURE_CONFLICT_PREFIX = "[exposure_conflict]";

/**
 * A peko's profile. A peko on this runtime gets the full settings
 * view; one on another runtime, reached through a hub, gets its remote
 * profile (where it lives, its status, removing it from the list).
 */
export default function PrincipalProfileModal(props: PrincipalProfileModalProps) {
  const { runtimeId, ...rest } = props;
  return runtimeId && runtimeId !== "local" ? (
    <RemotePekoProfile {...rest} runtimeId={runtimeId} />
  ) : (
    <LocalPekoProfile {...rest} />
  );
}

/**
 * Principal detail / settings modal. Supports viewing the current
 * config, editing mutable fields (description, status, exposure, pinned
 * model), and removing the principal with a confirmation step.
 */
function LocalPekoProfile({
  open,
  principalName,
  onClose,
  onRemoved,
}: Omit<PrincipalProfileModalProps, "runtimeId">) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: principal, isLoading } = usePrincipal(principalName);
  const { data: models, isLoading: modelsLoading } = useModels();
  const { data: settings } = useSettings();
  const pekohubBaseUrl = useMemo(
    () =>
      configuredHubUrl(settings),
    [settings],
  );

  // PR #9: the displayed status is the LIVE runtime/hub heartbeat,
  // not the snapshot captured in `principal.status`. The hook splits
  // local vs remote by `principal.runtimeId`: local → principal_get
  // IPC at 10s; remote → hub /v1/public/pekos poll at 30s.
  // `hubUrlForRemote` is forwarded only when the runtime is a hub
  // remote, and resolved from the persisted pekohub.base_url setting
  // (same source the share-link panel uses below) so polling lands
  // on the same hub that minted the share URL.
  const isRemote = !!principal && principal.runtimeId !== "local" && !!principal.runtimeId;
  const { data: linkedAccount } = useLocalUserAccount();
  const statusQuery = usePrincipalStatus(
    principal?.runtimeId ?? "local",
    principalName,
    isRemote ? principal?.owner : undefined,
    isRemote ? pekohubBaseUrl : undefined,
  );
  const liveStatus = statusQuery.data;
  const currentStatus: PrincipalStatusValue = liveStatus?.status ?? "unknown";

  const updateMut = usePrincipalUpdate();
  const qc = useQueryClient();
  const removeMut = usePrincipalRemove();

  const [isEditing, setIsEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // The remove confirmation opens below the fold of a long profile:
  // bring it into view.
  const dangerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (confirmingRemove) dangerRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [confirmingRemove]);
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState("");
  const [status, setStatus] = useState("");
  const [exposure, setExposure] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [modelId, setModelId] = useState<string>("");
  // Toggles `Copy` → `Check` icon for 2s after a successful clipboard
  // write. Lives in local component state — the icon swap is purely
  // cosmetic and resetting on remount is fine (no need to lift).
  const [copied, setCopied] = useState(false);

  // ADR-056: `.peko` export. `exportPath` is pre-filled with the
  // conventional destination when the principal loads; `exportedTo`
  // holds the path of the last successful export so the panel can
  // confirm where the package landed.
  const exportMut = usePrincipalExport();
  const [exportPath, setExportPath] = useState("");
  const [exportedTo, setExportedTo] = useState<string | null>(null);

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

  // The hub the runtime is registered with knows the owner's handle,
  // which the link is built from (not the runtime's owner id).
  const shareLinkQuery = useQuery({
    queryKey: ["peko-share-link", principal?.name, principal?.exposure],
    queryFn: () => pekoShareLink(principal!.name),
    enabled: principal?.exposure === "public",
    staleTime: 5 * 60_000,
  });
  const shareUrl = principal?.exposure === "public" ? (shareLinkQuery.data ?? null) : null;

  const modelItems = useMemo(() => resolveModelItems(models), [models]);
  // Spend is counted only when the peko's model has a price.
  const modelIsPriced = useMemo(() => {
    const preferred = (Array.isArray(models) ? (models as ModelSummary[]) : []).find(
      (m) => m.id === principal?.preferredModelId,
    );
    const pricing = preferred?.spec?.pricing;
    return !!(pricing?.input_per_million || pricing?.output_per_million);
  }, [models, principal?.preferredModelId]);
  const selectedModel = useMemo(
    () => modelItems.find((m) => m.id === modelId),
    [modelItems, modelId],
  );

  useEffect(() => {
    if (!open) {
      setIsEditing(false);
      setConfirmingRemove(false);
      setDescription("");
      setAvatar("");
      setStatus("");
      setExposure("");
      setRegisterError(null);
      setModelId("");
      setCopied(false);
      setMintedInvite(null);
      setMintError(null);
      setExportPath("");
      setExportedTo(null);
      exportMut.reset();
      updateMut.reset();
      removeMut.reset();
      return;
    }
  }, [open]);

  useEffect(() => {
    if (principal) {
      setDescription(principal.description ?? "");
      setAvatar(principal.avatar ?? "");
      setStatus(principal.status ?? "");
      setExposure(effectiveRegistration(principal));
      setModelId(principal.preferredModelId ?? "");
      // ADR-056: conventional export destination; editable.
      setExportPath(`~/.peko/exports/${principal.name}.peko`);
    }
  }, [principal]);

  if (!open) return null;

  function handleSave() {
    if (!principal) return;
    setRegisterError(null);
    const payload = {
      name: principalName,
      description: description.trim() || undefined,
      // Sent only when changed; "" clears it.
      avatar: avatar.trim() !== (principal.avatar ?? "") ? avatar.trim() : undefined,
      status: status || undefined,
      preferredModelId: modelId || undefined,
    };
    // Registration is its own runtime operation (`principal_register`
    // updates PekoHub over the tunnel), run after the config update.
    const registrationChanged =
      !isRemote && !!exposure && exposure !== effectiveRegistration(principal);
    updateMut.mutate(payload, {
      onSuccess: async () => {
        if (registrationChanged) {
          setRegistering(true);
          try {
            await principalRegister({
              name: principalName,
              registration: exposure as PekoRegistration,
              runtimeId: principal.runtimeId,
            });
            void qc.invalidateQueries({ queryKey: ["principals"] });
          } catch (err) {
            setRegisterError(err instanceof Error ? err.message : String(err));
            return;
          } finally {
            setRegistering(false);
          }
        }
        setIsEditing(false);
      },
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

  // Exposure conflict (pekohub ADR-005): the backend rejects a
  // public/unlisted set with a tagged 409 when the DID is already
  // exposed elsewhere. Strip the tag — what remains is the hub's
  // detail (e.g. the conflicting instance), rendered under the
  // dedicated copy.
  const exposureConflictDetail =
    registerError && registerError.startsWith(EXPOSURE_CONFLICT_PREFIX)
      ? registerError.slice(EXPOSURE_CONFLICT_PREFIX.length).trim()
      : null;

  const exportError =
    exportMut.error instanceof Error
      ? exportMut.error.message
      : exportMut.error
        ? String(exportMut.error)
        : null;

  // ADR-056: the export path must be a concrete `.peko` filename.
  const trimmedExportPath = exportPath.trim();
  const exportPathValid =
    trimmedExportPath.length > 0 && trimmedExportPath.endsWith(".peko");

  function handleExport() {
    if (!principal || !exportPathValid) return;
    setExportedTo(null);
    exportMut.mutate(
      { name: principal.name, output: trimmedExportPath },
      { onSuccess: () => setExportedTo(trimmedExportPath) },
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-panel flex max-h-[75vh] w-full max-w-lg flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-3">
            <PekoAvatar
              peko={pekoIdentity(
                principal
                  ? { ...principal, avatar: isEditing ? avatar : principal.avatar }
                  : { name: principalName },
              )}
              size="lg"
            />
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />
            ) : principal ? (
              <div>
                <h2 className="text-lg font-semibold text-fg">
                  {principal.name}
                </h2>
                {principal.description && !isEditing && (
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {principal.description}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">
                {t("peko.profile.notFound")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {principal && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="btn-icon -mr-1.5"
                title={t("common.edit")}
                aria-label={t("common.edit")}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="btn-icon -mr-1.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          {principal && !isEditing && (
            <>
              <Row label={t("common.description")} value={principal.description || "—"} />
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
              <Row
                label={t("peko.profile.hub")}
                value={
                  isRemote
                    ? principal.exposure || "—"
                    : registrationLabel(effectiveRegistration(principal))
                }
              />
              <Row
                label={t("peko.profile.preferredModel")}
                value={
                  selectedModel?.displayName ??
                  principal.preferredModelId ??
                  "—"
                }
              />
              <Row label={t("peko.profile.owner")} value={ownerLabel(principal.owner, linkedAccount)} />
              {!isRemote && <UsagePanel name={principal.name} priced={modelIsPriced} />}
              {/* Public share link (PR-D). Only meaningful when exposure
                  is `public` — otherwise the link would 404 on the
                  hub. Mirrors the BundleCard copy-install-command
                  pattern: read-only URL + a click-to-copy button that
                  briefly swaps to a check mark. */}
              {shareUrl !== null && (
                <div className="rounded-xl border border-line bg-surface-raised p-3.5">
                  <div className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-fg">
                        {t("peko.profile.shareLink")}
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">
                        {shareUrl}
                      </p>
                      <button
                        onClick={handleCopyShareLink}
                        className="btn-secondary btn-xs mt-2"
                        data-testid="copy-share-link"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            {t("common.copied")}
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            {t("peko.profile.copyLink")}
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
                principal.exposure === "private" ||
                principal.exposure === "unlisted") && (
                <div className="rounded-xl border border-line bg-surface-raised p-3.5">
                  <div className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-fg">
                        {t("peko.profile.inviteLink")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-fg-muted">
                        {t("peko.profile.inviteHint")}
                      </p>
                      {mintError && (
                        <p
                          className="note-danger mt-2 px-2.5 py-1.5 text-[11px]"
                          data-testid="invite-error"
                        >
                          {mintError}
                        </p>
                      )}
                      {mintedInvite ? (
                        <>
                          <p
                            className="mt-2 break-all font-mono text-[11px] text-fg-soft"
                            data-testid="invite-url"
                          >
                            {mintedInvite.url}
                          </p>
                          <p className="mt-1 text-[10px] text-fg-subtle">
                            {t("peko.profile.inviteMeta", {
                              jti: mintedInvite.claims.jti.slice(0, 8),
                              date: new Date(mintedInvite.claims.exp * 1000).toLocaleString(
                                currentLocale(),
                              ),
                            })}
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
                              className="btn-secondary btn-xs"
                              data-testid="copy-invite-link"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {t("common.copy")}
                            </button>
                            <button
                              onClick={handleRevokeInvite}
                              disabled={revokingInvite}
                              className="btn-danger btn-xs border border-danger/30"
                              data-testid="burn-invite"
                            >
                              {revokingInvite ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              {t("peko.profile.burn")}
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={handleMintInvite}
                          disabled={mintingInvite}
                          className="btn-secondary btn-xs mt-2"
                          data-testid="generate-invite"
                        >
                          {mintingInvite ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5" />
                          )}
                          {t("peko.profile.generateInvite")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* .peko export (ADR-056): full-existence package —
                  workspace, memory, AND private keys. Local runtimes
                  only (the Rust command rejects remote runtime ids).
                  The warning must be unmistakable: anyone holding the
                  package can wake and impersonate this peko. No dialog
                  plugin is available, so the destination is a validated
                  text input. */}
              {principal.runtimeId === "local" && (
                <div className="rounded-lg border border-warn/30 bg-warn-soft p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-warn">
                        {t("peko.profile.exportTitle")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-warn">
                        <Trans i18nKey="peko.profile.exportWarning" components={{ strong: <strong /> }} />
                      </p>
                      <label
                        htmlFor="peko-export-path"
                        className="mb-1 mt-2 block text-[11px] font-medium text-warn"
                      >
                        {t("peko.profile.exportPath")}
                      </label>
                      <input
                        id="peko-export-path"
                        value={exportPath}
                        onChange={(e) => setExportPath(e.target.value)}
                        className="w-full rounded-lg border border-warn/25 bg-surface px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                      />
                      {trimmedExportPath.length > 0 && !exportPathValid && (
                        <p className="mt-1 text-[11px] text-warn">
                          <Trans i18nKey="peko.profile.exportPathInvalid" components={{ code: <code /> }} />
                        </p>
                      )}
                      <button
                        onClick={handleExport}
                        disabled={!exportPathValid || exportMut.isPending}
                        data-testid="export-peko-submit"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-surface px-2.5 py-1 text-xs font-medium text-warn transition-colors hover:bg-amber-100 disabled:opacity-50"
                      >
                        {exportMut.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Package className="h-3.5 w-3.5" />
                        )}
                        {t("peko.profile.export")}
                      </button>
                      {exportError && (
                        <p
                          data-testid="export-peko-error"
                          className="note-danger mt-2 px-2.5 py-1.5 text-[11px]"
                        >
                          {exportError}
                        </p>
                      )}
                      {exportedTo && (
                        <p
                          data-testid="export-peko-success"
                          className="mt-2 break-all text-[11px] text-brand-text"
                        >
                          <Trans
                            i18nKey="peko.profile.exportedTo"
                            components={{ path: <span className="font-mono">{exportedTo}</span> }}
                          />
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <section
                ref={dangerRef}
                aria-labelledby="peko-danger-zone"
                className="rounded-lg border border-danger/30 p-3"
              >
                <h3
                  id="peko-danger-zone"
                  className="text-xs font-semibold uppercase tracking-wide text-danger"
                >
                  {t("peko.profile.dangerZone")}
                </h3>
                {confirmingRemove ? (
                  <div className="mt-2">
                    <p className="text-xs text-fg">
                      <Trans
                        i18nKey="peko.profile.removeConfirm"
                        values={{ name: principal.name }}
                        components={{ strong: <strong /> }}
                      />
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={() => setConfirmingRemove(false)}
                        disabled={removeMut.isPending}
                        className="btn-secondary btn-sm"
                      >
                        {t("peko.profile.keep", { name: principal.name })}
                      </button>
                      <button
                        onClick={handleRemove}
                        disabled={removeMut.isPending}
                        data-testid="confirm-remove-peko"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        {removeMut.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {t("peko.profile.removeNamed", { name: principal.name })}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="text-xs text-fg-muted">
                      {t("peko.profile.removeHint")}
                    </p>
                    <button
                      onClick={() => setConfirmingRemove(true)}
                      className="shrink-0 rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft"
                    >
                      {t("peko.profile.removeEllipsis")}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {principal && isEditing && (
            <>
              {!isRemote && (
                <div>
                  <label
                    htmlFor="principal-avatar"
                    className="field-label mb-1.5 block"
                  >
                    {t("peko.new.avatar")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="principal-avatar"
                      value={avatar}
                      onChange={(e) => setAvatar(e.target.value)}
                      placeholder={t("peko.profile.avatarPlaceholder")}
                      maxLength={16}
                      className="input w-40"
                    />
                    {avatar && (
                      <button
                        type="button"
                        onClick={() => setAvatar("")}
                        className="text-xs text-fg-muted hover:text-fg-soft"
                      >
                        {t("common.clear")}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("peko.profile.avatarSuggestions")}>
                    {AVATAR_SUGGESTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setAvatar(emoji)}
                        aria-label={t("peko.new.useAvatar", { emoji })}
                        aria-pressed={avatar === emoji}
                        className={[
                          "flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors",
                          avatar === emoji
                            ? "bg-brand-soft ring-1 ring-fg"
                            : "hover:bg-surface-sunken",
                        ].join(" ")}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label
                  htmlFor="principal-description"
                  className="field-label mb-1.5 block"
                >
                  {t("common.description")}
                </label>
                <textarea
                  id="principal-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("peko.profile.descriptionPlaceholder")}
                  rows={2}
                  className="input"
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
                      className="field-label mb-1.5 block"
                    >
                      {t("peko.profile.quickStatus")}
                    </label>
                    <select
                      id="principal-status"
                      value={status}
                      onChange={(e) => handleQuickStatusChange(e.target.value)}
                      className="select"
                    >
                      <option value="">—</option>
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {statusBadge(o).label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!isRemote && (
                  <div>
                    <label
                      htmlFor="principal-exposure"
                      className="field-label mb-1.5 block"
                    >
                      {t("peko.profile.hub")}
                    </label>
                    <select
                      id="principal-exposure"
                      value={exposure}
                      onChange={(e) => setExposure(e.target.value)}
                      className="select"
                    >
                      {REGISTRATION_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {t(`peko.profile.registration.${o}.label`)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      {isRegistration(exposure) ? t(`peko.profile.registration.${exposure}.hint`) : ""}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="principal-model"
                  className="field-label mb-1.5 block"
                >
                  {t("peko.profile.preferredModel")}
                </label>
                {modelsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-fg-subtle" />
                ) : modelItems.length === 0 ? (
                  <p className="text-xs text-warn">
                    {t("peko.profile.noModels")}
                  </p>
                ) : (
                  <select
                    id="principal-model"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className="select"
                  >
                    <option value="">{t("peko.profile.noneOption")}</option>
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

          {exposureConflictDetail !== null ? (
            <div
              data-testid="exposure-conflict"
              className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn"
            >
              <p className="font-medium">
                {t("peko.profile.exposureConflict")}
              </p>
              {exposureConflictDetail && (
                <p className="mt-1 opacity-80">{exposureConflictDetail}</p>
              )}
            </div>
          ) : (
            (updateError || registerError || removeError) && (
              <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                {updateError || registerError || removeError}
              </div>
            )
          )}

        </div>

        <div className="modal-footer shrink-0">
          {principal && !isEditing && (
            <button
              onClick={() => {
                onClose();
                navigate({
                  to: "/chat/$pekoName",
                  params: { pekoName: principal.name },
                });
              }}
              className="btn-primary"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t("common.chat")}
            </button>
          )}

          {isEditing ? (
            <>
              <button
                onClick={() => {
                  setIsEditing(false);
                  if (principal) {
                    setDescription(principal.description ?? "");
                    setAvatar(principal.avatar ?? "");
                    setStatus(principal.status ?? "");
                    setExposure(effectiveRegistration(principal));
                    setModelId(principal.preferredModelId ?? "");
                  }
                }}
                disabled={updateMut.isPending || registering}
                className="btn-secondary"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={updateMut.isPending || registering}
                className="btn-primary"
              >
                {updateMut.isPending || registering ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("common.save")}
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <span className="shrink-0 text-sm text-fg-muted">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium text-fg">{value}</span>
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
  const { t } = useTranslation();
  const badge = statusBadge(status);
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-fg-muted">{t("common.status")}</span>
      <span className="inline-flex items-center gap-1.5 font-medium text-fg">
        <Circle
          className={`h-2.5 w-2.5 fill-current ${badge.color}`}
          aria-hidden="true"
        />
        <span data-testid="live-status-label">{loading ? "…" : badge.label}</span>
        {isRemote && (
          <span className="ml-1 text-[10px] font-normal text-fg-subtle">{t("peko.remote.viaHub")}</span>
        )}
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
