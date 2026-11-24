import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { MousePointer2, Pause } from "lucide-react";
import { computerResume, computerStop } from "../lib/api";

/** What the native side reports (`computer::StripState`). */
export interface ComputerStripState {
  peko: string | null;
  action: string | null;
  paused: boolean;
}

/**
 * The strip a peko's use of this computer shows (runtime ADR-123 D5):
 * which peko, what it is doing, **Stop**, and when your mouse or keyboard
 * paused it, **Let it continue**. Its window is left out of screenshots,
 * so the peko never sees it.
 */
export default function ComputerStrip({ initial }: { initial?: ComputerStripState }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ComputerStripState | null>(initial ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = listen<ComputerStripState>("computer-state", (e) => setState(e.payload));
    return () => {
      void off.then((f) => f());
    };
  }, []);

  const peko = state?.peko ?? t("layout.computer.strip.somePeko");
  const act = (f: () => Promise<unknown>) => {
    setBusy(true);
    void f().finally(() => setBusy(false));
  };

  return (
    <div
      className="flex h-full items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 text-sm text-fg shadow-lg"
      data-testid="computer-strip"
      data-tauri-drag-region
    >
      {state?.paused ? (
        <Pause className="h-4 w-4 shrink-0 text-warn" />
      ) : (
        <MousePointer2 className="h-4 w-4 shrink-0 text-brand-text" />
      )}
      <span className="min-w-0 flex-1 truncate" data-tauri-drag-region>
        <span className="font-medium">
          {state?.paused
            ? t("layout.computer.strip.paused", { peko })
            : t("layout.computer.strip.using", { peko })}
        </span>
        {!state?.paused && state?.action && (
          <span className="ml-1.5 text-fg-soft">· {state.action}</span>
        )}
      </span>
      {state?.paused && (
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0"
          disabled={busy}
          onClick={() => act(computerResume)}
          data-testid="computer-continue"
        >
          {t("layout.computer.strip.continue")}
        </button>
      )}
      <button
        type="button"
        className="btn-danger btn-sm shrink-0"
        disabled={busy}
        onClick={() => act(computerStop)}
        data-testid="computer-stop"
      >
        {t("layout.computer.strip.stop")}
      </button>
    </div>
  );
}
