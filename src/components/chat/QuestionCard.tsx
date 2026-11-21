import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Send } from "lucide-react";
import type { Answers, Ask, Pick } from "../../types";
import { answersComplete, cleanPicks, renderAnswers } from "../../lib/questions";

/**
 * A peko's questions (runtime ADR-114), answered together. Each question
 * takes one choice (several when it says so) or your own words; Send
 * posts the answers as your message, its text reading them. The composer
 * stays free for anything else. Outlined and plain like suggested
 * replies, not the approval card: answering decides nothing.
 *
 * Closed (answered, replaced, or moved past), it shows the questions
 * with what was chosen and takes no input.
 */
export default function QuestionCard({
  ask,
  msgId,
  open,
  answered,
  forLabel,
  onSend,
}: {
  ask: Ask;
  /** The asking message's id; answers name it. */
  msgId?: string | null;
  /** Answerable now (see `lib/questions`). */
  open: boolean;
  /** The answers that name this card, shown on a closed one. */
  answered?: Answers;
  /** In a group: who the card is for, when it isn't you. */
  forLabel?: string;
  /** Absent when you may not answer (closed, or meant for someone else). */
  onSend?: (text: string, answers: Answers) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState<Pick[]>(() => ask.questions.map(() => ({})));
  const [sending, setSending] = useState(false);
  const active = open && !!onSend && !!msgId && !sending;
  const complete = answersComplete(picks, ask);

  function toggle(qi: number, option: string, multi: boolean) {
    setPicks((prev) =>
      prev.map((p, i) => {
        if (i !== qi) return p;
        const chosen = p.chosen ?? [];
        if (chosen.includes(option)) return { ...p, chosen: chosen.filter((c) => c !== option) };
        return { ...p, chosen: multi ? [...chosen, option] : [option] };
      }),
    );
  }

  function setOther(qi: number, other: string) {
    setPicks((prev) => prev.map((p, i) => (i === qi ? { ...p, other } : p)));
  }

  async function send() {
    if (!active || !complete || !msgId || !onSend) return;
    const answers: Answers = { to: msgId, picks: cleanPicks(picks) };
    setSending(true);
    try {
      await onSend(renderAnswers(ask, answers), answers);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={t("chat.questions.label")}
      data-testid="question-card"
      data-open={active ? "true" : "false"}
      className="mt-2 max-w-xl space-y-3 rounded-xl border border-line-strong bg-surface-card p-3"
    >
      {forLabel && (
        <p className="text-[11px] text-fg-subtle" data-testid="question-card-for">
          {t("chat.questions.for", { name: forLabel })}
        </p>
      )}
      {ask.questions.map((q, qi) => {
        const shown = active ? picks[qi] : answered?.picks[qi];
        const chosen = shown?.chosen ?? [];
        const options = q.options ?? [];
        return (
          <div key={qi} className="space-y-1.5">
            <p className="text-sm font-medium text-fg">
              {q.text}
              {q.multi && options.length > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">
                  {t("chat.questions.pickAny")}
                </span>
              )}
            </p>
            {options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {options.map((option) => {
                  const on = chosen.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={!active}
                      aria-pressed={on}
                      onClick={() => toggle(qi, option, !!q.multi)}
                      className={
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                        (on
                          ? "border-brand bg-brand-soft text-fg"
                          : "border-line-strong bg-surface-card text-fg-soft") +
                        (active ? " hover:border-fg-subtle/60 hover:text-fg" : " cursor-default opacity-70")
                      }
                    >
                      {on && <Check className="h-3 w-3" />}
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
            {active ? (
              <input
                type="text"
                value={picks[qi]?.other ?? ""}
                onChange={(e) => setOther(qi, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  options.length > 0 ? t("chat.questions.otherPlaceholder") : t("chat.questions.answerPlaceholder")
                }
                aria-label={t("chat.questions.otherLabel", { question: q.text })}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
              />
            ) : (
              shown?.other && <p className="text-xs text-fg-soft">{shown.other}</p>
            )}
          </div>
        );
      })}
      {active ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!complete}
            onClick={() => void send()}
            className="btn-primary btn-xs"
            data-testid="question-card-send"
          >
            <Send className="h-3 w-3" />
            {t("chat.questions.send")}
          </button>
        </div>
      ) : (
        answered && (
          <p className="text-[11px] text-fg-subtle" data-testid="question-card-answered">
            {t("chat.questions.answered")}
          </p>
        )
      )}
    </div>
  );
}
