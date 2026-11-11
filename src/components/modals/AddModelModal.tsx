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
import {
  NO_MEDIA,
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
  const pricing = pricingFromDraft(price);

  // A reopened dialog starts clean.
  useEffect(() => {
    if (open) {
      setDraft(EMPTY_ENDPOINT);
      setInputs(NO_MEDIA);
      setPrice(EMPTY_PRICE_DRAFT);
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
