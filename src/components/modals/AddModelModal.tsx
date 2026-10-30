import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { useAddModel, useModels } from "../../hooks/useModels";
import { useGenericCredentialList } from "../../hooks/useSettings";
import EndpointForm, {
  EMPTY_ENDPOINT,
  endpointArgs,
  endpointName,
  isEndpointValid,
  type EndpointDraft,
} from "../models/EndpointForm";
import InputsPicker from "../models/InputsPicker";
import PriceFields from "../models/PriceFields";
import {
  NO_MEDIA,
  pricingFromDraft,
  withInputs,
  withPricing,
  type ModelInputs,
  type PriceDraft,
} from "../../lib/model-spec";

/**
 * Add a configured model: an endpoint (base URL, API format, model id)
 * and its credential (ADR-068). The runtime has no vendor presets; any
 * OpenAI-compatible, Anthropic-compatible, or OpenAI Responses endpoint
 * is configured the same way. A new key goes to the vault; an existing
 * vault credential can be reused instead.
 */
export default function AddModelModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: (modelId: string) => void;
}) {
  const { data: credentials } = useGenericCredentialList();
  const { data: existingModels } = useModels();
  const addMut = useAddModel();
  const [draft, setDraft] = useState<EndpointDraft>(EMPTY_ENDPOINT);
  const [inputs, setInputs] = useState<ModelInputs>(NO_MEDIA);
  const [price, setPrice] = useState<PriceDraft>({ input: "", output: "" });
  const pricing = pricingFromDraft(price);

  // A reopened dialog starts clean.
  useEffect(() => {
    if (open) {
      setDraft(EMPTY_ENDPOINT);
      setInputs(NO_MEDIA);
      setPrice({ input: "", output: "" });
      addMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const credentialOptions = useMemo(
    () =>
      (credentials ?? [])
        .filter((c) => c.hasKey && (c.kind === "api_key" || c.kind === "bearer_token"))
        .map((c) => ({ value: c.id, label: `${c.namespace}/${c.name}` })),
    [credentials],
  );

  const name = endpointName(draft);
  const conflict = !!name && (existingModels ?? []).some((m) => m.id === name);
  const canSubmit =
    isEndpointValid(draft) && !conflict && pricing !== null && !addMut.isPending;

  function submit() {
    if (!canSubmit) return;
    // Text only and unpriced: leave the model without a descriptor.
    const media = inputs.image || inputs.audio || inputs.video;
    const priced = pricing ?? undefined;
    const args =
      media || priced
        ? {
            ...endpointArgs(draft),
            spec: withPricing(withInputs(null, inputs), priced),
          }
        : endpointArgs(draft);
    addMut.mutate(args, {
      onSuccess: (info) => {
        onSuccess?.(info.id);
        onClose();
      },
    });
  }

  if (!open) return null;

  const error =
    addMut.error instanceof Error ? addMut.error.message : addMut.error ? String(addMut.error) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-line bg-surface-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-brand" />
            <h2 className="text-base font-semibold text-fg">Add a model</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <p className="text-xs text-fg-muted">
            Use the base URL, API format, and model name from your provider&apos;s docs. Providers
            that say &quot;OpenAI-compatible&quot; use Chat Completions.
          </p>
          <EndpointForm
            value={draft}
            onChange={setDraft}
            credentialOptions={credentialOptions}
            disabled={addMut.isPending}
          />
          <InputsPicker value={inputs} onChange={setInputs} disabled={addMut.isPending} />
          <PriceFields
            value={price}
            onChange={setPrice}
            invalid={pricing === null}
            disabled={addMut.isPending}
          />
          {conflict && (
            <p className="text-xs text-warn" data-testid="add-model-conflict">
              A model named <span className="font-mono">{name}</span> already exists — set another
              name under Advanced.
            </p>
          )}
          {error && (
            <div
              data-testid="add-model-error"
              className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-surface-card px-4 py-1.5 text-sm font-medium text-fg-soft hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="add-model-submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
