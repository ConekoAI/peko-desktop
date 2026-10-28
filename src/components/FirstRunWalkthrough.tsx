import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

import { usePrincipals } from "../hooks/usePrincipals";
import { useAddModel, useModels, useTestModel } from "../hooks/useModels";
import NewPekoForm, { PrimaryButton } from "./peko/NewPekoForm";
import EndpointForm, {
  EMPTY_ENDPOINT,
  endpointArgs,
  isEndpointValid,
  type EndpointDraft,
} from "./models/EndpointForm";

/**
 * First-run onboarding: from a fresh install to talking with a peko in
 * three steps.
 *
 *   1. Connect a model — the endpoint from the provider's docs (base
 *      URL, API format, model id, key; ADR-068 has no vendor presets),
 *      or, with models already set up, pick one. The model is added and
 *      tested; its name and keyless/stored-credential options sit under
 *      "Advanced".
 *   2. Name your peko — a name and an avatar; the description and the
 *      model it uses sit under "Advanced". Creating it runs the runtime's
 *      genesis turn, which can take a minute.
 *   3. Say hello — the first message, sent from the chat so the reply
 *      streams there (`/chat/<name>?say=…`).
 *
 * It shows on a profile with no pekos unless dismissed before
 * (`localStorage[ONBOARDING_KEY] === "1"`); Skip dismisses it. Settings →
 * About → "Replay onboarding" dispatches REPLAY_EVENT to show it again.
 * PekoHub sign-in is not part of first run; it lives in the profile menu.
 */
export const ONBOARDING_KEY = "peko.onboarding.seen";
export const REPLAY_EVENT = "peko:replay-onboarding";

type Step = 1 | 2 | 3;

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Connect a model" },
  { id: 2, label: "Name your peko" },
  { id: 3, label: "Say hello" },
];

/** Names offered by default, first free one wins. */
const FIRST_MESSAGES = [
  "Hi! What can you help me with?",
  "Remind me to stretch in 30 minutes.",
  "Help me plan my week.",
];

export default function FirstRunWalkthrough() {
  const { data: principals, isLoading: principalsLoading } = usePrincipals();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (principalsLoading || dismissed) return;
    if (localStorage.getItem(ONBOARDING_KEY) === "1") return;
    if (!principals || principals.length > 0) return;
    setVisible(true);
  }, [principals, principalsLoading, dismissed]);

  // Settings → About → "Replay onboarding".
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handle() {
      setDismissed(false);
      setVisible(true);
    }
    window.addEventListener(REPLAY_EVENT, handle);
    return () => window.removeEventListener(REPLAY_EVENT, handle);
  }, []);

  function close() {
    if (typeof window !== "undefined") localStorage.setItem(ONBOARDING_KEY, "1");
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
      <Onboarding onClose={close} takenNames={(principals ?? []).map((p) => p.name)} />
    </div>
  );
}

function Onboarding({ onClose, takenNames }: { onClose: () => void; takenNames: string[] }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [modelId, setModelId] = useState<string | null>(null);
  const [pekoName, setPekoName] = useState<string | null>(null);

  function finish(firstMessage: string | null) {
    onClose();
    if (!pekoName) return;
    navigate({
      to: "/chat/$pekoName",
      params: { pekoName },
      search: firstMessage ? { say: firstMessage } : {},
    });
  }

  return (
    <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-card shadow-2xl">
      <div className="flex items-start justify-between px-6 pt-5">
        <div>
          <p className="text-xs font-medium text-brand">Welcome to Peko</p>
          <h2 id="first-run-walkthrough-title" className="mt-0.5 text-lg font-semibold text-fg">
            {STEPS[step - 1].label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-sunken hover:text-fg-soft"
        >
          Skip
        </button>
      </div>

      <ol className="flex gap-2 px-6 pt-3" aria-label="Onboarding progress">
        {STEPS.map((s) => (
          <li
            key={s.id}
            data-testid={`onboarding-step-${s.id}`}
            aria-current={s.id === step ? "step" : undefined}
            className={[
              "h-1 flex-1 rounded-full",
              s.id <= step ? "bg-brand" : "bg-surface-sunken",
            ].join(" ")}
          />
        ))}
      </ol>

      <div className="overflow-y-auto px-6 py-5">
        {step === 1 && (
          <ModelStep
            onNext={(id) => {
              setModelId(id);
              setStep(2);
            }}
          />
        )}
        {step === 2 && modelId && (
          <PekoStep
            modelId={modelId}
            takenNames={takenNames}
            onBack={() => setStep(1)}
            onNext={(name) => {
              setPekoName(name);
              setStep(3);
            }}
          />
        )}
        {step === 3 && pekoName && <HelloStep pekoName={pekoName} onFinish={finish} />}
      </div>
    </div>
  );
}

// ─── Step 1: connect a model ────────────────────────────────────────

function ModelStep({ onNext }: { onNext: (modelId: string) => void }) {
  const { data: models, isLoading: modelsLoading } = useModels();
  const enabled = useMemo(() => (models ?? []).filter((m) => m.enabled), [models]);
  const [addingNew, setAddingNew] = useState(false);
  const [existing, setExisting] = useState<string>("");

  useEffect(() => {
    if (!existing && enabled.length > 0) setExisting(enabled[0].id);
  }, [enabled, existing]);

  if (modelsLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />;
  }

  if (enabled.length > 0 && !addingNew) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          A model is a peko&apos;s mind. You already have some — pick the one your first peko will
          use.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Model</span>
          <select
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          >
            {enabled.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName || m.id}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="text-xs text-fg-muted hover:text-fg-soft"
          >
            Add another model instead
          </button>
          <PrimaryButton onClick={() => onNext(existing)} disabled={!existing}>
            Continue <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return <AddModel onAdded={onNext} />;
}

/**
 * The endpoint from your provider's docs — base URL, API format, model
 * id, key (ADR-068: no vendor presets). The model is added and tested;
 * a failed test shows the provider's message and can be passed.
 */
function AddModel({ onAdded }: { onAdded: (modelId: string) => void }) {
  const addMut = useAddModel();
  const testMut = useTestModel();
  const [draft, setDraft] = useState<EndpointDraft>(EMPTY_ENDPOINT);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const busy = addMut.isPending || testMut.isPending;
  const ready = isEndpointValid(draft) && !busy;

  async function connect() {
    setTestError(null);
    try {
      const info = await addMut.mutateAsync(endpointArgs(draft));
      setAddedId(info.id);
      const result = await testMut.mutateAsync(info.id);
      if (result.ok) onAdded(info.id);
      else setTestError(result.message || "The model did not answer.");
    } catch {
      // `addMut.error` / `testMut.error` render below.
    }
  }

  const failure = addMut.error ?? testMut.error;
  const failureText =
    failure instanceof Error ? failure.message : failure ? String(failure) : testError;

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        A model is a peko&apos;s mind. Enter the endpoint from your provider&apos;s docs — most
        say &quot;OpenAI-compatible&quot;, which is Chat Completions.
      </p>

      <EndpointForm
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setTestError(null);
        }}
        disabled={busy}
      />

      {failureText && (
        <div
          data-testid="onboarding-model-error"
          className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          <p className="font-medium">Couldn&apos;t reach the model.</p>
          <p className="mt-0.5 break-words">{failureText}</p>
          {addedId && (
            <button type="button" onClick={() => onAdded(addedId)} className="mt-1 underline">
              Continue anyway
            </button>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <PrimaryButton onClick={connect} disabled={!ready}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {addMut.isPending ? "Adding…" : "Checking…"}
            </>
          ) : (
            <>
              Connect <ArrowRight className="h-4 w-4" />
            </>
          )}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Step 2: name and avatar ────────────────────────────────────────

function PekoStep({
  modelId,
  takenNames,
  onBack,
  onNext,
}: {
  modelId: string;
  takenNames: string[];
  onBack: () => void;
  onNext: (name: string) => void;
}) {
  return (
    <NewPekoForm
      modelId={modelId}
      takenNames={takenNames}
      onCreated={onNext}
      secondary={
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg-soft"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      }
    />
  );
}

// ─── Step 3: say hello ──────────────────────────────────────────────

function HelloStep({
  pekoName,
  onFinish,
}: {
  pekoName: string;
  onFinish: (firstMessage: string | null) => void;
}) {
  const [text, setText] = useState(FIRST_MESSAGES[0]);
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-fg-muted">
        <Check className="h-4 w-4 text-brand" />
        {pekoName} is awake. What would you like to say first?
      </p>
      <textarea
        aria-label="First message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
      />
      <div className="flex flex-wrap gap-1.5">
        {FIRST_MESSAGES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setText(m)}
            className="rounded-full border border-line px-3 py-1 text-xs text-fg-soft hover:bg-surface-sunken"
          >
            {m}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onFinish(null)}
          className="text-xs text-fg-muted hover:text-fg-soft"
        >
          Go to the chat without a message
        </button>
        <PrimaryButton onClick={() => onFinish(text.trim())} disabled={!text.trim()}>
          Send <ArrowRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────
