import { AlertTriangle, X } from "lucide-react";

/**
 * Full-width banner shown above the page content when the bundled
 * engine reports a version that does not match the desktop's own
 * `Cargo.toml` version. The release process guarantees they
 * match, so a mismatch is always a packaging slip-up worth
 * surfacing prominently.
 *
 * The banner owns its own dismissal state — clicking the X hides
 * it for the rest of the session, but a fresh mismatch event will
 * re-show it (the hook rebuilds the state every time the event
 * fires).
 */
export default function VersionMismatchBanner({
  actual,
  expected,
  onDismiss,
}: {
  actual: string;
  expected: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="engine-version-mismatch-banner"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 flex-shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Engine version mismatch</p>
        <p className="mt-1 break-words text-amber-700 dark:text-amber-300">
          The bundled engine reports <code className="font-mono">{actual}</code>
          {" "}but the desktop was built against{" "}
          <code className="font-mono">{expected}</code>. Reinstall the desktop to
          fix the mismatch.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss version mismatch banner"
        className="rounded p-1 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
