import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { API_FORMATS, type ApiFormat } from "../../lib/apiFormats";
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

/** The id the model will have in the catalog. */
export function endpointName(draft: EndpointDraft): string {
  return draft.name.trim() || draft.modelId.trim();
}

export function isEndpointValid(draft: EndpointDraft): boolean {
  if (!/^https?:\/\/\S+$/.test(draft.baseUrl.trim())) return false;
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
  "w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand";
const LABEL = "mb-1 block text-xs font-medium text-fg-muted";

/**
 * Fields for one endpoint. The name, the keyless switch, and reusing a
 * stored credential sit under "Advanced" so the common case is four
 * fields.
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
  const [advanced, setAdvanced] = useState(false);
  const set = (patch: Partial<EndpointDraft>) => onChange({ ...value, ...patch });
  const format = API_FORMATS.find((f) => f.value === value.apiFormat);
  const nameBad = !!value.name.trim() && !NAME_RE.test(value.name.trim());

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block">
        <span className={LABEL}>Base URL</span>
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
          <span className={LABEL}>API format</span>
          <select
            value={value.apiFormat}
            onChange={(e) => set({ apiFormat: e.target.value as ApiFormat })}
            className={INPUT}
          >
            {API_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {format && <p className="mt-1 text-[11px] text-fg-subtle">{format.hint}</p>}
      </div>

      <label className="block">
        <span className={LABEL}>Model id</span>
        <input
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value.modelId}
          onChange={(e) => set({ modelId: e.target.value })}
          placeholder="The provider's model name, e.g. gpt-5 or mimo-v2.6-flash"
          className={`${INPUT} font-mono`}
        />
      </label>

      {value.needsKey && !value.credentialId && (
        <div>
          <label className="block">
            <span className={LABEL}>API key</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              type="password"
              autoComplete="off"
              value={value.key}
              onChange={(e) => set({ key: e.target.value })}
              placeholder="Paste your key"
              className={`${INPUT} font-mono`}
            />
          </label>
          <p className="mt-1 text-[11px] text-fg-subtle">
            Stored in your system keychain, not in a file.
          </p>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg-soft"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${advanced ? "rotate-90" : ""}`} />
          Advanced
        </button>
        {advanced && (
          <div className="mt-2 space-y-3 border-l-2 border-line pl-3">
            <div>
              <label className="block">
                <span className={LABEL}>Name in Peko (optional)</span>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={value.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder={value.modelId.trim() || "Defaults to the model id"}
                  aria-invalid={nameBad}
                  className={INPUT}
                />
              </label>
              {nameBad && (
                <p className="mt-1 text-[11px] text-danger">Use letters, numbers, ., - or _.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-fg-soft">
              <input
                type="checkbox"
                checked={!value.needsKey}
                onChange={(e) => set({ needsKey: !e.target.checked, key: "", credentialId: "" })}
              />
              No key needed (a local server, for example)
            </label>
            {value.needsKey && credentialOptions.length > 0 && (
              <label className="block">
                <span className={LABEL}>Use a stored credential instead</span>
                <select
                  value={value.credentialId}
                  onChange={(e) => set({ credentialId: e.target.value, key: "" })}
                  className={INPUT}
                >
                  <option value="">— Paste a new key —</option>
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
