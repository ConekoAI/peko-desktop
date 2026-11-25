import { useTranslation } from "react-i18next";

import { EFFORT_LEVELS, type EffortLevel } from "../../lib/model-facts";

/**
 * How hard a model thinks on every turn. "Provider's default" sends no
 * effort at all; the levels are the ones the model takes, as its
 * provider listed them (all five, with a note, when they are unknown).
 */
export default function EffortPicker({
  value,
  onChange,
  levels,
  disabled,
}: {
  /** `""` is the provider's default. */
  value: EffortLevel | "";
  onChange: (value: EffortLevel | "") => void;
  /** The levels the model takes; empty when not known. */
  levels: EffortLevel[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const known = levels.length > 0;
  const offered = known ? levels : EFFORT_LEVELS;
  return (
    <label className="block">
      <span className="field-label mb-1.5 block">{t("models.effort.label")}</span>
      <select
        data-testid="model-effort"
        value={value}
        onChange={(e) => onChange(e.target.value as EffortLevel | "")}
        disabled={disabled}
        className="input"
      >
        <option value="">{t("models.effort.default")}</option>
        {offered.map((l) => (
          <option key={l} value={l}>
            {t(`models.effort.levels.${l}`)}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] text-fg-subtle">
        {known ? t("models.effort.hint") : t("models.effort.unknownLevels")}
      </span>
    </label>
  );
}
