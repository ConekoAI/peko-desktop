import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Globe, Hand, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { principalBrowser } from "../../lib/api";
import type { BrowserState } from "../../types";

/** Keys sent to the page as keys; anything printable is sent as text. */
const KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

type InputEvent = Record<string, string | number | boolean>;

interface Frame {
  seq: number;
  width: number;
  height: number;
  data: string;
}

/**
 * Your peko's browser (runtime ADR-119). A strip under the thread says
 * when the peko has a page open or asks you to step in; the viewer shows
 * the page as the peko's computer draws it. Taking control stops the
 * peko: what you click and type goes straight to the page (to sign in,
 * or pass a check), is not kept in the chat, and never reaches the peko.
 * Handing back, or closing the viewer, lets the peko go on.
 */
export default function PekoBrowser({
  peko,
  runtimeId,
  state,
  onChanged,
}: {
  peko: string;
  runtimeId: string;
  state: BrowserState | undefined;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!state || (!state.running && !state.handoff)) return null;
  const first = state.tabs[0];
  return (
    <div className="border-t border-line bg-surface px-4 pt-3" data-testid="browser-strip">
      <div className="flex items-start gap-2 rounded-xl border border-brand/25 bg-brand-soft p-3.5 text-sm">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" />
        <div className="min-w-0 flex-1">
          <p className="text-fg">
            {state.handoff ? t("chat.browser.needsYou", { peko }) : t("chat.browser.open", { peko })}
          </p>
          <p className="mt-1 truncate text-xs text-fg-muted">
            {state.handoff ? state.handoff.why : (first?.title || first?.url || "")}
          </p>
        </div>
        <button
          type="button"
          className={state.handoff ? "btn-primary btn-sm shrink-0" : "btn-secondary btn-sm shrink-0"}
          onClick={() => setOpen(true)}
          data-testid="browser-open"
        >
          {t("chat.browser.openButton")}
        </button>
      </div>
      {open && (
        <BrowserViewer
          peko={peko}
          runtimeId={runtimeId}
          state={state}
          onClose={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function BrowserViewer({
  peko,
  runtimeId,
  state,
  onClose,
}: {
  peko: string;
  runtimeId: string;
  state: BrowserState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(state.handoff?.tab ?? state.tabs[0]?.tab ?? "t1");
  const [tabs, setTabs] = useState(state.tabs);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [held, setHeld] = useState(false);
  const [controller, setController] = useState<string | null>(state.controller?.viewer ?? null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState(state.handoff?.url ?? state.tabs[0]?.url ?? "");
  const [text, setText] = useState("");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heldRef = useRef(false);
  heldRef.current = held;
  // Sent one after another, so the page gets them in the order made.
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const typed = useRef("");
  const typedTimer = useRef<number | null>(null);

  const ask = useCallback(
    (verb: string, args: Record<string, unknown> = {}) => principalBrowser(peko, runtimeId, verb, args),
    [peko, runtimeId],
  );

  // The page is laid out to the size of the stage it is shown on.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const width = Math.max(320, Math.min(1600, Math.floor(el.clientWidth / 20) * 20));
      const height = Math.max(320, Math.min(1600, Math.floor(el.clientHeight / 20) * 20));
      setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ask for the newest picture, again and again, while the viewer is open.
  useEffect(() => {
    if (!size) return;
    let live = true;
    let seq = 0;
    const pause = runtimeId === "local" ? 120 : 500;
    void (async () => {
      while (live) {
        const started = Date.now();
        try {
          const got = (await ask("frame", {
            tab,
            width: size.width,
            height: size.height,
            after: seq,
            wait_ms: 2500,
          })) as Partial<Frame> & { controller?: string | null };
          if (!live) return;
          setError(null);
          setController(got.controller ?? null);
          if (typeof got.seq === "number" && typeof got.data === "string") {
            seq = got.seq;
            setFrame({ seq: got.seq, width: got.width ?? size.width, height: got.height ?? size.height, data: got.data });
          }
        } catch (err) {
          if (!live) return;
          setError(err instanceof Error ? err.message : String(err));
          await new Promise((r) => window.setTimeout(r, 2000));
        }
        const spent = Date.now() - started;
        if (spent < pause) await new Promise((r) => window.setTimeout(r, pause - spent));
      }
    })();
    return () => {
      live = false;
    };
  }, [ask, tab, size, runtimeId]);

  // Closing the viewer hands the browser back.
  useEffect(
    () => () => {
      if (heldRef.current) void ask("control", { take: false }).catch(() => undefined);
    },
    [ask],
  );

  const refresh = useCallback(async () => {
    try {
      const now = (await ask("state")) as BrowserState;
      setTabs(now.tabs);
      const current = now.tabs.find((x) => x.tab === tab);
      if (current) setAddress(current.url);
    } catch {
      // The next picture reports what is wrong.
    }
  }, [ask, tab]);

  async function control(take: boolean) {
    try {
      await ask("control", { take });
      setHeld(take);
      setError(null);
      if (take) stage.current?.focus();
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function send(events: InputEvent[]) {
    if (!heldRef.current) return;
    sending.current = sending.current
      .then(() => ask("input", { tab, events }))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  function flushTyped() {
    if (typedTimer.current !== null) window.clearTimeout(typedTimer.current);
    typedTimer.current = null;
    if (typed.current) send([{ t: "text", text: typed.current }]);
    typed.current = "";
  }

  /** Where on the page a pointer event landed, in the page's own size. */
  function at(e: { clientX: number; clientY: number; currentTarget: Element }) {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = frame?.width ?? rect.width;
    const height = frame?.height ?? rect.height;
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * height),
    };
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!held || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey) return;
    if (KEYS.has(e.key)) {
      e.preventDefault();
      flushTyped();
      send([{ t: "key", key: e.key }]);
      if (e.key === "Enter") window.setTimeout(() => void refresh(), 1500);
    } else if (e.key.length === 1) {
      e.preventDefault();
      // Letters typed in a row go as one piece of text.
      typed.current += e.key;
      if (typedTimer.current !== null) window.clearTimeout(typedTimer.current);
      typedTimer.current = window.setTimeout(flushTyped, 120);
    }
  }

  const status = held
    ? t("chat.browser.controlling", { peko })
    : controller
      ? t("chat.browser.other")
      : state.handoff
        ? t("chat.browser.handoff", { peko })
        : t("chat.browser.watching", { peko });

  return (
    <div className="modal-backdrop" data-testid="browser-viewer">
      <div
        role="dialog"
        aria-label={t("chat.browser.title", { peko })}
        className="modal-panel flex h-[88vh] w-[min(1200px,94vw)] max-w-none flex-col p-0"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Globe className="h-4 w-4 shrink-0 text-brand-text" />
          {tabs.length > 1 && (
            <select
              className="input h-8 w-28 shrink-0 py-0 text-xs"
              value={tab}
              aria-label={t("chat.browser.tab")}
              onChange={(e) => {
                setTab(e.target.value);
                setFrame(null);
                setAddress(tabs.find((x) => x.tab === e.target.value)?.url ?? "");
              }}
            >
              {tabs.map((x) => (
                <option key={x.tab} value={x.tab}>
                  {x.title || x.url || x.tab}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-icon"
            disabled={!held}
            aria-label={t("chat.browser.back")}
            onClick={() => {
              send([{ t: "back" }]);
              window.setTimeout(() => void refresh(), 1500);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-icon"
            disabled={!held}
            aria-label={t("chat.browser.reload")}
            onClick={() => send([{ t: "reload" }])}
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!held || !address.trim()) return;
              const url = /^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`;
              sending.current = sending.current
                .then(() => ask("open", { tab, url }))
                .then(() => refresh())
                .catch((err) => setError(err instanceof Error ? err.message : String(err)));
            }}
          >
            <input
              className="input h-8 min-w-0 flex-1 py-0 font-mono text-xs"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              readOnly={!held}
              aria-label={t("chat.browser.address")}
              spellCheck={false}
              data-testid="browser-address"
            />
          </form>
          {held ? (
            <button type="button" className="btn-primary btn-sm shrink-0" onClick={() => void control(false)} data-testid="browser-release">
              {t("chat.browser.release")}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary btn-sm shrink-0"
              disabled={!!controller}
              onClick={() => void control(true)}
              data-testid="browser-take"
            >
              <Hand className="mr-1 h-3.5 w-3.5" />
              {t("chat.browser.take")}
            </button>
          )}
          <button type="button" className="btn-icon" aria-label={t("common.close")} onClick={onClose} data-testid="browser-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={stage}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (!held) return;
            e.preventDefault();
            flushTyped();
            send([{ t: "text", text: e.clipboardData.getData("text") }]);
          }}
          className={`relative min-h-0 flex-1 overflow-hidden bg-surface-sunken outline-none ${held ? "ring-2 ring-inset ring-brand/40" : ""}`}
          data-testid="browser-stage"
        >
          {frame ? (
            <img
              src={`data:image/jpeg;base64,${frame.data}`}
              alt={t("chat.browser.title", { peko })}
              draggable={false}
              className={`h-full w-full object-contain object-left-top ${held ? "cursor-default" : "cursor-not-allowed"}`}
              onClick={(e) => {
                if (!held) return;
                flushTyped();
                send([{ t: "click", ...at(e) }]);
                stage.current?.focus();
                window.setTimeout(() => void refresh(), 1500);
              }}
              onWheel={(e) => {
                if (!held) return;
                send([{ t: "wheel", ...at(e), dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) }]);
              }}
              data-testid="browser-frame"
            />
          ) : (
            <p className="p-6 text-sm text-fg-muted">{t("chat.browser.waiting")}</p>
          )}
        </div>

        <div className="border-t border-line px-3 py-2">
          <p className={`text-xs ${error ? "text-danger" : "text-fg-muted"}`} data-testid="browser-status">
            {error ?? status}
          </p>
          {held && (
            <>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text) return;
                  flushTyped();
                  send([{ t: "text", text }]);
                  // Not kept once it has gone to the page.
                  setText("");
                }}
              >
                <input
                  className="input h-8 min-w-0 flex-1 py-0 text-xs"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("chat.browser.typeHere")}
                  aria-label={t("chat.browser.typeHere")}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="browser-text"
                />
                <button type="submit" className="btn-secondary btn-sm shrink-0" disabled={!text}>
                  {t("chat.browser.send")}
                </button>
              </form>
              <p className="field-hint mt-1.5">{t("chat.browser.hint", { peko })}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
