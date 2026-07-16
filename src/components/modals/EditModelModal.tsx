import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import { useUpdateModel } from "../../hooks/useModels";
import { useGenericCredentialList } from "../../hooks/useSettings";
import type { ModelSummary, ModelUpdateArgs } from "../../types";

const API_FORMAT_OPTIONS = [
  { value: "openai_completions", label: "OpenAI Completions" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
];

interface HeaderRow {
  key: string;
  value: string;
}

/**
 * Edit an existing configured model.
 *
 * Edits the public metadata only (display name, base URL, API format,
 * wire model id, context window, max output tokens, capabilities,
 * headers, credential reference, requires-key and enabled flags).
 * Secrets themselves live in the vault and are managed in Settings →
 * Credentials.
 */
export default function EditModelModal({
  open,
  onClose,
  model,
}: {
  open: boolean;
  onClose: () => void;
  model: ModelSummary;
}) {
  const updateMut = useUpdateModel();
  const { data: credentials } = useGenericCredentialList();

  const [displayName, setDisplayName] = useState(model.displayName);
  const [baseUrl, setBaseUrl] = useState(model.baseUrl);
  const [apiFormat, setApiFormat] = useState(model.apiFormat);
  const [modelId, setModelId] = useState(model.modelId);
  const [contextWindow, setContextWindow] = useState<number | "">(
    model.contextWindow ?? "",
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState<number | "">(
    model.maxOutputTokens ?? "",
  );
  const [capabilities, setCapabilities] = useState(() =>
    model.capabilities.join(", "),
  );
  const [requiresKey, setRequiresKey] = useState(model.requiresKey);
  const [enabled, setEnabled] = useState(model.enabled);
  const [credentialId, setCredentialId] = useState(model.credentialId ?? "");
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    Object.entries(model.headers).map(([k, v]) => ({ key: k, value: v })),
  );

  // Reset form when the model changes or the modal reopens.
  useEffect(() => {
    if (open) {
      setDisplayName(model.displayName);
      setBaseUrl(model.baseUrl);
      setApiFormat(model.apiFormat);
      setModelId(model.modelId);
      setContextWindow(model.contextWindow ?? "");
      setMaxOutputTokens(model.maxOutputTokens ?? "");
      setCapabilities(model.capabilities.join(", "));
      setRequiresKey(model.requiresKey);
      setEnabled(model.enabled);
      setCredentialId(model.credentialId ?? "");
      setHeaders(
        Object.entries(model.headers).map(([k, v]) => ({ key: k, value: v })),
      );
      updateMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model.id]);

  const credentialOptions = useMemo(
    () =>
      (credentials ?? [])
        .filter((c) => c.hasKey && (c.kind === "api_key" || c.kind === "bearer_token"))
        .map((c) => ({ value: c.id, label: `${c.namespace}/${c.name}` })),
    [credentials],
  );

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

    const caps = capabilities
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const args: ModelUpdateArgs = {
      id: model.id,
      displayName: displayName.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      apiFormat,
      modelId: modelId.trim() || undefined,
      contextWindow:
        typeof contextWindow === "number" ? contextWindow : undefined,
      maxOutputTokens:
        typeof maxOutputTokens === "number" ? maxOutputTokens : undefined,
      capabilities: caps.length > 0 ? caps : undefined,
      headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
      credentialId: credentialId.trim() || undefined,
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
              Edit Model
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{model.id}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            data-testid="edit-model-close"
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
                Wire model ID
              </label>
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Context window
              </label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => {
                  const v = e.target.value;
                  setContextWindow(v ? Number(v) : "");
                }}
                placeholder="128000"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Max output tokens
              </label>
              <input
                type="number"
                value={maxOutputTokens}
                onChange={(e) => {
                  const v = e.target.value;
                  setMaxOutputTokens(v ? Number(v) : "");
                }}
                placeholder="4096"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Capabilities
              </label>
              <input
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
                placeholder="tool_use, vision"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Credential
            </label>
            <select
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            >
              <option value="">— None —</option>
              {credentialOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
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
            data-testid="edit-model-submit"
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
