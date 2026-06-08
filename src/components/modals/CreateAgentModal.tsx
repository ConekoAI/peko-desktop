import { useState } from "react";
import { useCreateAgent, useProviders } from "../../hooks/useAgents";
import { useRuntimes } from "../../hooks/useRuntimes";
import {
  Loader2,
  X,
  Cloud,
  Home,
  Key,
  ChevronRight,
  Check,
  Search,
} from "lucide-react";
import type { ProviderInfo } from "../../types";

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
  ollama: ["llama3.1", "llama3.2", "mistral", "qwen2.5", "phi4"],
  minimax: ["MiniMax-M2.7"],
  kimi: ["kimi-for-coding"],
  moonshot: ["kimi-k2.5", "kimi-k2.6"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  groq: ["llama-3.1-70b-versatile", "mixtral-8x7b-32768"],
  together: ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"],
  fireworks: ["accounts/fireworks/models/llama-v3p1-70b-instruct"],
  xai: ["grok-beta", "grok-2"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
  perplexity: ["llama-3.1-sonar-large-128k-online"],
  cohere: ["command-r-plus", "command-r"],
  "azure-openai": ["gpt-4o", "gpt-4"],
};

function ProviderRow({
  provider,
  onClick,
}: {
  provider: ProviderInfo;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-all hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400">
          {provider.displayName.slice(0, 2)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">{provider.displayName}</span>
          {provider.isLocal ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <Home className="h-2.5 w-2.5" /> Local
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <Cloud className="h-2.5 w-2.5" /> Cloud
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
          <span className="truncate">{provider.defaultModel}</span>
          <span>·</span>
          {provider.requiresKey ? (
            <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
              <Key className="h-2.5 w-2.5" /> Key required
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Check className="h-2.5 w-2.5" /> No key
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
    </button>
  );
}

export default function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAgent();
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: runtimes } = useRuntimes();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>("local");

  if (!open) return null;

  const availableModels = selectedProvider ? (PROVIDER_MODELS[selectedProvider.id] || [selectedProvider.defaultModel]) : [];

  // Default to local runtime if available, otherwise first connected runtime
  const defaultRuntime = runtimes?.find((r) => r.id === "local") ?? runtimes?.[0];
  const effectiveRuntimeId = selectedRuntimeId || defaultRuntime?.id || "local";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !selectedProvider) return;
    const model = selectedModel || selectedProvider.defaultModel;
    create.mutate(
      {
        name: name.trim(),
        provider: selectedProvider.id,
        model,
        description: description.trim() || undefined,
        runtimeId: effectiveRuntimeId,
      },
      { onSuccess: onClose }
    );
  }

  function handleProviderSelect(provider: ProviderInfo) {
    setSelectedProvider(provider);
    setSelectedModel(provider.defaultModel);
    setStep(2);
  }

  function handleBack() {
    setStep(1);
    setSelectedProvider(null);
    setSelectedModel("");
  }

  function handleClose() {
    setStep(1);
    setName("");
    setDescription("");
    setSelectedProvider(null);
    setSelectedModel("");
    setProviderSearch("");
    setSelectedRuntimeId("local");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {step === 1 ? "Choose a Provider" : "Agent Details"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {step === 1
                ? "Select the AI provider for your agent"
                : `Configure your ${selectedProvider?.displayName} agent`}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex shrink-0 items-center gap-2 px-6 pt-4">
          <span
            className={[
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
              step >= 1
                ? "bg-emerald-600 text-white"
                : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
            ].join(" ")}
          >
            1
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-600">Provider</span>
          <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
          <span
            className={[
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
              step >= 2
                ? "bg-emerald-600 text-white"
                : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
            ].join(" ")}
          >
            2
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-600">Details</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-3">
              {providersLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-300 dark:text-slate-700" />
                  <p className="text-sm text-slate-400 dark:text-slate-600">Loading providers...</p>
                </div>
              ) : providers && providers.length > 0 ? (
                <>
                  {/* Provider search */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      placeholder="Search providers..."
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                  {/* Provider list — sorted alphabetically */}
                  <div className="space-y-1.5">
                    {providers
                      .slice()
                      .sort((a, b) => a.displayName.localeCompare(b.displayName))
                      .filter((p) =>
                        providerSearch.trim()
                          ? p.displayName.toLowerCase().includes(providerSearch.trim().toLowerCase()) ||
                            p.id.toLowerCase().includes(providerSearch.trim().toLowerCase())
                          : true
                      )
                      .map((provider) => (
                        <ProviderRow
                          key={provider.id}
                          provider={provider}
                          onClick={() => handleProviderSelect(provider)}
                        />
                      ))}
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
                  No providers available
                </div>
              )}
            </div>
          )}

          {step === 2 && selectedProvider && (
            <div className="space-y-4">
              {/* Runtime selector */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Runtime
                </label>
                <select
                  value={effectiveRuntimeId}
                  onChange={(e) => setSelectedRuntimeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  {runtimes?.map((runtime) => (
                    <option key={runtime.id} value={runtime.id}>
                      {runtime.name} ({runtime.connectionType})
                    </option>
                  )) ?? <option value="local">Local Runtime</option>}
                </select>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Choose which runtime will host this agent
                </p>
              </div>

              {/* Model selection */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                      {model === selectedProvider.defaultModel ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  {selectedProvider.requiresKey
                    ? "Make sure your API key is configured in Settings."
                    : "This provider runs locally — no API key needed."}
                </p>
              </div>

              {/* Name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-agent"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Description <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this agent does..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          {step === 2 ? (
            <>
              <button
                type="button"
                onClick={handleBack}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={create.isPending || !name.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Agent
              </button>
            </>
          ) : (
            <div className="ml-auto">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
