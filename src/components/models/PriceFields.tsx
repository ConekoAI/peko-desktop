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
  const field = (key: keyof PriceDraft, label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
      {label}
      <span className="flex items-center rounded-md border border-line bg-surface focus-within:border-brand">
        <span className="pl-2 text-fg-subtle">$</span>
        <input
          inputMode="decimal"
          placeholder="—"
          aria-label={`${label} price per million tokens`}
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
      <legend className="mb-1 block text-xs font-medium text-fg-muted">
        Price per million tokens
      </legend>
      <div className="flex flex-wrap gap-3">
        {field("input", "Input")}
        {field("output", "Output")}
      </div>
      <p className={`mt-1 text-[11px] ${invalid ? "text-danger" : "text-fg-subtle"}`}>
        {invalid
          ? "Enter amounts of $0 or more."
          : "From your provider's pricing page. With a price, pekos' spend on this model counts toward their budgets."}
      </p>
    </fieldset>
  );
}
