import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
  Link as LinkIcon,
  Compass,
  User,
  Plus,
} from "lucide-react";

import { usePrincipals, usePrincipalCreate } from "../hooks/usePrincipals";
import { useModels } from "../hooks/useModels";
import {
  usePekohubBundle,
  runOAuthFlow,
} from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";
import { isValidPrincipalName } from "../lib/validatePrincipalName";
import CreatePrincipalModal from "./modals/CreatePrincipalModal";
import AddRemotePrincipalModal from "./modals/AddRemotePrincipalModal";

/**
 * First-run walkthrough overlay (T-105 Phase D, model-first; PR #10
 * adds steps 3 + 4 for the social/remote model).
 *
 * Closes the desktop's "drop to CLI" dead end on a fresh profile.
 * Auto-appears when there are zero principals AND the user hasn't
 * dismissed it before (`localStorage["peko.onboarding.seen"] !== "1"`).
 *
 * Four steps:
 *   1. pick-model — choose from the runtime's configured models
 *   2. create-principal — name + optional description → usePrincipalCreate
 *   3. connect-hub — optional PekoHub OAuth sign-in. Skip transitions
 *      to step 4 (the user can use the desktop fully local-only).
 *   4. add-remote — landing card with three follow-up actions:
 *        - open CreatePrincipalModal (add another local principal)
 *        - open AddRemotePrincipalModal (paste a hub share link)
 *        - navigate to /discover (browse the public directory)
 *      "Done" dismisses the walkthrough.
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

type Step = 1 | 2 | 3 | 4;

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Pick model" },
  { id: 2, label: "Create principal" },
  // PR #10: PekoHub OAuth is OPTIONAL. Users without an account
  // (or who want to keep their runtimes local-only) just hit Skip.
  { id: 3, label: "Connect to PekoHub" },
  // PR #10: step 4 is the social follow-up — once a local
  // principal exists (step 2) and PekoHub is optionally linked
  // (step 3), step 4 surfaces the three ways to add more: a
  // local create modal, a remote share-link paste, or the public
  // discover feed. The "Done" button closes the overlay.
  { id: 4, label: "Add your first principal" },
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
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [modelId, setModelId] = useState<string | null>(null);
  const [principalName, setPrincipalName] = useState("");
  const [principalDescription, setPrincipalDescription] = useState("");
  // PR #10: step 3 mounts an in-card OAuth button. The actual flow
  // delegates to runOAuthFlow (PR #9 + existing ProfileMenu pattern).
  const [signingIn, setSigningIn] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // PR #10: step 4 owns two follow-up modals. They're local to the
  // walkthrough so the overlay stays the single source of truth for
  // the onboarding lifecycle — no need to thread open state into the
  // sidebar or AppRail.
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddRemoteModal, setShowAddRemoteModal] = useState(false);

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

  // PR #10: peek at the OAuth bundle + pekohub base URL the same way
  // ProfileMenu does. The "You're already signed in" copy in step 3
  // uses `signedIn` to skip the OAuth button and jump straight to
  // Next.
  const { data: settings } = useSettings();
  const { data: bundle, isPending: bundlePending } = usePekohubBundle();
  const pekohubBaseUrl =
    settings?.find((s) => s.key === "pekohub.base_url")?.value ??
    "https://pekohub.org";
  const oauthScope =
    settings?.find((s) => s.key === "pekohub.oauth_scope")?.value ??
    "runtimes:read";
  const signedIn = bundle !== null && bundle !== undefined && !bundlePending;

  async function handleConnectHub() {
    setOauthError(null);
    setSigningIn(true);
    try {
      const result = await runOAuthFlow({
        baseUrl: pekohubBaseUrl,
        scope: oauthScope,
      });
      if (result.added === 0) {
        setOauthError(
          "Signed in to PekoHub, but no runtimes were found for this account.",
        );
      }
    } catch (err) {
      setOauthError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Check your browser and try again.",
      );
    } finally {
      setSigningIn(false);
    }
  }

  function handleNext() {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      // PR #10: step 2 advances to step 3 instead of dismissing the
      // overlay. The pre-#10 contract was onSuccess -> onDismiss, but
      // that path short-circuits the social follow-ups (PekoHub OAuth
      // + add remote principal) and made them unreachable from the
      // walkthrough. The visibility effect that hid the overlay on
      // zero principals is unchanged — once the new principal lands
      // in the cache, the outer FirstRunWalkthrough still hides itself
      // if the user closes the overlay without advancing.
      createMut.mutate(
        {
          name: principalName.trim(),
          description: principalDescription.trim() || undefined,
          modelId: modelId ?? "",
        },
        {
          onSuccess: () => setStep(3),
        },
      );
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
    if (step === 4) {
      // "Done" — close the overlay. The follow-up modals (Create +
      // Add remote) each have their own open/close lifecycles.
      onDismiss();
      return;
    }
  }

  function handleBack() {
    if (step === 1) return;
    setStep((step - 1) as Step);
  }

  const canAdvance = (() => {
    switch (step) {
      case 1:
        return modelId !== null;
      case 2:
        return isValidPrincipalName(principalName);
      // Step 3 is skippable from the card itself, but the Next button
      // is always enabled so the user can advance past a successful
      // OAuth without re-clicking the in-card CTA.
      case 3:
        return true;
      case 4:
        return true;
    }
  })();

  const errorMessage =
    createMut.error instanceof Error
      ? createMut.error.message
      : createMut.error
        ? String(createMut.error)
        : null;

  // PR #10: step 4 deliberately does NOT auto-dismiss on principal
  // count changes. The user opens CreatePrincipalModal /
  // AddRemotePrincipalModal — those modals own their own lifecycle
  // and let the user click multiple times before "Done" closes the
  // walkthrough. Auto-dismissing the moment the cache refetches
  // would feel like the overlay vanished out from under the user.

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
        {step === 3 && (
          <Step3ConnectHub
            pekohubBaseUrl={pekohubBaseUrl}
            signingIn={signingIn}
            signedIn={signedIn}
            onConnect={handleConnectHub}
            onSkipToStep4={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <Step4AddPrincipal
            onCreateLocal={() => setShowCreateModal(true)}
            onAddRemote={() => setShowAddRemoteModal(true)}
            onBrowse={() => {
              // PR #10: leaving the walkthrough mid-flow lands the
              // user in the Discover SPA. The overlay closes via
              // onDismiss so it doesn't shadow the navigated view.
              onDismiss();
              navigate({ to: "/discover" });
            }}
          />
        )}

        {(errorMessage || oauthError) && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
          >
            {errorMessage || oauthError}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
        <button
          type="button"
          onClick={
            // PR #10: on step 3 the Skip button transitions to step
            // 4 instead of dismissing the whole overlay — that way
            // the user who declines PekoHub still sees the social
            // follow-ups (browse / paste a share link) without
            // having to re-open onboarding. Other steps keep the
            // original dismiss-on-skip behavior.
            step === 3 ? () => setStep(4) : onDismiss
          }
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          {step === 3 ? "Skip — go local-only" : "Skip for now"}
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
            {step === 2 ? "Create" : step === 4 ? "Done" : "Next"}
          </button>
        </div>
      </div>

      {/* PR #10: step-4 modals. They render at the same z-index
          as the walkthrough card so closing either modal returns
          the user to step 4 rather than to a blank viewport. */}
      <CreatePrincipalModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
      <AddRemotePrincipalModal
        open={showAddRemoteModal}
        onClose={() => setShowAddRemoteModal(false)}
      />
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
 * PR #10 step 3: optional PekoHub OAuth. Mirrors ProfileMenu's
 * sign-in copy + state machine, but inlined into the walkthrough
 * so the user doesn't have to leave the overlay and re-enter.
 *
 * If the user is already signed in (e.g. they replayed onboarding
 * after a successful sign-in), we render a "you're already
 * connected" badge and let them advance with Next.
 */
function Step3ConnectHub({
  pekohubBaseUrl,
  signingIn,
  signedIn,
  onConnect,
  onSkipToStep4,
}: {
  pekohubBaseUrl: string;
  signingIn: boolean;
  signedIn: boolean;
  onConnect: () => void;
  onSkipToStep4: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Sign in to PekoHub to publish your Principal, share it with a
        friend, or browse what other people have made. Optional — you
        can use the desktop fully local-only.
      </p>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
        Hub: <code className="font-mono">{pekohubBaseUrl}</code>
      </div>

      {signedIn ? (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Check className="h-3 w-3" />
          Already connected to PekoHub
        </div>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={signingIn}
          data-testid="onboarding-connect-hub"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {signingIn ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <User className="h-3.5 w-3.5" />
          )}
          {signingIn ? "Opening browser…" : "Sign in with PekoHub"}
        </button>
      )}

      <button
        type="button"
        onClick={onSkipToStep4}
        className="block text-[11px] text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
      >
        Skip — stay local-only
      </button>
    </div>
  );
}

/**
 * PR #10 step 4: social follow-up. Three action cards:
 *   - Create another local principal (opens CreatePrincipalModal)
 *   - Paste a share link from a friend (opens AddRemotePrincipalModal)
 *   - Browse the public directory (navigates to /discover)
 *
 * The Create + Add-remote actions render modals in-place (mounted
 * alongside the walkthrough card via the parent) so the user can
 * chain several actions before clicking Done. The Browse action
 * closes the overlay and navigates; the Discover SPA is its own
 * page so re-entering the walkthrough mid-flow would be jarring.
 */
function Step4AddPrincipal({
  onCreateLocal,
  onAddRemote,
  onBrowse,
}: {
  onCreateLocal: () => void;
  onAddRemote: () => void;
  onBrowse: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        You&apos;re all set. Add more principals, or browse what others have
        shared on PekoHub.
      </p>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={onCreateLocal}
          data-testid="onboarding-add-local"
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-emerald-950/30"
        >
          <span className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">Create another local Principal</span>
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            Local only
          </span>
        </button>

        <button
          type="button"
          onClick={onAddRemote}
          data-testid="onboarding-add-remote"
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-emerald-950/30"
        >
          <span className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <LinkIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">Paste a share link</span>
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            From a friend
          </span>
        </button>

        <button
          type="button"
          onClick={onBrowse}
          data-testid="onboarding-browse-discover"
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-emerald-500 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-emerald-950/30"
        >
          <span className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Compass className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">Browse public Principals</span>
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            PekoHub directory
          </span>
        </button>
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
