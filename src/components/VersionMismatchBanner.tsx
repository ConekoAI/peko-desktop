import { AlertTriangle, X } from "lucide-react";
import type { RuntimeFitReason } from "../types";

/**
 * Full-width banner shown above the page content when the running Peko
 * runtime doesn't fit the one this app needs (peko-runtime ADR-102).
 *
 * The app names one runtime version: the one it bundles, and the oldest
 * it accepts. A later patch release in the same line is fine and shows
 * nothing. The banner appears for an older runtime (usually a daemon
 * started from the command line before the app opened) or for one from a
 * later line than this app knows.
 *
 * The banner owns its own dismissal state — clicking the X hides
 * it for the rest of the session, but a fresh mismatch event will
 * re-show it (the hook rebuilds the state every time the event
 * fires).
 */
export default function VersionMismatchBanner({
  actual,
  expected,
  reason,
  onDismiss,
}: {
  actual: string;
  expected: string;
  reason?: RuntimeFitReason;
  onDismiss: () => void;
}) {
  const running = <code className="font-mono">{actual}</code>;
  const needed = <code className="font-mono">{expected}</code>;
  return (
    <div
      role="alert"
      data-testid="engine-version-mismatch-banner"
      className="flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-soft p-4 text-sm text-warn"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 flex-shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {reason === "newer" ? (
          <>
            <p className="font-medium">This app is older than your Peko</p>
            <p className="mt-1 break-words text-warn">
              Peko {running} is running, and this app was made for {needed}.
              Some things may not work. Update Peko Desktop.
            </p>
          </>
        ) : reason === "older" ? (
          <>
            <p className="font-medium">Your Peko is older than this app needs</p>
            <p className="mt-1 break-words text-warn">
              Peko {running} is running, and this app needs {needed} or later.
              If you started it from the command line, run{" "}
              <code className="font-mono">peko update</code>, then{" "}
              <code className="font-mono">peko daemon stop</code> and open this
              app again.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">Can&apos;t tell if your Peko fits this app</p>
            <p className="mt-1 break-words text-warn">
              Peko reports version {running}, and this app needs {needed} or
              later. Some things may not work.
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss version mismatch banner"
        className="rounded-md p-1 text-warn transition-colors hover:bg-warn/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
