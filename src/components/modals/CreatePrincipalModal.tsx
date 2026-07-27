import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";

import { usePrincipalCreate } from "../../hooks/usePrincipals";
import { useModels } from "../../hooks/useModels";
import { isValidPrincipalName } from "../../lib/validatePrincipalName";

/**
 * In-app Principal creation. Replaces the old CLI stub (which told
 * the user to run `peko principal new` in a terminal). Wires the
 * desktop to the runtime's `principal_create` IPC variant.
 *
 * Model-first migration: the modal requires the user to pick a
 * configured model. The payload sends `modelId`; there is no longer
 * a separate provider concept.
 */
export default function CreatePrincipalModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: models, isLoading: modelsLoading } = useModels();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);

  const modelItems = useMemo(
    () => resolveModelItems(models, modelsLoading),
    [models, modelsLoading],
  );

  const selectedModel = useMemo(
    () => models?.find((m) => m.id === modelId),
    [models, modelId],
  );

  const createMut = usePrincipalCreate();

  // Reset form when reopened so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setModelId(null);
      createMut.reset();
    }
    // We intentionally exclude `createMut` to avoid resetting on every
    // mutation status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    if (!name.trim() || !modelId) return;
    createMut.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        modelId,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  if (!open) return null;

  const trimmedName = name.trim();
  const nameValid = isValidPrincipalName(trimmedName);
  const errorMessage =
    createMut.error instanceof Error
      ? createMut.error.message
      : createMut.error
        ? String(createMut.error)
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Create a Principal
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
            Principals are the top-level runtime actors. They&apos;re created on
            disk under <code>&lt;config&gt;/principals/&lt;name&gt;</code> with
            a default <code>agents/primary.md</code> prompt.
          </p>

          <div>
            <label
              htmlFor="principal-name"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="principal-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="alice"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
            {name && !nameValid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Use 1–64 chars: letters, digits, &quot;-&quot;, &quot;_&quot;. No
                leading/trailing hyphen, &quot;..&quot;, or path separators.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="principal-description"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Description (optional)
            </label>
            <textarea
              id="principal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Personal coding assistant"
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label
              htmlFor="model-select"
              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              Model <span className="text-red-500">*</span>
            </label>
            {modelsLoading && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Loading models…</p>
            )}
            {!modelsLoading && modelItems.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No configured models yet. Add one in Settings → Models first.
              </p>
            )}
            {!modelsLoading && modelItems.length > 0 && (
              <select
                id="model-select"
                value={modelId ?? ""}
                onChange={(e) => setModelId(e.target.value || null)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              >
                <option value="">— Select a model —</option>
                {modelItems.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            )}
            {selectedModel && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {selectedModel.apiFormat}
                </span>
                <span className="font-mono">{selectedModel.modelId}</span>
                <span>{selectedModel.baseUrl}</span>
              </div>
            )}
          </div>

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
          <button
            onClick={handleSubmit}
            disabled={!nameValid || !modelId || createMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {createMut.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Model items compatible with the modal's picker. Defensive: an
 * unknown `models` shape renders as "no models" rather than crashing.
 */
interface ModelItem {
  id: string;
  displayName: string;
}

function resolveModelItems(
  models: unknown,
  loading: boolean,
): ModelItem[] {
  if (loading || !Array.isArray(models)) return [];
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
