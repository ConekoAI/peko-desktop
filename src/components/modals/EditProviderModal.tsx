import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import { useUpdateProvider } from "../../hooks/useProviders";
import type { ModelInfo, ProviderInfo, ProviderUpdateArgs } from "../../types";

const API_FORMAT_OPTIONS = [
  { value: "openai_completions", label: "OpenAI Completions" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
];

function apiTypeToFormat(apiType: string): string {
  switch (apiType) {
    case "anthropic":
      return "anthropic_messages";
    case "openai":
    default:
      return "openai_completions";
  }
}

function formatToApiType(format: string): string {
  switch (format) {
    case "anthropic_messages":
      return "anthropic";
    case "openai_completions":
    default:
      return "openai";
  }
}

interface HeaderRow {
  key: string;
  value: string;
}

/**
 * RP6: Edit an existing provider catalog entry.
 *
 * The modal edits the public metadata only (display name, base URL,
 * API format, model list, headers, requires-key and enabled flags).
 * Secrets live in the vault and are managed in the accordion body on
 * Settings → Credentials, not here.
 */
export default function EditProviderModal({
  open,
  onClose,
  provider,
}: {
  open: boolean;
  onClose: () => void;
  provider: ProviderInfo;
}) {
  const updateMut = useUpdateProvider();

  const [displayName, setDisplayName] = useState(provider.displayName);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiFormat, setApiFormat] = useState(apiTypeToFormat(provider.apiType));
  const [requiresKey, setRequiresKey] = useState(provider.requiresKey);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [models, setModels] = useState<ModelInfo[]>(provider.models);
  const [defaultModelId, setDefaultModelId] = useState(provider.defaultModel);
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    Object.entries(provider.headers).map(([k, v]) => ({ key: k, value: v })),
  );

  // Reset form when the provider changes or the modal reopens.
  useEffect(() => {
    if (open) {
      setDisplayName(provider.displayName);
      setBaseUrl(provider.baseUrl);
      setApiFormat(apiTypeToFormat(provider.apiType));
      setRequiresKey(provider.requiresKey);
      setEnabled(provider.enabled);
      setModels(provider.models);
      setDefaultModelId(provider.defaultModel);
      setHeaders(
        Object.entries(provider.headers).map(([k, v]) => ({ key: k, value: v })),
      );
      updateMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider.id]);

  const modelIds = useMemo(() => models.map((m) => m.id).filter(Boolean), [models]);

  function addModel() {
    setModels((prev) => [
      ...prev,
      { id: `model-${prev.length + 1}`, capabilities: [] },
    ]);
  }

  function removeModel(index: number) {
    setModels((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // If we just removed the default, clear the default so the runtime
      // validation doesn't reject the update.
      const removedId = prev[index]?.id;
      if (removedId && defaultModelId === removedId) {
        setDefaultModelId(next[0]?.id ?? "");
      }
      return next;
    });
  }

  function updateModel(index: number, patch: Partial<ModelInfo>) {
    setModels((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );
  }

  function addHeader() {
    setHeaders((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeHeader(index: number) {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  }

  function updateHeader(index: number, patch: Partial<HeaderRow>) {
    setHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    );
  }

  function handleSubmit() {
    const headersMap: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        headersMap[h.key.trim()] = h.value;
      }
    }

    const args: ProviderUpdateArgs = {
      id: provider.id,
      displayName: displayName.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      apiFormat,
      models: models.length > 0 ? models : undefined,
      defaultModelId: defaultModelId || undefined,
      headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
      requiresKey,
      enabled,
    };

    updateMut.mutate(args, {
      onSuccess: () => onClose(),
    });
  }

  if (!open) return null;

  const errorMessage =
    updateMut.error instanceof Error
      ? updateMut.error.message
      : updateMut.error
        ? String(updateMut.error)
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Edit Provider
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {provider.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            data-testid="edit-provider-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-sm text-slate-700 dark:text-slate-300">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Display name
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Base URL
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                API format
              </label>
              <select
                value={apiFormat}
                onChange={(e) => setApiFormat(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              >
                {API_FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Default model
              </label>
              <select
                value={defaultModelId}
                onChange={(e) => setDefaultModelId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              >
                <option value="">— Select —</option>
                {modelIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={requiresKey}
                onChange={(e) => setRequiresKey(e.target.checked)}
              />
              Requires API key
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enabled
            </label>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Models
              </span>
              <button
                type="button"
                onClick={addModel}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <Plus className="h-3 w-3" /> Add model
              </button>
            </div>
            <div className="space-y-2">
              {models.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No models declared.
                </p>
              )}
              {models.map((m, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-12"
                >
                  <input
                    value={m.id}
                    onChange={(e) => updateModel(i, { id: e.target.value })}
                    placeholder="model-id"
                    className="sm:col-span-3 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    value={m.displayName ?? ""}
                    onChange={(e) =>
                      updateModel(i, {
                        displayName: e.target.value || undefined,
                      })
                    }
                    placeholder="Display name"
                    className="sm:col-span-3 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    value={m.contextLength ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateModel(i, {
                        contextLength: v ? Number(v) : undefined,
                      });
                    }}
                    placeholder="Context"
                    className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    value={m.maxOutputTokens ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateModel(i, {
                        maxOutputTokens: v ? Number(v) : undefined,
                      });
                    }}
                    placeholder="Max out"
                    className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => removeModel(i)}
                    className="sm:col-span-2 inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Headers
              </span>
              <button
                type="button"
                onClick={addHeader}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <Plus className="h-3 w-3" /> Add header
              </button>
            </div>
            <div className="space-y-2">
              {headers.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No extra headers.
                </p>
              )}
              {headers.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={h.key}
                    onChange={(e) => updateHeader(i, { key: e.target.value })}
                    placeholder="Header name"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => updateHeader(i, { value: e.target.value })}
                    placeholder="Value"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => removeHeader(i)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
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
            disabled={updateMut.isPending}
            data-testid="edit-provider-submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {updateMut.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { apiTypeToFormat, formatToApiType };
