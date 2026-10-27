import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Package, X } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Import a .peko package
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A <code>.peko</code> package wakes the <strong>same</strong> peko —
            its identity, memory, and private keys travel with the package.
            To grow a <strong>fresh</strong> peko from a definition instead,
            create one from its seed.
          </p>

          {importMut.isSuccess ? (
            <div
              data-testid="import-peko-success"
              className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                {importedName ? (
                  <>
                    Woke <span className="font-mono font-medium">{importedName}</span>{" "}
                    — it&apos;s in your sidebar.
                  </>
                ) : (
                  "Package imported — the peko is in your sidebar."
                )}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="peko-import-path"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Package path <span className="text-red-500">*</span>
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
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
              </div>
              <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
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
                  Import as a new peko with a fresh identity (needed when this
                  peko already lives on this computer).
                </span>
              </label>
              {preview && <PreviewSummary preview={preview} />}
            </>
          )}

          {errorMessage && (
            <div
              data-testid="import-peko-error"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
            >
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          {importMut.isSuccess ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              {preview ? (
                <button
                  onClick={handleImport}
                  disabled={blocked || importMut.isPending}
                  data-testid="import-peko-submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {importMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Wake {preview.name}
                </button>
              ) : (
                <button
                  onClick={handleReview}
                  disabled={!path.trim() || previewMut.isPending}
                  data-testid="import-peko-review"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {previewMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Review
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
  const inv = preview.inventory;
  const runnable = [
    ...inv.hooks.map((h) => `hook ${h.id}`),
    ...inv.mcp_servers.map((m) => `MCP server ${m.id}`),
    ...inv.executable_files,
  ];
  return (
    <div
      data-testid="import-peko-preview"
      className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800"
    >
      <p>
        <span className="font-mono font-medium">{preview.name}</span>{" "}
        <span className="text-slate-400">v{preview.version}</span>
        {preview.description ? ` — ${preview.description}` : ""}
      </p>
      <p className="text-slate-500 dark:text-slate-400">
        {inv.file_count} files
        {inv.skills.length > 0 ? ` · skills: ${inv.skills.join(", ")}` : ""}
      </p>
      {runnable.length > 0 && (
        <div className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            This package can run code on this computer:
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
        <p key={w} className="text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
      {preview.validation_errors.map((e) => (
        <p key={e} className="text-red-600 dark:text-red-400">
          {e}
        </p>
      ))}
    </div>
  );
}
