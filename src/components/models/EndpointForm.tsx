import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useEndpointModels } from "../../hooks/useEndpointModels";
import { API_FORMATS, apiFormatHint, apiFormatLabel, type ApiFormat } from "../../lib/apiFormats";
import type { ModelAddArgs } from "../../types";

/**
 * A model endpoint as the runtime configures it (ADR-068): a base URL,
 * an API format, the wire model id, and a credential — no vendor
 * presets. The configured name is optional and defaults to the model id.
 */
export interface EndpointDraft {
  baseUrl: string;
  apiFormat: ApiFormat;
  modelId: string;
  /** Optional configured name; empty uses the model id. */
  name: string;
  /** False for keyless endpoints (local servers). */
  needsKey: boolean;
  key: string;
  /** An existing vault credential instead of a new key. */
  credentialId: string;
}

export const EMPTY_ENDPOINT: EndpointDraft = {
  baseUrl: "",
  apiFormat: "openai",
  modelId: "",
  name: "",
  needsKey: true,
  key: "",
  credentialId: "",
};

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const URL_RE = /^https?:\/\/\S+$/;

/** The id the model will have in the catalog. */
export function endpointName(draft: EndpointDraft): string {
  return draft.name.trim() || draft.modelId.trim();
}

export function isEndpointValid(draft: EndpointDraft): boolean {
  if (!URL_RE.test(draft.baseUrl.trim())) return false;
  if (!draft.modelId.trim()) return false;
  if (draft.name.trim() && !NAME_RE.test(draft.name.trim())) return false;
  if (draft.needsKey && !draft.key.trim() && !draft.credentialId) return false;
  return true;
}

/** The `model_add` arguments for a draft. */
export function endpointArgs(draft: EndpointDraft): ModelAddArgs {
  const name = draft.name.trim();
  return {
    custom: true,
    apiFormat: draft.apiFormat,
    baseUrl: draft.baseUrl.trim(),
    model: [draft.modelId.trim()],
    requiresKey: draft.needsKey,
    ...(name && { name }),
    ...(draft.needsKey && draft.key.trim() && { key: draft.key.trim() }),
    ...(draft.needsKey && !draft.key.trim() && draft.credentialId && {
      credentialId: draft.credentialId,
    }),
  };
}

const INPUT =
  "input";
const LABEL = "field-label mb-1.5 block";

/**
 * Fields for one endpoint. The name, the keyless switch, and reusing a
 * stored credential sit under "Advanced" so the common case is four
 * fields. Once the base URL and key are in, the endpoint is asked for
 * its models, and the model id can be picked from that list (an
 * endpoint with only one fills it in).
 */
export default function EndpointForm({
  value,
  onChange,
  credentialOptions = [],
  disabled,
}: {
  value: EndpointDraft;
  onChange: (next: EndpointDraft) => void;
  credentialOptions?: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const set = (patch: Partial<EndpointDraft>) => onChange({ ...value, ...patch });
  const formatHint = apiFormatHint(value.apiFormat);
  const nameBad = !!value.name.trim() && !NAME_RE.test(value.name.trim());
  const canList =
    URL_RE.test(value.baseUrl.trim()) &&
    !value.credentialId &&
    (!value.needsKey || !!value.key.trim());
  const listed = useEndpointModels(
    value.baseUrl,
    value.apiFormat,
    value.needsKey ? value.key : undefined,
    canList,
  );
  const only = listed.data?.length === 1 ? listed.data[0] : null;
  useEffect(() => {
    if (only && !value.modelId.trim()) onChange({ ...value, modelId: only });
    // Only when a one-model list arrives; typing stays the person's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only]);

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block">
        <span className={LABEL}>{t("models.endpoint.baseUrl")}</span>
        <input
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value.baseUrl}
          onChange={(e) => set({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
          className={`${INPUT} font-mono`}
        />
      </label>

      <div>
        <label className="block">
          <span className={LABEL}>{t("models.endpoint.apiFormat")}</span>
          <select
            value={value.apiFormat}
            onChange={(e) => set({ apiFormat: e.target.value as ApiFormat })}
            className={INPUT}
          >
            {API_FORMATS.map((f) => (
              <option key={f} value={f}>
                {apiFormatLabel(f)}
              </option>
            ))}
          </select>
        </label>
        {formatHint && <p className="mt-1 text-[11px] text-fg-subtle">{formatHint}</p>}
      </div>

      {value.needsKey && !value.credentialId && (
        <div>
          <label className="block">
            <span className={LABEL}>{t("models.endpoint.apiKey")}</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              type="password"
              autoComplete="off"
              value={value.key}
              onChange={(e) => set({ key: e.target.value })}
              placeholder={t("models.endpoint.keyPlaceholder")}
              className={`${INPUT} font-mono`}
            />
          </label>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t("models.endpoint.keyHint")}
          </p>
        </div>
      )}

      <div>
        <label className="block">
          <span className={LABEL}>{t("models.endpoint.modelId")}</span>
          <input
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value.modelId}
            onChange={(e) => set({ modelId: e.target.value })}
            placeholder={
              listed.data?.length
                ? t("models.endpoint.modelIdPlaceholderPick")
                : t("models.endpoint.modelIdPlaceholder")
            }
            className={`${INPUT} font-mono`}
          />
        </label>
        {listed.isFetching && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-subtle">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("models.endpoint.listing")}
          </p>
        )}
        {!listed.isFetching && listed.data && listed.data.length > 0 && (
          <label className="mt-2 block">
            <span className="sr-only">{t("models.endpoint.offeredLabel")}</span>
            <select
              data-testid="endpoint-models"
              value={listed.data.includes(value.modelId.trim()) ? value.modelId.trim() : ""}
              onChange={(e) => e.target.value && set({ modelId: e.target.value })}
              className={INPUT}
            >
              <option value="">
                {t("models.endpoint.offered", { count: listed.data.length })}
              </option>
              {listed.data.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        {!listed.isFetching && listed.error && (
          <p data-testid="endpoint-models-error" className="mt-1 text-[11px] text-fg-subtle">
            {t("models.endpoint.listFailed", {
              error: listed.error instanceof Error ? listed.error.message : String(listed.error),
            })}
          </p>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg-soft"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${advanced ? "rotate-90" : ""}`} />
          {t("common.advanced")}
        </button>
        {advanced && (
          <div className="mt-2 space-y-3 border-l-2 border-line pl-3">
            <div>
              <label className="block">
                <span className={LABEL}>{t("models.endpoint.name")}</span>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={value.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder={value.modelId.trim() || t("models.endpoint.namePlaceholder")}
                  aria-invalid={nameBad}
                  className={INPUT}
                />
              </label>
              {nameBad && (
                <p className="mt-1 text-[11px] text-danger">{t("models.endpoint.nameInvalid")}</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-fg-soft">
              <input
                type="checkbox"
                checked={!value.needsKey}
                onChange={(e) => set({ needsKey: !e.target.checked, key: "", credentialId: "" })}
              />
              {t("models.endpoint.noKey")}
            </label>
            {value.needsKey && credentialOptions.length > 0 && (
              <label className="block">
                <span className={LABEL}>{t("models.endpoint.storedCredential")}</span>
                <select
                  value={value.credentialId}
                  onChange={(e) => set({ credentialId: e.target.value, key: "" })}
                  className={INPUT}
                >
                  <option value="">{t("models.endpoint.pasteNewKey")}</option>
                  {credentialOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
