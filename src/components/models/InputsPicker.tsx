import { Film, Image, Mic } from "lucide-react";

import type { ModelInputs } from "../../lib/model-spec";

const OPTIONS: { key: keyof ModelInputs; label: string; Icon: typeof Image }[] = [
  { key: "image", label: "Images", Icon: Image },
  { key: "audio", label: "Audio", Icon: Mic },
  { key: "video", label: "Video", Icon: Film },
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
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1 block text-xs font-medium text-fg-muted">Understands</legend>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-xs text-fg-muted">
          Text
        </span>
        {OPTIONS.map(({ key, label, Icon }) => {
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
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line bg-surface-card text-fg-soft hover:bg-surface-sunken",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-fg-subtle">
        Turn on what your provider says the model takes. Attached files of these kinds go to the
        model itself.
      </p>
    </fieldset>
  );
}
