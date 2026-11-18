/**
 * Crash reports from the window (pekohub ADR-014).
 *
 * An error nothing handled is handed to the native side
 * (`src-tauri/src/telemetry.rs`), which sends it only if the owner has
 * passed the privacy screen and left crash reports on. The window itself
 * opens no connection.
 *
 * What is handed over: the error's class and its stack (function, file
 * inside the app, line, column). The message goes along only for the
 * JavaScript engine's own error classes, whose text is about code. Any
 * other error's message may quote a name, a path or a reply, so it stays
 * here. Values that are not errors are not reported.
 */
import { invoke } from "@tauri-apps/api/core";

export interface UiFrame {
  function: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
}

export interface UiError {
  name: string;
  message: string | null;
  frames: UiFrame[];
}

/** Error classes whose message the engine writes, about code only. */
const ENGINE_ERRORS = new Set([
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
]);

/** No more than this many reports from one run of the app. */
const MAX_REPORTS = 20;
const MAX_FRAMES = 50;

// `at fn (file:1:2)`, `at file:1:2` (Chromium) and `fn@file:1:2`,
// `file:1:2` (WebKit).
const FRAME = /^\s*(?:at\s+)?(?:(.*?)(?:\s+\(|@))?(.*?):(\d+):(\d+)\)?\s*$/;

/** `tauri://localhost/assets/a.js?v=1` → `assets/a.js`. */
function insideApp(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, "").replace(/[?#].*$/, "");
}

/** The stack's lines, newest call first, as the engine wrote them. */
export function parseStack(stack: string | undefined): UiFrame[] {
  if (!stack) return [];
  const frames: UiFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = FRAME.exec(line);
    if (!m) continue;
    frames.push({
      function: m[1]?.trim() || null,
      file: insideApp(m[2]) || null,
      line: Number(m[3]),
      column: Number(m[4]),
    });
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

/** What a caught value becomes in a report; `null` when it is not an error. */
export function describeError(value: unknown): UiError | null {
  if (!(value instanceof Error)) return null;
  const name = value.name || "Error";
  return {
    name,
    message: ENGINE_ERRORS.has(name) ? value.message : null,
    frames: parseStack(value.stack),
  };
}

let reported = 0;

/** Hand an error to the native side. Never throws. */
export function reportError(value: unknown): void {
  const error = describeError(value);
  if (!error || reported >= MAX_REPORTS) return;
  reported += 1;
  try {
    void invoke("report_ui_error", { ...error }).catch(() => {});
  } catch {
    // No native side (a browser preview): nothing to report to.
  }
}

/** Report errors and rejected promises that nothing handled. */
export function installErrorReporting(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => reportError(event.error));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
}

/** Test-only: forget how many reports this run has made. */
export function resetReportCount(): void {
  reported = 0;
}
