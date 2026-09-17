import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";

import {
  isGenesisPending,
  usePrincipalCreate,
  usePrincipals,
} from "../../hooks/usePrincipals";
import { useModels } from "../../hooks/useModels";
import { isValidPrincipalName } from "../../lib/validatePrincipalName";
import { resolveSpec, type ModelSummary } from "../../types";
import type { PrincipalSummary } from "../../lib/api";
import SpecBadge from "../models/SpecBadge";
import { specBadgeList } from "../../lib/model-spec";

/**
 * How long the modal waits for a freshly created peko's genesis boot
 * to reach `organized` before closing anyway. Slightly above the
 * runtime's own ~300s genesis wait cap; the sidebar's "waking…"
 * badge keeps reflecting the boot state after the modal closes.
 */
const GENESIS_WAIT_CAP_MS = 310_000;

/**
 * In-app peko creation. Replaces the old CLI stub (which told the
 * user to run `peko create` in a terminal). Wires the desktop to the
 * runtime's `principal_create` IPC variant.
 *
 * Model-first migration: the modal requires the user to pick a
 * configured model. The payload sends `modelId`; there is no longer
 * a separate provider concept.
 *
 * Genesis-aware (ADR-054): `peko create` blocks through the genesis
 * boot sequence, and the returned summary can still say
 * `bootState: "genesis_pending"` when the runtime answers early. In
 * that case the modal stays open on a "Waking your peko" progress
 * state until the list query (which fast-polls while any row is
 * mid-genesis) reports `organized`, or the wait cap hits.
 *
 * Create-from-seed (ADR-060) is deliberately NOT offered here: the
 * runtime's `principal_create` IPC packet has no seed field, so the
 * desktop command rejects a seeded create loudly. The Registry
 * page's post-pull panel points the user at the CLI grounding flow
 * (`peko create <name> -s <seed.toml>`) instead.
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
  // Set to the new peko's name when the create succeeded but the
  // returned summary was still mid-genesis; the modal then stays open
  // on the progress state until the boot completes (or the cap hits).
  const [createdName, setCreatedName] = useState<string | null>(null);

  const modelItems = useMemo(
    () => resolveModelItems(models, modelsLoading),
    [models, modelsLoading],
  );

  const selectedModel = useMemo(
    () => models?.find((m) => m.id === modelId),
    [models, modelId],
  );

  const createMut = usePrincipalCreate();
  // The list query fast-polls while any row reports a non-organized
  // boot state, so this is also the genesis progress feed.
  const { data: principals } = usePrincipals();
  const createdRow = useMemo(
    () => principals?.find((p) => p.name === createdName),
    [principals, createdName],
  );

  // Reset form when reopened so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setModelId(null);
      setCreatedName(null);
      createMut.reset();
    }
    // We intentionally exclude the mutations to avoid resetting on every
    // mutation status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Genesis progress: close once the created peko reports `organized`
  // (an absent bootState — older runtimes — counts as organized).
  useEffect(() => {
    if (!createdName) return;
    if (createdRow && !isGenesisPending(createdRow)) onClose();
  }, [createdRow, createdName, onClose]);

  // Wait cap: never trap the user on the progress state. The detached
  // watcher in `usePrincipalCreate` keeps refreshing the caches and
  // the sidebar badge keeps showing the boot state after close.
  useEffect(() => {
    if (!createdName) return;
    const t = window.setTimeout(onClose, GENESIS_WAIT_CAP_MS);
    return () => window.clearTimeout(t);
  }, [createdName, onClose]);

  function handleSubmit() {
    if (!name.trim() || !modelId) return;
    const onSuccess = (created: PrincipalSummary) => {
      if (isGenesisPending(created)) {
        // Mid-genesis: hold the modal on the progress state.
        setCreatedName(created.name);
      } else {
        onClose();
      }
    };
    createMut.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        modelId,
      },
      { onSuccess },
    );
  }

  if (!open) return null;

  const trimmedName = name.trim();
  const nameValid = isValidPrincipalName(trimmedName);
  // "Waking" covers both legs of the genesis wait: the create invoke
  // itself (the runtime may block inside it through genesis) and the
  // post-create window where the summary is still mid-boot.
  const waking = createMut.isPending || createdName !== null;
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
              Create a peko
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {waking ? (
          <div
            className="flex flex-col items-center gap-3 p-8 text-center"
            data-testid="create-peko-waking"
          >
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Waking your peko — this can take a minute…
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The runtime is running the genesis boot sequence
              {createdRow?.bootState ? (
                <>
                  {" "}
                  (now: <code className="font-mono">{createdRow.bootState}</code>)
                </>
              ) : (
                ""
              )}
              . You can close this window — the peko keeps booting in the
              background.
            </p>
          </div>
        ) : (
          <div className="space-y-4 p-5 text-sm text-slate-700 dark:text-slate-300">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              A peko is the top-level runtime actor. It&apos;s created on disk
              under <code>&lt;config&gt;/principals/&lt;name&gt;</code> with a
              default <code>agents/primary.md</code> prompt.
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
                  {specBadgeList(resolveSpec(selectedModel as ModelSummary)).map((b) => (
                    <SpecBadge
                      key={b.kind}
                      kind={b.kind}
                      label={b.label}
                      testId={`principal-modal-spec-${b.kind}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                {errorMessage}
              </div>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          {!waking && (
            <button
              onClick={handleSubmit}
              disabled={!nameValid || !modelId || createMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Create
            </button>
          )}
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
