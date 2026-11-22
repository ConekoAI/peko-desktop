import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useAddModel, useModels } from "../../hooks/useModels";
import { chatgptSignInCancel, chatgptSignInStart, chatgptSignInStatus } from "../../lib/api";
import type { PlanModel, PlanSignInState } from "../../types";

/** Where models on a ChatGPT plan are served (runtime ADR-115). */
export const PLAN_BASE_URL = "https://api.openai.com/v1";
/** The shape of the address a browser ends on (not prose: no translation). */
const PASTE_EXAMPLE = "http://127.0.0.1:…/auth/callback?code=…";
/** How often a waiting sign-in is asked about, in ms. */
const POLL_MS = 1500;

type Phase =
  | { kind: "starting" }
  | { kind: "waiting"; flowId: string; url: string }
  | { kind: "done"; credentialId: string; account: string; models: PlanModel[] }
  | { kind: "failed"; message: string };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Use a ChatGPT plan for OpenAI models instead of an API key (runtime
 * ADR-115). The engine runs the sign-in and stores it in its vault; this
 * dialog opens OpenAI's page in the browser, waits for the sign-in (or
 * takes the address a browser on another computer ended on), then lists
 * the plan's models so the person adds the ones their pekos should use.
 */
export default function ChatgptPlanModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: models } = useModels();
  const addMut = useAddModel();
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [pasted, setPasted] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const flowRef = useRef<string | null>(null);

  // Start a sign-in when the dialog opens (and on "Try again").
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPhase({ kind: "starting" });
    setPasted("");
    addMut.reset();
    chatgptSignInStart()
      .then(({ flowId, url }) => {
        if (!live) {
          void chatgptSignInCancel(flowId);
          return;
        }
        flowRef.current = flowId;
        setPhase({ kind: "waiting", flowId, url });
        void openUrl(url).catch(() => {});
      })
      .catch((e) => live && setPhase({ kind: "failed", message: errorText(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  // Ask how the sign-in is going while it waits.
  const waitingFlow = phase.kind === "waiting" ? phase.flowId : null;
  useEffect(() => {
    if (!waitingFlow) return;
    const timer = setInterval(() => {
      void chatgptSignInStatus(waitingFlow)
        .then((state) => settle(waitingFlow, state))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingFlow]);

  function settle(flowId: string, state: PlanSignInState) {
    if (flowRef.current !== flowId) return;
    if (state.state === "done") {
      flowRef.current = null;
      setPhase({
        kind: "done",
        credentialId: state.credentialId,
        account: state.account,
        models: state.models,
      });
    } else if (state.state === "failed") {
      flowRef.current = null;
      setPhase({ kind: "failed", message: state.message });
    } else if (state.state === "gone") {
      flowRef.current = null;
      setPhase({ kind: "failed", message: t("models.plan.gone") });
    }
  }

  function close() {
    if (flowRef.current) {
      void chatgptSignInCancel(flowRef.current);
      flowRef.current = null;
    }
    onClose();
  }

  function usePasted() {
    if (phase.kind !== "waiting" || !pasted.trim()) return;
    const flowId = phase.flowId;
    void chatgptSignInStatus(flowId, pasted.trim())
      .then((state) => settle(flowId, state))
      .catch((e) => setPhase({ kind: "failed", message: errorText(e) }));
  }

  function addModel(model: PlanModel, credentialId: string) {
    setAdding(model.slug);
    // Named after the model itself; `-plan` only when that name is taken
    // (an API-key model of the same name, say). The card's badge says it
    // runs on the plan.
    const taken = (models ?? []).some((m) => m.id === model.slug);
    addMut.mutate(
      {
        custom: true,
        name: taken ? `${model.slug}-plan` : model.slug,
        displayName: model.displayName,
        apiFormat: "responses",
        baseUrl: PLAN_BASE_URL,
        model: [model.slug],
        requiresKey: true,
        credentialId,
      },
      { onSettled: () => setAdding(null) },
    );
  }

  if (!open) return null;

  const addError =
    addMut.error instanceof Error ? addMut.error.message : addMut.error ? String(addMut.error) : null;
  const addedAs = (slug: string, credentialId: string) =>
    (models ?? []).find((m) => m.credentialId === credentialId && m.modelId === slug);

  return (
    <div className="modal-backdrop">
      <div
        className="modal-panel flex max-h-[90vh] w-full max-w-lg flex-col"
        data-testid="chatgpt-plan-modal"
      >
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-text" />
            <h2 className="modal-title">{t("models.plan.title")}</h2>
          </div>
          <button onClick={close} aria-label={t("common.close")} className="btn-icon -mr-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {phase.kind === "starting" && (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("models.plan.starting")}
            </p>
          )}

          {phase.kind === "waiting" && (
            <>
              <p className="text-sm text-fg-soft">{t("models.plan.waitingIntro")}</p>
              <p
                className="flex items-center gap-2 text-xs text-fg-muted"
                data-testid="chatgpt-plan-waiting"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("models.plan.waiting")}
              </p>
              <button
                type="button"
                onClick={() => void openUrl(phase.url).catch(() => {})}
                className="btn-secondary btn-sm"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("models.plan.openAgain")}
              </button>
              <div>
                <label htmlFor="chatgpt-plan-pasted" className="field-label mb-1.5 block">
                  {t("models.plan.pasteLabel")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="chatgpt-plan-pasted"
                    className="input font-mono text-xs"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={PASTE_EXAMPLE}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={usePasted}
                    disabled={!pasted.trim()}
                    className="btn-secondary btn-sm shrink-0"
                  >
                    {t("models.plan.usePasted")}
                  </button>
                </div>
                <p className="field-hint mt-1">{t("models.plan.pasteHint")}</p>
              </div>
            </>
          )}

          {phase.kind === "done" && (
            <>
              <p className="flex items-center gap-2 text-sm text-fg-soft" data-testid="chatgpt-plan-done">
                <Check className="h-4 w-4 text-ok" />
                {t("models.plan.signedIn", { account: phase.account })}
              </p>
              {phase.models.length > 0 ? (
                <>
                  <p className="text-xs text-fg-muted">{t("models.plan.pickModels")}</p>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {phase.models.map((m) => {
                      const existing = addedAs(m.slug, phase.credentialId);
                      return (
                        <li key={m.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-fg">{m.displayName}</p>
                            <p className="truncate font-mono text-[11px] text-fg-muted">{m.slug}</p>
                          </div>
                          {existing ? (
                            <span
                              className="flex min-w-0 items-center gap-1 text-xs text-ok"
                              data-testid={`chatgpt-plan-added-${m.slug}`}
                            >
                              <Check className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">
                                {t("models.plan.addedAs", { name: existing.displayName || existing.id })}
                              </span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addModel(m, phase.credentialId)}
                              disabled={adding !== null}
                              data-testid={`chatgpt-plan-add-${m.slug}`}
                              className="btn-secondary btn-sm shrink-0"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {adding === m.slug ? t("models.add.adding") : t("common.add")}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-fg-muted">{t("models.plan.noModels")}</p>
              )}
              <p className="field-hint">{t("models.plan.limits")}</p>
              {addError && <div className="note-danger text-xs">{addError}</div>}
            </>
          )}

          {phase.kind === "failed" && (
            <div className="note-danger text-xs" data-testid="chatgpt-plan-failed">
              {phase.message}
            </div>
          )}
        </div>

        <div className="modal-footer shrink-0">
          {phase.kind === "failed" && (
            <button onClick={() => setAttempt((n) => n + 1)} className="btn-secondary">
              {t("models.plan.tryAgain")}
            </button>
          )}
          <button onClick={close} className={phase.kind === "done" ? "btn-primary" : "btn-secondary"}>
            {phase.kind === "done" ? t("common.done") : t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
