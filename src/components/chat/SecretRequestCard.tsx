import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { useAnswerSecret } from "../../hooks/usePrincipals";
import type { SecretRequest } from "../../types";

/**
 * The secrets a peko asked you for (runtime ADR-116): you type the value
 * here and it goes to this computer's vault. Neither the conversation nor
 * the peko sees it; the peko is told it was saved.
 */
export default function SecretRequestCards({
  peko,
  requests,
}: {
  peko: string;
  requests: SecretRequest[];
}) {
  const { t } = useTranslation();
  const answer = useAnswerSecret();
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const id = window.setTimeout(() => setOutcome(null), 6000);
    return () => window.clearTimeout(id);
  }, [outcome]);

  async function act(request: SecretRequest, decline: boolean) {
    const value = values[request.id] ?? "";
    if (!decline && !value.trim()) return;
    try {
      setOutcome(
        await answer.mutateAsync({ name: peko, id: request.id, value: decline ? undefined : value, decline }),
      );
      // The value is not kept once it has been handed over.
      setValues((v) => ({ ...v, [request.id]: "" }));
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : String(err));
    }
  }

  if (requests.length === 0 && !outcome) return null;
  return (
    <div className="space-y-2 border-t border-line bg-surface px-4 pt-3" data-testid="secret-cards">
      {requests.map((r) => {
        const [server, slot] = r.kind === "mcp" ? r.secret.split("/") : [null, r.secret];
        const value = values[r.id] ?? "";
        const fieldId = `secret-${r.id}`;
        return (
          <form
            key={r.id}
            className="rounded-xl border border-brand/25 bg-brand-soft p-3.5 text-sm"
            data-testid={`secret-card-${r.id}`}
            onSubmit={(e) => {
              e.preventDefault();
              void act(r, false);
            }}
          >
            <p className="flex items-start gap-2 text-fg">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" />
              <span>
                <Trans
                  i18nKey={server ? "chat.secret.mcpRequest" : "chat.secret.request"}
                  values={{ peko }}
                  components={{
                    name: <span className="font-mono text-xs font-medium">{slot}</span>,
                    server: <span className="font-mono text-xs">{server}</span>,
                  }}
                />
              </span>
            </p>
            {r.why && <p className="mt-1 pl-6 text-xs text-fg-muted">{r.why}</p>}
            <label htmlFor={fieldId} className="sr-only">
              {t("chat.secret.label", { name: slot })}
            </label>
            <div className="mt-2 flex gap-2 pl-6">
              <div className="relative min-w-0 flex-1">
                <input
                  id={fieldId}
                  type={shown[r.id] ? "text" : "password"}
                  className="input pr-9 font-mono text-xs"
                  value={value}
                  onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                  placeholder={t("chat.secret.placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid={`secret-input-${r.id}`}
                />
                <button
                  type="button"
                  onClick={() => setShown((s) => ({ ...s, [r.id]: !s[r.id] }))}
                  aria-label={shown[r.id] ? t("chat.secret.hide") : t("chat.secret.show")}
                  className="btn-icon absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {shown[r.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={answer.isPending || !value.trim()}
                className="btn-primary btn-sm shrink-0"
              >
                {t("chat.secret.save")}
              </button>
              <button
                type="button"
                disabled={answer.isPending}
                onClick={() => void act(r, true)}
                className="btn-secondary btn-sm shrink-0"
              >
                {t("chat.secret.decline")}
              </button>
            </div>
            <p className="field-hint mt-1.5 pl-6">{t("chat.secret.hint", { peko })}</p>
          </form>
        );
      })}
      {outcome && <p className="text-xs text-fg-muted">{outcome}</p>}
    </div>
  );
}
