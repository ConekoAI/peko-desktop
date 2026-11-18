import { useState } from "react";
import { useTranslation } from "react-i18next";

import { usePrivacy, useSetPrivacy } from "../hooks/usePrivacy";
import PrivacySwitches, { type Switches } from "./PrivacySwitches";

/**
 * The privacy screen (pekohub ADR-014 decision 5): what the app sends,
 * what it never sends, and the two switches, both on. It shows once, to
 * a new install and to one updated from a build that had no such screen.
 * Nothing is sent until "Continue" is pressed; there is no other way to
 * close it, so the choice is always one the owner has seen.
 */
export default function PrivacyNotice() {
  const { t } = useTranslation();
  const { data: stored } = usePrivacy();
  const save = useSetPrivacy();
  const [picked, setPicked] = useState<Switches | null>(null);

  if (!stored || stored.acknowledged) return null;
  const value = picked ?? { crashReports: stored.crashReports, usageEvents: stored.usageEvents };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-notice-title"
      data-testid="privacy-notice"
      className="modal-backdrop"
    >
      <div className="modal-panel max-w-md p-6">
        <h2 id="privacy-notice-title" className="text-lg font-semibold text-fg">
          {t("settings.privacy.noticeTitle")}
        </h2>
        <p className="mt-2 text-sm text-fg-muted">{t("settings.privacy.noticeBody")}</p>
        <div className="mt-4">
          <PrivacySwitches value={value} onChange={setPicked} disabled={save.isPending} />
        </div>
        <p className="field-hint mt-4">{t("settings.privacy.changeLater")}</p>
        {save.error && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        )}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate({ ...value, acknowledged: true })}
            data-testid="privacy-notice-continue"
          >
            {t("settings.privacy.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
