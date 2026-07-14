import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Key,
  Loader2,
  Sparkles,
  TestTube,
  X,
  Bot,
} from "lucide-react";

import { usePrincipals, usePrincipalCreate } from "../hooks/usePrincipals";
import { useProviders } from "../hooks/useProviders";
import {
  useCredential,
  useCredentialList,
  useSetCredential,
  useTestCredential,
} from "../hooks/useSettings";
import { resolveProviderItems } from "../lib/settings-helpers";

/**
 * First-run walkthrough overlay (T-105 Phase D).
 *
 * Closes the desktop's "drop to CLI" dead end on a fresh profile.
 * Auto-appears when there are zero principals AND the user hasn't
 * dismissed it before (`localStorage["peko.onboarding.seen"] !== "1"`).
 *
 * Four steps:
 *   1. pick-provider   — toggle pills, fetch the catalog via useProviders
 *   2. paste-key       — API key input
 *   3. test-credential — Test → green (useTestCredential); gate Next
 *   4. create-principal — name + optional description → usePrincipalCreate
 *
 * Each step has a Back/Next pair and a top-level Skip that closes the
 * overlay and sets the localStorage flag. Step-4 success also sets
 * the flag and closes (and the principal lands in the sidebar via
 * usePrincipalCreate's cache invalidation).
 *
 * Replay: Settings → About → "Replay onboarding" clears the flag
 * and dispatches `peko:replay-onboarding`; this overlay listens and
 * re-shows.
 */
export const ONBOARDING_KEY = "peko.onboarding.seen";
export const REPLAY_EVENT = "peko:replay-onboarding";

type Step = 1 | 2 | 3 | 4;

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Pick provider" },
  { id: 2, label: "API key" },
  { id: 3, label: "Test connection" },
  { id: 4, label: "Create principal" },
];

export default function FirstRunWalkthrough() {
  const { data: principals, isLoading: principalsLoading } = usePrincipals();
  const { data: providers, isLoading: providersLoading } = useProviders();

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
      <WalkthroughCard onDismiss={handleDismiss} providers={providers} providersLoading={providersLoading} />
    </div>
  );
}

function WalkthroughCard({
  onDismiss,
  providers,
  providersLoading,
}: {
  onDismiss: () => void;
  providers: ReturnType<typeof useProviders>["data"];
  providersLoading: boolean;
}) {
  const [step, setStep] = useState<Step>(1);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [principalName, setPrincipalName] = useState("");
  const [principalDescription, setPrincipalDescription] = useState("");

  const providerItems = useMemo(
    () => resolveProviderItems(providers ?? undefined, providersLoading),
    [providers, providersLoading],
  );

  // Pull the existing keychain so we can skip past pick/paste/test
  // when the user already has a configured provider. Steps 1–3 only
  // matter when nothing is set yet; once a key exists we land on
  // Step 4 pre-selected so the walkthrough becomes "just name your
  // first Principal."
  const { data: credentials, isLoading: credentialsLoading } = useCredentialList();
  const configuredIds = useMemo(
    () =>
      (credentials ?? [])
        .filter((c) => c.provider && c.hasKey)
        .map((c) => c.provider),
    [credentials],
  );
  const configuredSet = useMemo(() => new Set(configuredIds), [configuredIds]);
  const hasConfiguredProvider = configuredIds.length > 0;

  // Pre-select a provider once the catalog + keychain have settled.
  // Order: configured catalog entry first (so users with `peko
  // provider add --template foo` land on their actual provider), then
  // the first built-in. Once a key is found, jump straight to Step 4
  // — no point re-running pick → paste → test.
  useEffect(() => {
    if (providerId !== null) return;
    if (providerItems.length === 0) return;
    const preferred = providerItems.find((p) => configuredSet.has(p.id));
    const initial = preferred ?? providerItems[0];
    setProviderId(initial.id);
  }, [providerItems, configuredSet, providerId]);

  useEffect(() => {
    if (credentialsLoading) return;
    if (hasConfiguredProvider && step === 1) {
      setStep(4);
    }
  }, [hasConfiguredProvider, credentialsLoading, step]);

  const { data: credential } = useCredential(providerId ?? "");
  const setCred = useSetCredential();
  const testCred = useTestCredential();
  const createMut = usePrincipalCreate();

  // Reset API-key input when switching providers so a key from one
  // provider doesn't bleed into another.
  useEffect(() => {
    setApiKey("");
  }, [providerId]);

  function handleNext() {
    if (step === 2) {
      // Save the API key as part of advancing — the Test step then
      // exercises the just-saved credential.
      if (providerId && apiKey) {
        setCred.mutate({ provider: providerId, apiKey });
        setApiKey("");
      }
      setStep(3);
      return;
    }
    if (step === 4) {
      createMut.mutate(
        {
          name: principalName.trim(),
          description: principalDescription.trim() || undefined,
          preferredProviderId: providerId ?? undefined,
        },
        { onSuccess: onDismiss },
      );
      return;
    }
    setStep(((step + 1) as Step));
  }

  function handleBack() {
    if (step === 1) return;
    setStep(((step - 1) as Step));
  }

  const canAdvance = (() => {
    switch (step) {
      case 1:
        return providerId !== null;
      case 2:
        return !!providerId && apiKey.trim().length > 0;
      case 3:
        return testCred.data?.success === true;
      case 4: {
        const trimmed = principalName.trim();
        return (
          trimmed.length > 0 &&
          trimmed.length <= 64 &&
          !trimmed.startsWith("-") &&
          !trimmed.endsWith("-") &&
          !/[\\/]/.test(trimmed) &&
          /^[A-Za-z0-9_-]+$/.test(trimmed)
        );
      }
    }
  })();

  const errorMessage =
    (createMut.error instanceof Error
      ? createMut.error.message
      : createMut.error
        ? String(createMut.error)
        : null) ??
    (setCred.error instanceof Error
      ? setCred.error.message
      : setCred.error
        ? String(setCred.error)
        : null);

  const testIsPending = testCred.isPending;
  const testFailed = testCred.data && !testCred.data.success;

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
            {hasConfiguredProvider
              ? "You already have a configured provider — just name your first Principal."
              : "Let’s set up your first AI assistant. Four quick steps."}
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
            providers={providerItems}
            loading={providersLoading}
            selected={providerId}
            onSelect={setProviderId}
          />
        )}
        {step === 2 && (
          <Step2
            providerId={providerId}
            providerName={
              providerItems.find((p) => p.id === providerId)?.displayName ?? ""
            }
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            hasExistingKey={credential?.hasKey ?? false}
          />
        )}
        {step === 3 && (
          <Step3
            providerId={providerId}
            testCred={testCred}
            onTest={() => providerId && testCred.mutate(providerId)}
            isPending={testIsPending}
            failed={testFailed ?? false}
          />
        )}
        {step === 4 && (
          <Step4
            name={principalName}
            onNameChange={setPrincipalName}
            description={principalDescription}
            onDescriptionChange={setPrincipalDescription}
            providerLabel={
              hasConfiguredProvider && providerId
                ? providerItems.find((p) => p.id === providerId)?.displayName ??
                  providerId
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
            disabled={!canAdvance || (step === 4 && createMut.isPending)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {step === 4 && createMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : step === 4 ? (
              <Bot className="h-3.5 w-3.5" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            {step === 4 ? "Create" : step === 3 ? "Continue" : "Next"}
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
  providers,
  loading,
  selected,
  onSelect,
}: {
  providers: { id: string; displayName: string }[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
        Pick the model provider you want to use. You can change this later in
        Settings.
      </p>
      <div className="flex flex-wrap gap-2">
        {providers.length === 0 && !loading && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            No providers available. Skip and add one later in Settings →
            Credentials.
          </span>
        )}
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              selected === p.id
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            {p.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}

function Step2({
  providerId,
  providerName,
  apiKey,
  onApiKeyChange,
  hasExistingKey,
}: {
  providerId: string | null;
  providerName: string;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  hasExistingKey: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Paste your API key for{" "}
        <span className="font-semibold">{providerName || providerId}</span>.
        The key is stored in the OS keychain by the runtime.
      </p>
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          <Key className="h-3.5 w-3.5" />
          API Key / Token
        </label>
        <input
          autoFocus
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={hasExistingKey ? "•••••••• (leave blank to keep)" : "sk-..."}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
        {hasExistingKey && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            A key is already set for this provider. Enter a new one to replace
            it; blank keeps the existing key.
          </p>
        )}
      </div>
    </div>
  );
}

function Step3({
  providerId,
  testCred,
  onTest,
  isPending,
  failed,
}: {
  providerId: string | null;
  testCred: { data?: { success: boolean; message?: string } | undefined };
  onTest: () => void;
  isPending: boolean;
  failed: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Verify the connection before creating a Principal.
      </p>
      <button
        type="button"
        onClick={onTest}
        disabled={!providerId || isPending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <TestTube className="h-3.5 w-3.5" />
        )}
        Test connection
      </button>
      {testCred.data?.success && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          <Check className="h-3.5 w-3.5" />
          Connection successful. You&apos;re ready to create a Principal.
        </div>
      )}
      {failed && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
        >
          {testCred.data?.message ?? "Connection failed."} Try again or skip and
          check Settings → Credentials.
        </div>
      )}
    </div>
  );
}

function Step4({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  providerLabel,
}: {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  /** When non-null, rendered as a "Provider ready" badge above the
   *  name input. The walkthrough passes the configured provider when
   *  one was found in the keychain, so the user sees "sticking with
   *  X" instead of a generic "pick one." */
  providerLabel: string | null;
}) {
  const trimmed = name.trim();
  const nameValid =
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    !trimmed.startsWith("-") &&
    !trimmed.endsWith("-") &&
    !/[\\/]/.test(trimmed) &&
    /^[A-Za-z0-9_-]+$/.test(trimmed);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Name your first Principal. It&apos;s the identity you&apos;ll chat with.
      </p>
      {providerLabel && (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          <Check className="h-3 w-3" />
          Provider ready: {providerLabel}
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
            leading/trailing hyphen or path separators.
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

