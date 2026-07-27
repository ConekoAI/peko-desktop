import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Cpu,
  Loader2,
  Sparkles,
  X,
  Bot,
  Settings,
} from "lucide-react";

import { usePrincipals, usePrincipalCreate } from "../hooks/usePrincipals";
import { useModels } from "../hooks/useModels";
import { isValidPrincipalName } from "../lib/validatePrincipalName";

/**
 * First-run walkthrough overlay (T-105 Phase D, model-first).
 *
 * Closes the desktop's "drop to CLI" dead end on a fresh profile.
 * Auto-appears when there are zero principals AND the user hasn't
 * dismissed it before (`localStorage["peko.onboarding.seen"] !== "1"`).
 *
 * Two steps:
 *   1. pick-model — choose from the runtime's configured models
 *   2. create-principal — name + optional description → usePrincipalCreate
 *
 * If no models are configured yet, the user is pointed to Settings → Models
 * to add one first.
 *
 * Each step has a Back/Next pair and a top-level Skip that closes the
 * overlay and sets the localStorage flag. Step-2 success also sets the
 * flag and closes (and the principal lands in the sidebar via
 * usePrincipalCreate's cache invalidation).
 *
 * Replay: Settings → About → "Replay onboarding" clears the flag
 * and dispatches `peko:replay-onboarding`; this overlay listens and
 * re-shows.
 */
export const ONBOARDING_KEY = "peko.onboarding.seen";
export const REPLAY_EVENT = "peko:replay-onboarding";

type Step = 1 | 2;

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Pick model" },
  { id: 2, label: "Create principal" },
];

export default function FirstRunWalkthrough() {
  const { data: principals, isLoading: principalsLoading } = usePrincipals();
  const { data: models, isLoading: modelsLoading } = useModels();

  // Only show the overlay when:
  //   - principals have loaded (not isLoading)
  //   - there are zero principals
  //   - the dismiss flag is not set
  //   - the walkthrough hasn't been explicitly dismissed in this session
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(ONBOARDING_KEY) === "1";
    if (principalsLoading) return;
    if (seen) return;
    if (!principals || principals.length > 0) return;
    if (dismissed) return;
    setVisible(true);
  }, [principals, principalsLoading, dismissed]);

  // Listen for the Replay-onboarding broadcast from Settings.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handle() {
      setDismissed(false);
      setVisible(true);
    }
    window.addEventListener(REPLAY_EVENT, handle);
    return () => window.removeEventListener(REPLAY_EVENT, handle);
  }, []);

  function handleDismiss() {
    if (typeof window !== "undefined") {
      localStorage.setItem(ONBOARDING_KEY, "1");
    }
    setDismissed(true);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-walkthrough-title"
      data-testid="first-run-walkthrough"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
    >
      <WalkthroughCard
        onDismiss={handleDismiss}
        models={models}
        modelsLoading={modelsLoading}
      />
    </div>
  );
}

function WalkthroughCard({
  onDismiss,
  models,
  modelsLoading,
}: {
  onDismiss: () => void;
  models: ReturnType<typeof useModels>["data"];
  modelsLoading: boolean;
}) {
  const [step, setStep] = useState<Step>(1);
  const [modelId, setModelId] = useState<string | null>(null);
  const [principalName, setPrincipalName] = useState("");
  const [principalDescription, setPrincipalDescription] = useState("");

  const modelItems = useMemo(
    () => resolveModelItems(models ?? undefined, modelsLoading),
    [models, modelsLoading],
  );

  // Pre-select the first available model once the list loads.
  useEffect(() => {
    if (modelId !== null) return;
    if (modelItems.length === 0) return;
    setModelId(modelItems[0].id);
  }, [modelItems, modelId]);

  const createMut = usePrincipalCreate();

  function handleNext() {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      createMut.mutate(
        {
          name: principalName.trim(),
          description: principalDescription.trim() || undefined,
          modelId: modelId ?? "",
        },
        { onSuccess: onDismiss },
      );
    }
  }

  function handleBack() {
    if (step === 1) return;
    setStep(1);
  }

  const canAdvance = (() => {
    switch (step) {
      case 1:
        return modelId !== null;
      case 2:
        return isValidPrincipalName(principalName);
    }
  })();

  const errorMessage =
    createMut.error instanceof Error
      ? createMut.error.message
      : createMut.error
        ? String(createMut.error)
        : null;

  return (
    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2
              id="first-run-walkthrough-title"
              className="text-base font-semibold text-slate-900 dark:text-white"
            >
              Welcome to Peko
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Pick a configured model and name your first Principal.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Skip onboarding"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Stepper current={step} />

      <div className="px-6 py-5">
        {step === 1 && (
          <Step1
            models={modelItems}
            loading={modelsLoading}
            selected={modelId}
            onSelect={setModelId}
          />
        )}
        {step === 2 && (
          <Step2
            name={principalName}
            onNameChange={setPrincipalName}
            description={principalDescription}
            onDescriptionChange={setPrincipalDescription}
            modelLabel={
              modelId
                ? modelItems.find((m) => m.id === modelId)?.displayName ?? modelId
                : null
            }
          />
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
          >
            {errorMessage}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Skip for now
        </button>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance || (step === 2 && createMut.isPending)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {step === 2 && createMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : step === 2 ? (
              <Bot className="h-3.5 w-3.5" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            {step === 2 ? "Create" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <ol
      className="flex items-center gap-2 border-b border-slate-200 px-6 py-3 dark:border-slate-800"
      aria-label="Onboarding progress"
    >
      {STEPS.map((s, i) => {
        const isActive = s.id === current;
        const isDone = s.id < current;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <span
              className={[
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                isActive
                  ? "bg-emerald-600 text-white"
                  : isDone
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              ].join(" ")}
            >
              {isDone ? <Check className="h-3 w-3" /> : s.id}
            </span>
            <span
              className={[
                "truncate text-xs",
                isActive
                  ? "font-medium text-slate-800 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400",
              ].join(" ")}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={[
                  "h-px flex-1",
                  isDone
                    ? "bg-emerald-300 dark:bg-emerald-700"
                    : "bg-slate-200 dark:bg-slate-800",
                ].join(" ")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Step1({
  models,
  loading,
  selected,
  onSelect,
}: {
  models: { id: string; displayName: string; apiFormat: string; modelId: string }[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Choose the model your first Principal will use. You can change this
        later and add more models in Settings → Models.
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500 dark:text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading models…
        </div>
      )}

      {!loading && models.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center dark:border-slate-700">
          <Cpu className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No models configured yet
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400"
          >
            Add a model in Settings → Models before creating a Principal.
          </p>
          <button
            type="button"
            onClick={() => {
              // Closing the overlay lets the user open Settings.
              // The overlay will reappear on reload until dismissed.
              window.location.hash = "settings";
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Settings className="h-3.5 w-3.5" />
            Open Settings
          </button>
        </div>
      )}

      {!loading && models.length > 0 && (
        <div className="grid gap-2">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className={[
                "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                selected === m.id
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <span className="font-medium">{m.displayName}</span>
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                {m.apiFormat} · {m.modelId}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Step2({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  modelLabel,
}: {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  modelLabel: string | null;
}) {
  const trimmed = name.trim();
  const nameValid = isValidPrincipalName(trimmed);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Name your first Principal. It&apos;s the identity you&apos;ll chat with.
      </p>
      {modelLabel && (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          <Check className="h-3 w-3" />
          Model: {modelLabel}
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="alice"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
        {name && !nameValid && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Use 1–64 chars: letters, digits, &quot;-&quot;, &quot;_&quot;. No
            leading/trailing hyphen, &quot;..&quot;, or path separators.
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
          Description (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Personal coding assistant"
          rows={2}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
      </div>
    </div>
  );
}

/**
 * Model items compatible with the modal's picker. Defensive: an
 * unknown `models` shape renders as "no models" rather than crashing.
 */
interface ModelItem {
  id: string;
  displayName: string;
  apiFormat: string;
  modelId: string;
}

function resolveModelItems(
  models: unknown,
  loading: boolean,
): ModelItem[] {
  if (loading || !Array.isArray(models)) return [];
  return models
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const obj = m as Record<string, unknown>;
      const id =
        typeof obj.id === "string"
          ? obj.id
          : typeof obj.model_id === "string"
            ? obj.model_id
            : null;
      const displayName =
        typeof obj.displayName === "string"
          ? obj.displayName
          : typeof obj.display_name === "string"
            ? obj.display_name
            : id;
      const apiFormat =
        typeof obj.apiFormat === "string"
          ? obj.apiFormat
          : typeof obj.api_format === "string"
            ? obj.api_format
            : "";
      const modelId =
        typeof obj.modelId === "string"
          ? obj.modelId
          : typeof obj.model_id === "string"
            ? obj.model_id
            : "";
      if (!id) return null;
      return { id, displayName: displayName ?? id, apiFormat, modelId };
    })
    .filter((x): x is ModelItem => x !== null);
}
