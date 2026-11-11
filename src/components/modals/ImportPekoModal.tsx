import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Package, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { usePrincipalImport, usePrincipalImportPreview } from "../../hooks/usePrincipals";
import type { ImportPreview } from "../../lib/api";

/**
 * ADR-056: wake a peko from a `.peko` package on disk.
 *
 * The copy distinguishes the two distribution artifacts: importing a
 * `.peko` package wakes the SAME peko — its identity, memory, and
 * private keys travel with the package — while a seed grows a FRESH
 * peko with a new identity.
 *
 * Two steps, mirroring `peko import`: Review runs
 * `principal_import_preview`, which lists everything in the package
 * that can run (hooks, MCP servers, skills, executable files); Wake
 * runs `principal_import` with the preview's manifest checksum, so the
 * runtime refuses a package that changed after review. The Tauri
 * command reloads the daemon itself, so a resolved import means the
 * peko is live; the hook invalidates `["principals"]` so it lands in
 * the sidebar. Runtime errors render verbatim — keyless packages
 * reject with the runtime's "ground it with `peko create`" guidance.
 */
export default function ImportPekoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [rotateKeys, setRotateKeys] = useState(false);
  const previewMut = usePrincipalImportPreview();
  const importMut = usePrincipalImport();

  useEffect(() => {
    if (open) {
      setPath("");
      setRotateKeys(false);
      previewMut.reset();
      importMut.reset();
    }
  }, [open]);

  const preview = previewMut.data;

  function handleReview() {
    const trimmed = path.trim();
    if (!trimmed) return;
    importMut.reset();
    previewMut.mutate({ path: trimmed, rotateKeys });
  }

  function handleImport() {
    if (!preview) return;
    importMut.mutate({
      path: path.trim(),
      manifestChecksum: preview.manifest_checksum,
      rotateKeys,
    });
  }

  if (!open) return null;

  const failure = importMut.error ?? previewMut.error;
  const errorMessage =
    failure instanceof Error ? failure.message : failure ? String(failure) : null;

  const imported = importMut.data as { name?: unknown } | undefined;
  const importedName =
    imported && typeof imported.name === "string" ? imported.name : null;
  const blocked = (preview?.validation_errors.length ?? 0) > 0;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel flex max-h-[85vh] w-full max-w-md flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-ok" />
            <h2 className="modal-title">
              {t("peko.import.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="btn-icon -mr-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-sm text-fg-soft">
          <p className="text-xs text-fg-muted">
            <Trans i18nKey="peko.import.intro" components={{ code: <code />, strong: <strong /> }} />
          </p>

          {importMut.isSuccess ? (
            <div
              data-testid="import-peko-success"
              className="flex items-start gap-2 rounded-lg border border-ok/25 bg-ok-soft px-3 py-2 text-xs text-ok"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                {importedName ? (
                  <Trans
                    i18nKey="peko.import.woke"
                    components={{ name: <span className="font-mono font-medium">{importedName}</span> }}
                  />
                ) : (
                  t("peko.import.imported")
                )}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="peko-import-path"
                  className="field-label mb-1.5 block"
                >
                  {t("peko.import.path")} <span className="text-danger">*</span>
                </label>
                <input
                  id="peko-import-path"
                  autoFocus
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                    previewMut.reset();
                  }}
                  placeholder="~/.peko/alice.peko"
                  className="input font-mono"
                />
              </div>
              <label className="flex items-start gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={rotateKeys}
                  onChange={(e) => {
                    setRotateKeys(e.target.checked);
                    previewMut.reset();
                  }}
                  className="mt-0.5"
                />
                <span>
                  {t("peko.import.rotate")}
                </span>
              </label>
              {preview && <PreviewSummary preview={preview} />}
            </>
          )}

          {errorMessage && (
            <div
              data-testid="import-peko-error"
              className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer shrink-0">
          {importMut.isSuccess ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
            >
              {t("common.done")}
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="btn-secondary"
              >
                {t("common.cancel")}
              </button>
              {preview ? (
                <button
                  onClick={handleImport}
                  disabled={blocked || importMut.isPending}
                  data-testid="import-peko-submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
                >
                  {importMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("peko.import.wake", { name: preview.name })}
                </button>
              ) : (
                <button
                  onClick={handleReview}
                  disabled={!path.trim() || previewMut.isPending}
                  data-testid="import-peko-review"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
                >
                  {previewMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("peko.import.review")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the package is, and everything in it that can run. */
function PreviewSummary({ preview }: { preview: ImportPreview }) {
  const { t } = useTranslation();
  const inv = preview.inventory;
  const runnable = [
    ...inv.hooks.map((h) => t("peko.import.hook", { id: h.id })),
    ...inv.mcp_servers.map((m) => t("peko.import.mcpServer", { id: m.id })),
    ...inv.executable_files,
  ];
  return (
    <div
      data-testid="import-peko-preview"
      className="space-y-2 rounded-lg border border-line p-3 text-xs"
    >
      <p>
        <span className="font-mono font-medium">{preview.name}</span>{" "}
        <span className="text-fg-subtle">v{preview.version}</span>
        {preview.description ? t("peko.import.withDescription", { description: preview.description }) : ""}
      </p>
      <p className="text-fg-muted">
        {t("peko.import.files", { count: inv.file_count })}
        {inv.skills.length > 0 ? t("peko.import.skills", { skills: inv.skills.join(", ") }) : ""}
      </p>
      {runnable.length > 0 && (
        <div className="rounded-md bg-warn-soft p-2 text-warn">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("peko.import.runsCode")}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {runnable.map((r) => (
              <li key={r} className="font-mono break-all">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.validation_warnings.map((w) => (
        <p key={w} className="text-warn">
          {w}
        </p>
      ))}
      {preview.validation_errors.map((e) => (
        <p key={e} className="text-danger">
          {e}
        </p>
      ))}
    </div>
  );
}
