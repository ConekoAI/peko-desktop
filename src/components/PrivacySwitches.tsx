import { useTranslation } from "react-i18next";

export interface Switches {
  crashReports: boolean;
  usageEvents: boolean;
}

/**
 * The two privacy switches (pekohub ADR-014), shared by the first-run
 * privacy screen and Settings.
 */
export default function PrivacySwitches({
  value,
  onChange,
  disabled,
}: {
  value: Switches;
  onChange: (next: Switches) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const rows = [
    { key: "crashReports", text: "crash" },
    { key: "usageEvents", text: "usage" },
  ] as const;

  return (
    <div className="space-y-3">
      {rows.map(({ key, text }) => (
        <label key={key} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            aria-checked={value[key]}
            checked={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            className="mt-1 h-4 w-4 shrink-0"
            data-testid={`privacy-${text}-toggle`}
          />
          <span>
            <span className="text-sm font-medium text-fg">{t(`settings.privacy.${text}.title`)}</span>
            <span className="field-hint mt-0.5 block">{t(`settings.privacy.${text}.hint`)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
