import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

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
import EffortPicker from "../models/EffortPicker";
import {
  EMPTY_PREFILL,
  type EffortLevel,
  prefillOf,
  sourcesOf,
  tokensFromText,
  type Prefill,
} from "../../lib/model-facts";
import type { DiscoveredModel } from "../../types";
import {
  NO_MEDIA,
  priceDraftChanged,
  pricingFromDraft,
  withInputs,
  withPricing,
  type ModelInputs,
  EMPTY_PRICE_DRAFT,
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
  const { t } = useTranslation();
  const { data: credentials } = useGenericCredentialList();
  const { data: existingModels } = useModels();
  const addMut = useAddModel();
  const [draft, setDraft] = useState<EndpointDraft>(EMPTY_ENDPOINT);
  const [inputs, setInputs] = useState<ModelInputs>(NO_MEDIA);
  const [price, setPrice] = useState<PriceDraft>(EMPTY_PRICE_DRAFT);
  const [contextWindow, setContextWindow] = useState("");
  const [maxOutput, setMaxOutput] = useState("");
  /** `""` sends no effort: the provider's default. */
  const [effort, setEffort] = useState<EffortLevel | "">("");
  /** What was last filled in from the picked model's list entry. */
  const [prefill, setPrefill] = useState<Prefill>(EMPTY_PREFILL);
  const pricing = pricingFromDraft(price);
  const contextTokens = tokensFromText(contextWindow);
  const outputTokens = tokensFromText(maxOutput);

  // A reopened dialog starts clean.
  useEffect(() => {
    if (open) {
      setDraft(EMPTY_ENDPOINT);
      setInputs(NO_MEDIA);
      setPrice(EMPTY_PRICE_DRAFT);
      setContextWindow("");
      setMaxOutput("");
      setEffort("");
      setPrefill(EMPTY_PREFILL);
      addMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const credentialOptions = useMemo(
    () =>
      (credentials ?? [])
        .filter(
          (c) =>
            c.hasKey &&
            (c.kind === "api_key" || c.kind === "bearer_token" || c.kind === "oauth_token"),
        )
        .map((c) => ({ value: c.id, label: `${c.namespace}/${c.name}` })),
    [credentials],
  );

  const sameInputs = (a: ModelInputs, b: ModelInputs) =>
    a.image === b.image && a.audio === b.audio && a.video === b.video;

  // Picking a listed model fills in what its list entry (or models.dev)
  // says. A part the person already changed stays theirs.
  function picked(model: DiscoveredModel | null) {
    const next = prefillOf(model);
    if (contextWindow === prefill.contextWindow.value) setContextWindow(next.contextWindow.value);
    if (maxOutput === prefill.maxOutput.value) setMaxOutput(next.maxOutput.value);
    if (sameInputs(inputs, prefill.inputs.value)) setInputs(next.inputs.value);
    if (!priceDraftChanged(price, prefill.price.value)) setPrice(next.price.value);
    // An effort the next model does not take falls back to its default.
    if (effort && !next.effortLevels.value.includes(effort)) setEffort("");
    setPrefill(next);
  }

  // Where what is shown now came from, for the parts still as filled in.
  const shownSources = sourcesOf({
    contextWindow: contextWindow === prefill.contextWindow.value ? prefill.contextWindow : { value: "" },
    maxOutput: maxOutput === prefill.maxOutput.value ? prefill.maxOutput : { value: "" },
    inputs: sameInputs(inputs, prefill.inputs.value) ? prefill.inputs : { value: NO_MEDIA },
    price: !priceDraftChanged(price, prefill.price.value) ? prefill.price : { value: EMPTY_PRICE_DRAFT },
    effortLevels: prefill.effortLevels,
  });
  const effortLevels = prefill.effortLevels.value;

  const name = endpointName(draft);
  const conflict = !!name && (existingModels ?? []).some((m) => m.id === name);
  const canSubmit =
    isEndpointValid(draft) &&
    !conflict &&
    pricing !== null &&
    contextTokens !== null &&
    outputTokens !== null &&
    !addMut.isPending;

  function submit() {
    if (!canSubmit) return;
    // Text only and unpriced: leave the model without a descriptor.
    const media = inputs.image || inputs.audio || inputs.video;
    const priced = pricing ?? undefined;
    const limits = {
      ...(contextTokens && { contextWindow: contextTokens }),
      ...(outputTokens && { maxOutputTokens: outputTokens }),
      ...(effort && { effort }),
      ...(effortLevels.length > 0 && { effortLevels }),
    };
    const args =
      media || priced
        ? {
            ...endpointArgs(draft),
            ...limits,
            spec: withPricing(withInputs(null, inputs), priced),
          }
        : { ...endpointArgs(draft), ...limits };
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
    <div className="modal-backdrop">
      <div className="modal-panel flex max-h-[90vh] w-full max-w-lg flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-brand-text" />
            <h2 className="modal-title">{t("models.add.title")}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="btn-icon -mr-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <p className="text-xs text-fg-muted">
            {t("models.add.intro")}
          </p>
          <EndpointForm
            value={draft}
            onChange={setDraft}
            onPicked={picked}
            credentialOptions={credentialOptions}
            disabled={addMut.isPending}
          />
          {shownSources.length > 0 && (
            <div data-testid="add-model-sources" className="space-y-0.5 text-[11px] text-fg-subtle">
              {shownSources.includes("provider") && <p>{t("models.add.fromProvider")}</p>}
              {shownSources.includes("suggested") && <p>{t("models.add.suggested")}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label mb-1.5 block">{t("models.edit.contextWindow")}</span>
              <input
                inputMode="numeric"
                data-testid="add-model-context"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="300000"
                aria-invalid={contextTokens === null}
                disabled={addMut.isPending}
                className="input font-mono"
              />
            </label>
            <label className="block">
              <span className="field-label mb-1.5 block">{t("models.edit.maxOutputTokens")}</span>
              <input
                inputMode="numeric"
                data-testid="add-model-max-output"
                value={maxOutput}
                onChange={(e) => setMaxOutput(e.target.value)}
                aria-invalid={outputTokens === null}
                disabled={addMut.isPending}
                className="input font-mono"
              />
            </label>
            <p className="text-[11px] text-fg-subtle sm:col-span-2">
              {contextTokens === null || outputTokens === null
                ? t("models.add.limitsInvalid")
                : t("models.add.limitsHint")}
            </p>
          </div>
          {effortLevels.length > 0 && (
            <EffortPicker
              value={effort}
              onChange={setEffort}
              levels={effortLevels}
              disabled={addMut.isPending}
            />
          )}
          <InputsPicker value={inputs} onChange={setInputs} disabled={addMut.isPending} />
          <PriceFields
            value={price}
            onChange={setPrice}
            invalid={pricing === null}
            disabled={addMut.isPending}
          />
          {conflict && (
            <p className="text-xs text-warn" data-testid="add-model-conflict">
              <Trans
                i18nKey="models.add.conflict"
                components={{ name: <span className="font-mono">{name}</span> }}
              />
            </p>
          )}
          {error && (
            <div
              data-testid="add-model-error"
              className="note-danger text-xs"
            >
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="add-model-submit"
            className="btn-primary"
          >
            <Check className="h-3.5 w-3.5" />
            {addMut.isPending ? t("models.add.adding") : t("common.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
