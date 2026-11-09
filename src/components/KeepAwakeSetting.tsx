import { Coffee } from "lucide-react";
import { useSetSetting, useSettings } from "../hooks/useSettings";

/** The engine's setting (`config.toml` `[power] keep_awake`, on by default). */
export const KEEP_AWAKE_KEY = "power.keep_awake";

/**
 * Whether this computer holds off sleep while one of its pekos works
 * (runtime `common::keep_awake`). On by default: you ask your peko on
 * this computer for work from your laptop, and it should not doze off
 * halfway. Only idle sleep is held off, and only while a peko works.
 */
export default function KeepAwakeSetting({ className }: { className?: string }) {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const stored = settings?.find((s) => s.key === KEEP_AWAKE_KEY)?.value;
  const on = stored === undefined ? true : stored.trim().toLowerCase() !== "false";

  return (
    <div className={className}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          aria-checked={on}
          checked={on}
          disabled={setSetting.isPending}
          onChange={(e) =>
            setSetting.mutate({ key: KEEP_AWAKE_KEY, value: e.target.checked ? "true" : "false" })
          }
          className="mt-1 h-4 w-4 shrink-0"
          data-testid="keep-awake-toggle"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Coffee className="h-4 w-4" />
            Keep this computer awake while a peko works
          </span>
          <span className="mt-0.5 block text-xs text-fg-muted">
            So the pekos on this computer can finish what you ask them from your other
            computers. Sleep is held off only while a peko is working, and a minute after.
            Closing a laptop&apos;s lid still puts it to sleep.
          </span>
        </span>
      </label>
      {setSetting.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {setSetting.error instanceof Error ? setSetting.error.message : String(setSetting.error)}
        </p>
      )}
    </div>
  );
}
