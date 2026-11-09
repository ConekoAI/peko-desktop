import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import { useUpdateModel } from "../../hooks/useModels";
import { useGenericCredentialList, useSetGenericCredential } from "../../hooks/useSettings";
import type { ModelSummary, ModelUpdateArgs } from "../../types";
import { API_FORMATS } from "../../lib/apiFormats";
import InputsPicker from "../models/InputsPicker";
import PriceFields from "../models/PriceFields";
import {
  inputsOf,
  priceDraftChanged,
  priceDraftOf,
  pricingFromDraft,
  withInputs,
  withPricing,
  type ModelInputs,
  type PriceDraft,
} from "../../lib/model-spec";


interface HeaderRow {
  key: string;
  value: string;
}

/**
 * Edit an existing configured model.
 *
 * Edits the public metadata only (display name, base URL, API format,
 * wire model id, context window, max output tokens, headers,
 * credential reference, requires-key and enabled flags), and replaces
 * the model's API key: the new key is stored in the vault beside the
 * old one and the model points at it.
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
  const setKeyMut = useSetGenericCredential();
  const { data: credentials } = useGenericCredentialList();
  const [newKey, setNewKey] = useState("");

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
  const [requiresKey, setRequiresKey] = useState(model.requiresKey);
  const [enabled, setEnabled] = useState(model.enabled);
  const [inputs, setInputs] = useState<ModelInputs>(() => inputsOf(model.spec));
  const [price, setPrice] = useState<PriceDraft>(() => priceDraftOf(model.spec));
  const pricing = pricingFromDraft(price);
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
      setRequiresKey(model.requiresKey);
      setEnabled(model.enabled);
      setInputs(inputsOf(model.spec));
      setPrice(priceDraftOf(model.spec));
      setCredentialId(model.credentialId ?? "");
      setNewKey("");
      setKeyMut.reset();
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

  async function handleSubmit() {
    if (pricing === null) return;
    let keyId = credentialId.trim() || undefined;
    if (newKey.trim()) {
      // Store the new key under the current key's name (else the
      // model's), then point the model at it.
      const current = (credentials ?? []).find((c) => c.id === credentialId);
      try {
        keyId = await setKeyMut.mutateAsync({
          namespace: current?.namespace ?? "provider",
          name: current?.name ?? model.id,
          kind: current?.kind ?? "api_key",
          material: newKey.trim(),
        });
      } catch {
        return;
      }
    }
    const headersMap: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        headersMap[h.key.trim()] = h.value;
      }
    }

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
      headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
      credentialId: keyId,
      requiresKey,
      enabled,
    };
    // Only a change of media inputs or price rewrites the descriptor.
    const before = inputsOf(model.spec);
    const inputsChanged =
      before.image !== inputs.image ||
      before.audio !== inputs.audio ||
      before.video !== inputs.video;
    const priceBefore = priceDraftOf(model.spec);
    const priceChanged = priceDraftChanged(priceBefore, price);
    if (inputsChanged || priceChanged) {
      args.spec = withPricing(withInputs(model.spec, inputs), pricing ?? undefined);
    }

    updateMut.mutate(args, {
      onSuccess: () => onClose(),
    });
  }

  if (!open) return null;

  const failure = setKeyMut.error ?? updateMut.error;
  const errorMessage =
    failure instanceof Error ? failure.message : failure ? String(failure) : null;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel flex max-h-[90vh] w-full max-w-2xl flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div>
            <h2 className="modal-title">
              Edit Model
            </h2>
            <p className="text-xs text-fg-muted">{model.id}</p>
          </div>
          <button
            onClick={onClose}
            className="btn-icon -mr-1.5"
            data-testid="edit-model-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-sm text-fg-soft">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label mb-1.5 block">
                Display name
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="field-label mb-1.5 block">
                Base URL
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="input font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label mb-1.5 block">
                API format
              </label>
              <select
                value={apiFormat}
                onChange={(e) => setApiFormat(e.target.value)}
                className="select"
              >
                {API_FORMATS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label mb-1.5 block">
                Wire model ID
              </label>
              <input
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="input font-mono"
              />
            </div>
          </div>

          <InputsPicker value={inputs} onChange={setInputs} disabled={updateMut.isPending} />
          <PriceFields
            value={price}
            onChange={setPrice}
            invalid={pricing === null}
            disabled={updateMut.isPending}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label mb-1.5 block">
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
                className="input"
              />
            </div>
            <div>
              <label className="field-label mb-1.5 block">
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
                className="input"
              />
            </div>
          </div>

          {requiresKey && (
            <div>
              <label
                htmlFor="edit-model-new-key"
                className="field-label mb-1.5 block"
              >
                Replace API key
              </label>
              <input
                id="edit-model-new-key"
                type="password"
                autoComplete="off"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={credentialId ? "Leave empty to keep the current key" : "Paste the API key"}
                className="input"
              />
            </div>
          )}

          <div>
            <label className="field-label mb-1.5 block">
              Stored key
            </label>
            <select
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              className="select"
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
            <label className="flex items-center gap-2 text-xs text-fg-soft">
              <input
                type="checkbox"
                checked={requiresKey}
                onChange={(e) => setRequiresKey(e.target.checked)}
              />
              Requires API key
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-soft">
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
              <span className="text-xs font-medium text-fg-muted">
                Headers
              </span>
              <button
                type="button"
                onClick={addHeader}
                className="btn-secondary text-[11px]"
              >
                <Plus className="h-3 w-3" /> Add header
              </button>
            </div>
            <div className="space-y-2">
              {headers.length === 0 && (
                <p className="text-xs text-fg-muted">
                  No extra headers.
                </p>
              )}
              {headers.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={h.key}
                    onChange={(e) => updateHeader(i, { key: e.target.value })}
                    placeholder="Header name"
                    className="input input-sm flex-1"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => updateHeader(i, { value: e.target.value })}
                    placeholder="Value"
                    className="input input-sm flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeHeader(i)}
                    className="inline-flex items-center gap-1 rounded-lg border border-danger/30 bg-surface-card px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-soft"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={updateMut.isPending || setKeyMut.isPending || pricing === null}
            data-testid="edit-model-submit"
            className="btn-primary"
          >
            <Check className="h-3.5 w-3.5" />
            {updateMut.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
