import { useEffect, useMemo, useState } from "react";
import { Check, Plus, RefreshCw, X } from "lucide-react";

import { useAddProvider, useProviderTemplates } from "../../hooks/useProviders";
import type { ProviderAddArgs, ProviderTemplate } from "../../types";

type Mode = "template" | "custom";

interface CustomForm {
  id: string;
  displayName: string;
  apiFormat: "openai_completions" | "anthropic_messages" | "";
  baseUrl: string;
  model: string;
  requiresKey: boolean;
  apiKey: string;
  setDefault: boolean;
}

interface TemplateForm {
  nameOverride: string;
  apiKey: string;
  setDefault: boolean;
}

const INITIAL_CUSTOM: CustomForm = {
  id: "",
  displayName: "",
  apiFormat: "openai_completions",
  baseUrl: "",
  model: "",
  requiresKey: true,
  apiKey: "",
  setDefault: false,
};

const INITIAL_TEMPLATE: TemplateForm = {
  nameOverride: "",
  apiKey: "",
  setDefault: false,
};

/**
 * Add a provider to the runtime catalog without leaving the desktop.
 *
 * T-109b ships two paths:
 * - **Template**: pick one of the built-in templates from
 *   `provider_templates` (`anthropic`, `openai`, `groq`, `ollama`, …).
 *   Optional `name` override, optional `apiKey` (shown only when
 *   `requiresKey`), and "set as runtime default".
 * - **Custom**: define an OpenAI-compatible or Anthropic-compatible
 *   endpoint from scratch (id, displayName, apiFormat, baseUrl, model,
 *   requiresKey).
 *
 * Submitting drives the runtime's `RequestPacket::ProviderAdd` →
 * `ResponsePacket::ProviderAdded` over IPC. `useAddProvider` invalidates
 * the catalog + credentials + template caches so the new pill shows
 * green immediately (or appears unconfigured, if no key was supplied).
 *
 * The bare-invocation guard mirrors the CLI: sending neither `template`
 * nor `custom: true` produces a `ResponsePacket::Error` from the
 * runtime, surfaced as the error banner — keeping desktop ↔ CLI
 * behavior aligned (per-memory `cli-catalog-vs-vault-disagreement`).
 */
export default function AddProviderModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: (providerId: string) => void;
}) {
  // Pull error/loading too — the previous "No built-in templates are
  // available." message fired when IPC returned `[]` OR silently
  // failed, which left the user with no signal about *why* the picker
  // was empty. Now we surface the runtime error directly so the user
  // can see whether it's "IPC is down" vs "you have no templates"
  // (and they can switch to Custom in either case).
  const {
    data: templates,
    isLoading: templatesLoading,
    error: templatesError,
    refetch: refetchTemplates,
  } = useProviderTemplates();
  const addMut = useAddProvider();

  const [mode, setMode] = useState<Mode>("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(INITIAL_TEMPLATE);
  const [customForm, setCustomForm] = useState<CustomForm>(INITIAL_CUSTOM);

  const selectedTemplate = useMemo<ProviderTemplate | null>(
    () => (templates ?? []).find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  // Reset form when reopened so a previous attempt doesn't bleed in.
  useEffect(() => {
    if (open) {
      setMode("template");
      setSelectedTemplateId(null);
      setTemplateForm(INITIAL_TEMPLATE);
      setCustomForm(INITIAL_CUSTOM);
      addMut.reset();
    }
    // Excluding `addMut` is intentional — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const templateValid = isTemplateValid(selectedTemplate, templateForm);
  const customValid = isCustomValid(customForm);
  const canSubmit =
    !addMut.isPending &&
    ((mode === "template" && templateValid) ||
      (mode === "custom" && customValid));

  function handleSubmit() {
    const args = buildArgs(mode, selectedTemplateId, templateForm, customForm);
    if (!args) return;
    addMut.mutate(args, {
      onSuccess: (info) => {
        onSuccess?.(info.id);
        onClose();
      },
    });
  }

  if (!open) return null;

  const errorMessage =
    addMut.error instanceof Error
      ? addMut.error.message
      : addMut.error
        ? String(addMut.error)
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Add a Provider
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            data-testid="add-provider-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pick a built-in template or define a custom OpenAI / Anthropic-compatible
            endpoint. The runtime stores the entry in its catalog
            (<code>providers.toml</code>); any API key you enter here is handed off
            to the OS keychain immediately.
          </p>

          {/* Mode toggle */}
          <div className="flex gap-2">
            {(["template", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                data-testid={`add-provider-mode-${m}`}
                className={[
                  "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  mode === m
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {m === "template" ? "From template" : "Custom endpoint"}
              </button>
            ))}
          </div>

          {/* Template branch */}
          {mode === "template" && (
            <div className="space-y-3">
              {templatesLoading && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Loading templates…
                </p>
              )}
              {templatesError && !templatesLoading && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                  <div className="mb-1 font-medium">
                    Could not load built-in templates
                  </div>
                  <div className="font-mono text-[11px]">
                    {templatesError instanceof Error
                      ? templatesError.message
                      : String(templatesError)}
                  </div>
                  <button
                    type="button"
                    onClick={() => refetchTemplates()}
                    data-testid="retry-templates"
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-0.5 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                </div>
              )}
              {!templatesLoading && !templatesError && (templates ?? []).length === 0 && (
                <p
                  data-testid="templates-empty-state"
                  className="text-xs text-slate-500 dark:text-slate-400"
                >
                  No built-in templates are available. Switch to{" "}
                  <strong>Custom endpoint</strong> to add an OpenAI- or
                  Anthropic-compatible provider manually.
                </p>
              )}
              <div
                className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800"
                data-testid="add-provider-template-list"
              >
                {(templates ?? []).map((t) => {
                  const selected = t.id === selectedTemplateId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        setSelectedTemplateId(selected ? null : t.id)
                      }
                      data-testid={`add-provider-template-${t.id}`}
                      className={[
                        "flex w-full flex-col gap-1 border-b px-3 py-2 text-left text-xs last:border-b-0",
                        selected
                          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                          : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={[
                            "inline-block h-2.5 w-2.5 rounded-full border",
                            selected
                              ? "border-emerald-500 bg-emerald-500"
                              : "border-slate-400 dark:border-slate-600",
                          ].join(" ")}
                        />
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {t.displayName}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                          {t.id}
                        </span>
                        <span className="ml-auto inline-flex items-center gap-1.5">
                          <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {t.apiType}
                          </span>
                          {t.requiresKey ? (
                            <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                              Key
                            </span>
                          ) : (
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              Local
                            </span>
                          )}
                        </span>
                      </div>
                      {t.defaultModel && (
                        <span className="ml-4 text-[11px] text-slate-500 dark:text-slate-400">
                          default: <span className="font-mono">{t.defaultModel}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedTemplate && (
                <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  {selectedTemplate.models.length > 0 && (
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Models
                      </span>
                      <ul className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
                        {selectedTemplate.models.map((m) => (
                          <li
                            key={m.id}
                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <span className="font-mono text-slate-700 dark:text-slate-300">
                              {m.id}
                            </span>
                            {m.contextLength !== undefined && (
                              <span className="ml-2 text-slate-500 dark:text-slate-400">
                                {m.contextLength.toLocaleString()} ctx
                                {m.maxOutputTokens !== undefined
                                  ? ` / ${m.maxOutputTokens.toLocaleString()} out`
                                  : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Name override (optional — defaults to <code>{selectedTemplate.id}</code>)
                    </label>
                    <input
                      value={templateForm.nameOverride}
                      onChange={(e) =>
                        setTemplateForm({
                          ...templateForm,
                          nameOverride: e.target.value,
                        })
                      }
                      placeholder={selectedTemplate.id}
                      data-testid="add-provider-name-override"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                  {selectedTemplate.requiresKey && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        API key
                      </label>
                      <input
                        type="password"
                        value={templateForm.apiKey}
                        onChange={(e) =>
                          setTemplateForm({
                            ...templateForm,
                            apiKey: e.target.value,
                          })
                        }
                        placeholder="sk-..."
                        data-testid="add-provider-api-key"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={templateForm.setDefault}
                      onChange={(e) =>
                        setTemplateForm({
                          ...templateForm,
                          setDefault: e.target.checked,
                        })
                      }
                    />
                    Set as runtime default
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Custom branch */}
          {mode === "custom" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Provider ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={customForm.id}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, id: e.target.value })
                    }
                    placeholder="my-llama"
                    data-testid="add-provider-custom-id"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Display name (optional)
                  </label>
                  <input
                    value={customForm.displayName}
                    onChange={(e) =>
                      setCustomForm({
                        ...customForm,
                        displayName: e.target.value,
                      })
                    }
                    placeholder="My Llama"
                    data-testid="add-provider-custom-display-name"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    API format
                  </label>
                  <select
                    value={customForm.apiFormat}
                    onChange={(e) =>
                      setCustomForm({
                        ...customForm,
                        apiFormat: e.target.value as CustomForm["apiFormat"],
                      })
                    }
                    data-testid="add-provider-custom-api-format"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="openai_completions">openai_completions</option>
                    <option value="anthropic_messages">anthropic_messages</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Base URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={customForm.baseUrl}
                    onChange={(e) =>
                      setCustomForm({
                        ...customForm,
                        baseUrl: e.target.value,
                      })
                    }
                    placeholder="https://api.example.com/v1"
                    data-testid="add-provider-custom-base-url"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Model ID <span className="text-red-500">*</span>
                </label>
                <input
                  value={customForm.model}
                  onChange={(e) =>
                    setCustomForm({ ...customForm, model: e.target.value })
                  }
                  placeholder="llama-3.1-70b"
                  data-testid="add-provider-custom-model"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={customForm.requiresKey}
                  onChange={(e) =>
                    setCustomForm({
                      ...customForm,
                      requiresKey: e.target.checked,
                    })
                  }
                  data-testid="add-provider-custom-requires-key"
                />
                Requires API key
              </label>
              {customForm.requiresKey && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    API key
                  </label>
                  <input
                    type="password"
                    value={customForm.apiKey}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, apiKey: e.target.value })
                    }
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={customForm.setDefault}
                  onChange={(e) =>
                    setCustomForm({
                      ...customForm,
                      setDefault: e.target.checked,
                    })
                  }
                />
                Set as runtime default
              </label>
            </div>
          )}

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
            disabled={!canSubmit}
            data-testid="add-provider-submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function isTemplateValid(
  template: ProviderTemplate | null,
  form: TemplateForm,
): boolean {
  if (!template) return false;
  if (form.nameOverride && !/^[A-Za-z0-9_-]+$/.test(form.nameOverride)) {
    return false;
  }
  return true;
}

function isCustomValid(form: CustomForm): boolean {
  if (!form.id.trim()) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(form.id.trim())) return false;
  if (!form.baseUrl.trim()) return false;
  if (!form.model.trim()) return false;
  if (form.apiFormat !== "openai_completions" && form.apiFormat !== "anthropic_messages") {
    return false;
  }
  return true;
}

function buildArgs(
  mode: Mode,
  templateId: string | null,
  templateForm: TemplateForm,
  customForm: CustomForm,
): ProviderAddArgs | null {
  if (mode === "template") {
    if (!templateId) return null;
    const trimmedKey = templateForm.apiKey.trim();
    const args: ProviderAddArgs = {
      template: templateId,
      custom: false,
      ...(templateForm.nameOverride.trim() && {
        name: templateForm.nameOverride.trim(),
      }),
      ...(trimmedKey && { key: trimmedKey }),
      ...(templateForm.setDefault && { setDefault: true }),
    };
    return args;
  }
  if (!isCustomValid(customForm)) return null;
  const trimmedKey = customForm.apiKey.trim();
  const trimmedDisplayName = customForm.displayName.trim();
  const args: ProviderAddArgs = {
    name: customForm.id.trim(),
    custom: true,
    apiFormat: customForm.apiFormat,
    baseUrl: customForm.baseUrl.trim(),
    model: [customForm.model.trim()],
    requiresKey: customForm.requiresKey,
    ...(trimmedDisplayName && { displayName: trimmedDisplayName }),
    ...(customForm.setDefault && { setDefault: true }),
  };
  if (customForm.requiresKey && trimmedKey) {
    args.key = trimmedKey;
  }
  return args;
}
