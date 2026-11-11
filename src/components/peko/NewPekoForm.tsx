import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
  // A seed (ADR-060) to grow from: a `.seed.toml` downloaded from PekoHub.
  const [seed, setSeed] = useState<{ fileName: string; text: string } | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const model = chosenModel || enabledModels[0]?.id || "";

  const trimmed = name.trim();
  const nameOk = isValidPrincipalName(trimmed) && !takenNames.includes(trimmed);
  const busy = createMut.isPending || updateMut.isPending;

  async function chooseSeed(file: File | undefined) {
    setSeedError(null);
    if (!file) return;
    if (file.size > 64 * 1024) {
      setSeedError(t("peko.new.seedTooBig"));
      return;
    }
    const text = await file.text();
    if (!/^\s*name\s*=/m.test(text)) {
      setSeedError(t("peko.new.seedInvalid"));
      return;
    }
    setSeed({ fileName: file.name, text });
    setAdvanced(true);
  }

  async function create() {
    try {
      await createMut.mutateAsync({
        name: trimmed,
        modelId: model,
        ...(description.trim() && { description: description.trim() }),
        ...(seed && { seed: seed.text }),
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
        <p className="note-warn text-xs" data-testid="new-peko-no-model">
          {t("peko.new.noModel")}
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
          <span className="field-label mb-1.5 block">{t("common.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={trimmed.length > 0 && !nameOk}
            className="input"
          />
          {trimmed.length > 0 && !nameOk && (
            <span className="mt-1 block text-[11px] text-danger">
              {takenNames.includes(trimmed)
                ? t("peko.new.nameTaken")
                : t("peko.new.nameInvalid")}
            </span>
          )}
        </label>
      </div>

      <div>
        <span className="field-label mb-1.5 block">{t("peko.new.avatar")}</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("peko.new.avatar")}>
          {AVATAR_SUGGESTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={busy}
              onClick={() => setAvatar(emoji)}
              aria-label={t("peko.new.useAvatar", { emoji })}
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

      <Disclosure open={advanced} onToggle={() => setAdvanced((a) => !a)} label={t("common.advanced")}>
        <div>
          <span className="field-label mb-1.5 block">{t("peko.new.seedLabel")}</span>
          {seed ? (
            <div className="flex items-center justify-between rounded-lg border border-line bg-surface-sunken px-3 py-2 text-xs">
              <span className="truncate font-mono text-fg-soft" data-testid="new-peko-seed">
                {seed.fileName}
              </span>
              <button
                type="button"
                onClick={() => setSeed(null)}
                className="ml-2 text-fg-subtle hover:text-fg-soft"
              >
                {t("common.remove")}
              </button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-muted hover:border-brand hover:text-fg-soft">
              {t("peko.new.chooseSeed")}
              <input
                type="file"
                accept=".toml,text/plain,application/toml"
                className="sr-only"
                aria-label={t("peko.new.seedFile")}
                onChange={(e) => void chooseSeed(e.target.files?.[0])}
              />
            </label>
          )}
          <span className="mt-1 block text-[11px] text-fg-subtle">
            {t("peko.new.seedHint")}
          </span>
          {seedError && <span className="mt-1 block text-[11px] text-danger">{seedError}</span>}
        </div>
        <label className="block">
          <span className="field-label mb-1.5 block">{t("common.description")}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder={t("peko.new.descriptionPlaceholder")}
            className="input"
          />
        </label>
        {enabledModels.length > 1 && (
          <label className="block">
            <span className="field-label mb-1.5 block">{t("common.model")}</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="select"
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
        <div className="note-danger text-xs" data-testid="onboarding-create-error">
          {failureText}
        </div>
      )}

      <div className="flex items-center justify-between">
        {secondary ?? <span />}
        <PrimaryButton onClick={create} disabled={!nameOk || !model || busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("peko.new.waking", { name: trimmed })}
            </>
          ) : (
            <>
              {t("peko.new.create", { name: trimmed || t("peko.new.fallbackName") })} <ArrowRight className="h-4 w-4" />
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
      className="btn-primary"
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
