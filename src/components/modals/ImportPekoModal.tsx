import { useEffect, useState } from "react";
import { Check, Loader2, Package, X } from "lucide-react";

import { usePrincipalImport } from "../../hooks/usePrincipals";

/**
 * ADR-056: wake a peko from a `.peko` package on disk.
 *
 * The copy distinguishes the two distribution artifacts: importing a
 * `.peko` package wakes the SAME peko — its identity, memory, and
 * private keys travel with the package — while a registry seed grows
 * a FRESH peko with a new identity.
 *
 * There is no file-picker dialog plugin in this build, so the
 * destination is a validated text input. The Tauri command
 * (`principal_import`) runs `principal_reload` itself on success, so
 * a resolved mutation means the peko is live daemon-side; the hook
 * invalidates the `["principals"]` list so it lands in the sidebar.
 * Runtime errors render verbatim — keyless packages reject with the
 * runtime's "ground it with `peko create`" guidance.
 */
export default function ImportPekoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const importMut = usePrincipalImport();

  // Reset form when reopened so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setPath("");
      importMut.reset();
    }
    // We intentionally exclude the mutation to avoid resetting on every
    // mutation status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleImport() {
    const trimmed = path.trim();
    if (!trimmed) return;
    importMut.mutate({ path: trimmed });
  }

  if (!open) return null;

  const errorMessage =
    importMut.error instanceof Error
      ? importMut.error.message
      : importMut.error
        ? String(importMut.error)
        : null;

  // The runtime's `principal_imported { name, config_path }` envelope.
  const imported = importMut.data as { name?: unknown } | undefined;
  const importedName =
    imported && typeof imported.name === "string" ? imported.name : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Import a .peko package
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
            A <code>.peko</code> package wakes the <strong>same</strong> peko —
            its identity, memory, and private keys travel with the package.
            To grow a <strong>fresh</strong> peko from a definition instead,
            pull its seed from the Registry.
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
                onChange={(e) => setPath(e.target.value)}
                placeholder="~/.peko/alice.peko"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
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
              <button
                onClick={handleImport}
                disabled={!path.trim() || importMut.isPending}
                data-testid="import-peko-submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {importMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Package className="h-3.5 w-3.5" />
                )}
                Import
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
