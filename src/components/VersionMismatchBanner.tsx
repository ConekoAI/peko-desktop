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
      className="flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-soft p-4 text-sm text-warn"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 flex-shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Engine version mismatch</p>
        <p className="mt-1 break-words text-warn">
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
        className="rounded-md p-1 text-warn transition-colors hover:bg-warn/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
