import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLocalPerson, useSetPersonName } from "../hooks/usePrincipals";

/** The longest name, in characters (runtime and PekoHub limit). */
const NAME_MAX = 64;

/**
 * What you are called in conversations (runtime ADR-124). Signed in to
 * PekoHub, the name is your account's, so your other computers and the
 * people you talk with follow it; your @handle stays as it is. Before
 * signing in it stays on this computer.
 */
export default function YourNameSetting({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { data: person } = useLocalPerson();
  const setName = useSetPersonName();
  const current = person?.name ?? "";
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);

  const trimmed = draft.trim().replace(/\s+/g, " ");
  const changed = trimmed !== "" && trimmed !== current;

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed) return;
    setName.mutate(trimmed);
  }

  return (
    <form className={className} onSubmit={save} data-testid="your-name-setting">
      <label htmlFor="settings-your-name">
        <span className="h-section flex items-center gap-1.5">
          <UserRound className="h-4 w-4 text-brand-text" />
          {t("settings.yourName.title")}
        </span>
        <span className="field-hint mt-0.5 block">
          {person?.handle
            ? t("settings.yourName.hintSignedIn", { handle: person.handle })
            : t("settings.yourName.hintSignedOut")}
        </span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <input
          id="settings-your-name"
          type="text"
          value={draft}
          maxLength={NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("settings.yourName.placeholder")}
          autoComplete="name"
          className="input input-sm flex-1"
          data-testid="your-name-input"
        />
        <button
          type="submit"
          disabled={!changed || setName.isPending}
          className="btn-primary btn-sm"
          data-testid="your-name-save"
        >
          {setName.isPending ? t("settings.yourName.saving") : t("common.save")}
        </button>
      </div>
      {setName.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {setName.error instanceof Error ? setName.error.message : String(setName.error)}
        </p>
      )}
    </form>
  );
}
