import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAgents, useRemoveAgent, useCreateAgent, useProviders } from "../hooks/useAgents";
import DataTable from "../components/DataTable";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import { Plus, Trash2, ExternalLink, Loader2, Bot, X, Cloud, Home, Key, ChevronRight, Check } from "lucide-react";
import type { AgentSummary, ProviderInfo } from "../types";

const STATUS_STYLE: Record<string, string> = {
  idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  busy: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  offline: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

// Curated model lists per provider (static for now, expandable later)
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

function ProviderCard({
  provider,
  selected,
  onClick,
}: {
  provider: ProviderInfo;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex flex-col rounded-xl border p-4 text-left transition-all",
        selected
          ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 dark:border-emerald-400 dark:bg-emerald-950/30"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-900 dark:text-white">{provider.display_name}</span>
        {selected && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {provider.is_local ? (
          <span className="inline-flex items-center gap-1">
            <Home className="h-3 w-3" /> Local
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Cloud className="h-3 w-3" /> Cloud
          </span>
        )}
        <span>·</span>
        {provider.requires_key ? (
          <span className="inline-flex items-center gap-1">
            <Key className="h-3 w-3" /> API key required
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> No key needed
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
        Default: {provider.default_model}
      </div>
    </button>
  );
}

function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAgent();
  const { data: providers, isLoading: providersLoading } = useProviders();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null);
  const [selectedModel, setSelectedModel] = useState("");

  if (!open) return null;

  const availableModels = selectedProvider ? (PROVIDER_MODELS[selectedProvider.id] || [selectedProvider.default_model]) : [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !selectedProvider) return;
    const model = selectedModel || selectedProvider.default_model;
    create.mutate(
      { name: name.trim(), provider: selectedProvider.id, model, description: description.trim() || undefined },
      { onSuccess: onClose }
    );
  }

  function handleProviderSelect(provider: ProviderInfo) {
    setSelectedProvider(provider);
    setSelectedModel(provider.default_model);
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
                : `Configure your ${selectedProvider?.display_name} agent`}
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {providers.map((provider) => (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      selected={selectedProvider?.id === provider.id}
                      onClick={() => handleProviderSelect(provider)}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
                  No providers available
                </div>
              )}
            </div>
          )}

          {step === 2 && selectedProvider && (
            <div className="space-y-4">
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
                      {model === selectedProvider.default_model ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  {selectedProvider.requires_key
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

export default function Agents() {
  const { data: agents, isLoading } = useAgents();
  const remove = useRemoveAgent();
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: AgentSummary) => (
        <Link
          to="/agents/$name"
          params={{ name: row.name }}
          className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      sortable: true,
      render: (row: AgentSummary) => {
        const parts = row.model.split("/");
        const provider = parts.length > 1 ? parts[0] : "—";
        return <span className="text-slate-600 dark:text-slate-400">{provider}</span>;
      },
    },
    {
      key: "model",
      header: "Model",
      sortable: true,
      render: (row: AgentSummary) => <span className="text-slate-600 dark:text-slate-400">{row.model}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: AgentSummary) => (
        <span
          className={[
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_STYLE[row.status] ?? STATUS_STYLE.offline,
          ].join(" ")}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: "lastActive",
      header: "Last Activity",
      sortable: true,
      render: (row: AgentSummary) => (row.lastActive ? formatDate(row.lastActive) : "—"),
    },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (row: AgentSummary) => (
        <div className="flex items-center gap-2">
          <Link
            to="/agents/$name"
            params={{ name: row.name }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="View"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => setConfirmName(row.name)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Agents</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage your AI agents</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
          <p className="text-sm text-slate-400 dark:text-slate-600">Loading agents...</p>
        </div>
      ) : agents && agents.length > 0 ? (
        <DataTable
          columns={columns}
          rows={agents}
          keyExtractor={(r) => r.name}
          emptyText="No agents found"
          searchable
          pageSize={10}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <Bot className="h-10 w-10 text-slate-300 dark:text-slate-700" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">No agents yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Create your first agent to get started</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!confirmName}
        title="Remove Agent"
        message={`Are you sure you want to remove agent "${confirmName ?? ""}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmName) remove.mutate(confirmName);
          setConfirmName(null);
        }}
        onCancel={() => setConfirmName(null)}
      />

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
