import { Film, Image, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ModelInputs } from "../../lib/model-spec";

const OPTIONS: { key: keyof ModelInputs; Icon: typeof Image }[] = [
  { key: "image", Icon: Image },
  { key: "audio", Icon: Mic },
  { key: "video", Icon: Film },
];

/**
 * Which media a model understands besides text. Files of these kinds
 * attached to a message go to the model itself; anything else stays a
 * file the peko opens with its tools.
 */
export default function InputsPicker({
  value,
  onChange,
  disabled,
}: {
  value: ModelInputs;
  onChange: (value: ModelInputs) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset disabled={disabled}>
      <legend className="field-label mb-1.5 block">{t("models.inputs.legend")}</legend>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-xs text-fg-muted">
          {t("models.inputs.text")}
        </span>
        {OPTIONS.map(({ key, Icon }) => {
          const on = value[key];
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onChange({ ...value, [key]: !on })}
              className={[
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                on
                  ? "border-brand bg-brand-soft text-brand-text"
                  : "border-line bg-surface-card text-fg-soft hover:bg-surface-sunken",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`models.inputs.${key}`)}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-fg-subtle">
        {t("models.inputs.hint")}
      </p>
    </fieldset>
  );
}
