import { useTranslation } from "react-i18next";

import type { PriceDraft } from "../../lib/model-spec";

/**
 * A model's price per million tokens, in US dollars. With a price, each
 * peko's spend on this model counts toward its budget.
 */
export default function PriceFields({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: PriceDraft;
  onChange: (value: PriceDraft) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const field = (key: keyof PriceDraft, label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
      {label}
      <span className="flex items-center rounded-md border border-line bg-surface focus-within:border-brand">
        <span className="pl-2 text-fg-subtle">$</span>
        <input
          inputMode="decimal"
          placeholder="—"
          aria-label={t("models.price.fieldAria", { label })}
          value={value[key]}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          className="w-16 bg-transparent px-1.5 py-1 text-xs text-fg outline-none"
        />
      </span>
    </label>
  );
  return (
    <fieldset disabled={disabled}>
      <legend className="field-label mb-1.5 block">
        {t("models.price.legend")}
      </legend>
      <div className="flex flex-wrap gap-3">
        {field("input", t("models.price.input"))}
        {field("output", t("models.price.output"))}
        {field("cacheRead", t("models.price.cacheRead"))}
        {field("cacheWrite", t("models.price.cacheWrite"))}
      </div>
      <p className={`mt-1 text-[11px] ${invalid ? "text-danger" : "text-fg-subtle"}`}>
        {invalid
          ? t("models.price.invalid")
          : t("models.price.hint")}
      </p>
    </fieldset>
  );
}
