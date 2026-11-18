import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { usePrivacy, useSetPrivacy } from "../hooks/usePrivacy";
import PrivacySwitches from "./PrivacySwitches";

/**
 * Settings → Privacy: the same two switches as the first-run privacy
 * screen (pekohub ADR-014). Turning one off stops sending at once.
 */
export default function PrivacySettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { data: stored } = usePrivacy();
  const save = useSetPrivacy();
  if (!stored) return null;

  return (
    <div className={className} data-testid="privacy-settings">
      <h3 className="h-section flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4 text-brand-text" />
        {t("settings.privacy.title")}
      </h3>
      <p className="field-hint mb-3 mt-0.5">{t("settings.privacy.noticeBody")}</p>
      <PrivacySwitches
        value={stored}
        disabled={save.isPending}
        onChange={(next) => save.mutate({ ...stored, ...next })}
      />
      {save.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      )}
    </div>
  );
}
