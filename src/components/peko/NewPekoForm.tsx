import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, Loader2 } from "lucide-react";

import { usePrincipalCreate, usePrincipalUpdate } from "../../hooks/usePrincipals";
import { useModels } from "../../hooks/useModels";
import { isValidPrincipalName } from "../../lib/validatePrincipalName";
import { AVATAR_SUGGESTIONS, pekoIdentity } from "../../lib/pekoIdentity";
import PekoAvatar from "./PekoAvatar";

const NAME_IDEAS = ["nova", "pip", "sage", "juno", "miso", "atlas"];

/**
 * Create a peko: a name and an avatar up front; the description and
 * the model sit under "Advanced". The one form behind onboarding and
 * the sidebar's "New peko". Creating it runs the runtime's genesis
 * turn, which can take a minute.
 */
export default function NewPekoForm({
  modelId,
  takenNames,
  onCreated,
  secondary,
}: {
  /** The model to start with; else the first enabled one. */
  modelId?: string;
  takenNames: string[];
  onCreated: (name: string) => void;
  /** Left of the Create button: Back in onboarding, Cancel in the dialog. */
  secondary?: ReactNode;
}) {
  const { data: models } = useModels();
  const enabledModels = (models ?? []).filter((m) => m.enabled);
  const createMut = usePrincipalCreate();
  const updateMut = usePrincipalUpdate();
  const [name, setName] = useState(
    () => NAME_IDEAS.find((n) => !takenNames.includes(n)) ?? "",
  );
  const [avatar, setAvatar] = useState(AVATAR_SUGGESTIONS[0]);
  const [advanced, setAdvanced] = useState(false);
  const [description, setDescription] = useState("");
  const [chosenModel, setModel] = useState(modelId ?? "");
  const model = chosenModel || enabledModels[0]?.id || "";

  const trimmed = name.trim();
  const nameOk = isValidPrincipalName(trimmed) && !takenNames.includes(trimmed);
  const busy = createMut.isPending || updateMut.isPending;

  async function create() {
    try {
      await createMut.mutateAsync({
        name: trimmed,
        modelId: model,
        ...(description.trim() && { description: description.trim() }),
      });
      if (avatar) await updateMut.mutateAsync({ name: trimmed, avatar });
      onCreated(trimmed);
    } catch {
      // Rendered below.
    }
  }

  const failure = createMut.error ?? updateMut.error;
  const failureText = failure instanceof Error ? failure.message : failure ? String(failure) : null;

  if (models && !model) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn" data-testid="new-peko-no-model">
          A peko needs a model to think with. Add one in Settings → Models first.
        </p>
        {secondary && <div className="flex justify-end">{secondary}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <PekoAvatar peko={pekoIdentity({ name: trimmed || "?", avatar })} size="lg" />
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={trimmed.length > 0 && !nameOk}
            className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          {trimmed.length > 0 && !nameOk && (
            <span className="mt-1 block text-[11px] text-danger">
              {takenNames.includes(trimmed)
                ? "You already have a peko with this name."
                : "Use letters, numbers, - or _."}
            </span>
          )}
        </label>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-fg-muted">Avatar</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Avatar">
          {AVATAR_SUGGESTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={busy}
              onClick={() => setAvatar(emoji)}
              aria-label={`Use ${emoji}`}
              aria-pressed={avatar === emoji}
              className={[
                "flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors",
                avatar === emoji ? "bg-brand-soft ring-1 ring-brand" : "hover:bg-surface-sunken",
              ].join(" ")}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <Disclosure open={advanced} onToggle={() => setAdvanced((a) => !a)} label="Advanced">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What this peko is for (optional)"
            className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </label>
        {enabledModels.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-muted">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            >
              {enabledModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName || m.id}
                </option>
              ))}
            </select>
          </label>
        )}
      </Disclosure>

      {failureText && (
        <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" data-testid="onboarding-create-error">
          {failureText}
        </div>
      )}

      <div className="flex items-center justify-between">
        {secondary ?? <span />}
        <PrimaryButton onClick={create} disabled={!nameOk || !model || busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Waking up {trimmed}… this can take a minute
            </>
          ) : (
            <>
              Create {trimmed || "peko"} <ArrowRight className="h-4 w-4" />
            </>
          )}
        </PrimaryButton>
      </div>
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Disclosure({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg-soft"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      {open && <div className="mt-2 space-y-3 border-l-2 border-line pl-3">{children}</div>}
    </div>
  );
}
