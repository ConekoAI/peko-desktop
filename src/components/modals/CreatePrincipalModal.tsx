import { useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";

import { usePrincipalCreate } from "../../hooks/usePrincipals";
import { useProviders } from "../../hooks/useProviders";

/**
 * In-app Principal creation. Replaces the old CLI stub (which told
 * the user to run `peko principal new` in a terminal). Wires the
 * desktop to the runtime's `principal_create` IPC variant added in
 * peko-runtime PR #185; the on-success cache invalidation in
 * `usePrincipalCreate` makes the new principal appear in the sidebar
 * without a manual refresh.
 *
 * The provider picker is optional: principals inherit the global
 * catalog default when none is pinned (see `default_principal_config`
 * in peko-runtime). The modal surfaces validation errors from both
 * the desktop-side pre-flight (`validate_principal_name`) and the
 * runtime (e.g. `AlreadyExists`).
 */
export default function CreatePrincipalModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: providers, isLoading: providersLoading } = useProviders();
  const providerItems = resolveProviderItems(providers, providersLoading);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

  const createMut = usePrincipalCreate();

  // Reset form when reopened so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setProviderId(null);
      setModelId(null);
      createMut.reset();
    }
    // We intentionally exclude `createMut` to avoid resetting on every
    // mutation status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    if (!name.trim()) return;
    createMut.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        preferredProviderId: providerId ?? undefined,
        preferredModelId: modelId ?? undefined,
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
  const nameValid =
    trimmedName.length > 0 &&
    trimmedName.length <= 64 &&
    !trimmedName.startsWith("-") &&
    !trimmedName.endsWith("-") &&
    !/[\\/]/.test(trimmedName) &&
    /^[A-Za-z0-9_-]+$/.test(trimmedName);
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
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="alice"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
            {name && !nameValid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Use 1–64 chars: letters, digits, &quot;-&quot;, &quot;_&quot;. No
                leading/trailing hyphen or path separators.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Personal coding assistant"
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Provider (optional — inherits global default)
            </label>
            <div className="flex flex-wrap gap-2">
              {providerItems.length === 0 && !providersLoading && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  No providers available yet.
                </span>
              )}
              {providerItems.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setProviderId(providerId === p.id ? null : p.id)
                  }
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    providerId === p.id
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                  ].join(" ")}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
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
            disabled={!nameValid || createMut.isPending}
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
 * Provider items compatible with the modal's pill UI. Mirrors the
 * pattern in `Settings.tsx::CredentialsTab` so the desktop's
 * provider catalogue is a single visual idiom. Defensive: an
 * unknown `providers` shape renders as "no providers" rather than
 * crashing.
 */
interface ProviderItem {
  id: string;
  displayName: string;
}

function resolveProviderItems(
  providers: unknown,
  loading: boolean,
): ProviderItem[] {
  if (loading || !Array.isArray(providers)) return [];
  return providers
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const obj = p as Record<string, unknown>;
      const id =
        typeof obj.id === "string"
          ? obj.id
          : typeof obj.provider_id === "string"
            ? obj.provider_id
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
    .filter((x): x is ProviderItem => x !== null);
}