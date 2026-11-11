import { AlertTriangle, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const parts = {
    running: <code className="font-mono">{actual}</code>,
    needed: <code className="font-mono">{expected}</code>,
    code: <code className="font-mono" />,
  };
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
            <p className="font-medium">{t("layout.versionMismatch.newerTitle")}</p>
            <p className="mt-1 break-words text-warn">
              <Trans i18nKey="layout.versionMismatch.newerBody" components={parts} />
            </p>
          </>
        ) : reason === "older" ? (
          <>
            <p className="font-medium">{t("layout.versionMismatch.olderTitle")}</p>
            <p className="mt-1 break-words text-warn">
              <Trans i18nKey="layout.versionMismatch.olderBody" components={parts} />
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">{t("layout.versionMismatch.unknownTitle")}</p>
            <p className="mt-1 break-words text-warn">
              <Trans i18nKey="layout.versionMismatch.unknownBody" components={parts} />
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("layout.versionMismatch.dismiss")}
        className="rounded-md p-1 text-warn transition-colors hover:bg-warn/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
