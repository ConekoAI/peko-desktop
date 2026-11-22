import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUndoTurn } from "../../hooks/usePrincipals";
import type { TurnChanges as Turn, UndoResult } from "../../types";

/** A turn older than this is not offered above the composer. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * The newest turn in this conversation that changed files (runtime
 * ADR-117): what it changed, and Undo, which puts each file back where it
 * is still as the turn left it.
 */
export default function TurnChangesStrip({
  peko,
  turns,
  now = Date.now(),
}: {
  peko: string;
  turns: Turn[];
  now?: number;
}) {
  const { t } = useTranslation();
  const undo = useUndoTurn();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<UndoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!result && !error) return;
    const id = window.setTimeout(() => {
      setResult(null);
      setError(null);
    }, 10000);
    return () => window.clearTimeout(id);
  }, [result, error]);

  const turn = turns.find(
    (x) =>
      !x.undoneAt &&
      x.files.length > 0 &&
      !dismissed.has(x.turn) &&
      now - Date.parse(x.updatedAt) < RECENT_MS,
  );

  async function undoTurn(id: string) {
    setError(null);
    try {
      setResult(await undo.mutateAsync({ name: peko, turn: id }));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!turn && !result && !error) return null;
  return (
    <div className="border-t border-line bg-surface px-4 pt-3" data-testid="turn-changes">
      {turn && (
        <div className="rounded-xl border border-line bg-surface-raised px-3.5 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-fg-soft hover:text-fg"
              aria-expanded={open}
            >
              {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="truncate">{t("chat.changes.summary", { peko, count: turn.files.length })}</span>
            </button>
            <button
              type="button"
              onClick={() => void undoTurn(turn.turn)}
              disabled={undo.isPending}
              className="btn-secondary btn-sm shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("chat.changes.undo")}
            </button>
            <button
              type="button"
              onClick={() => setDismissed((d) => new Set(d).add(turn.turn))}
              aria-label={t("chat.changes.dismiss")}
              className="btn-icon shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {open && (
            <ul className="mt-2 space-y-0.5 pl-6" data-testid="turn-changes-files">
              {turn.files.map((f) => (
                <li key={f.path} className="flex gap-2 text-xs">
                  <span className="w-16 shrink-0 text-fg-muted">{t(`chat.changes.kind.${f.change}`)}</span>
                  <span className="truncate font-mono text-fg">{f.path}</span>
                </li>
              ))}
            </ul>
          )}
          {open && turn.shell && <p className="field-hint mt-1.5 pl-6">{t("chat.changes.shell")}</p>}
        </div>
      )}
      {result && (
        <div className="mt-2 text-xs text-fg-muted" data-testid="turn-changes-result">
          <p>{t("chat.changes.restored", { count: result.restored.length })}</p>
          {result.skipped.map((s) => (
            <p key={s.path}>
              {t("chat.changes.skipped", { path: s.path, why: s.why })}
            </p>
          ))}
        </div>
      )}
      {error && <div className="note-danger mt-2 text-xs">{error}</div>}
    </div>
  );
}
