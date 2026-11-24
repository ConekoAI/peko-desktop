import { MousePointer2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "../hooks/useSettings";
import { computerSetup, computerStatus, computerStopShortcut } from "../lib/api";

/** The engine's setting (`[computer] enabled`, on by default). */
export const COMPUTER_KEY = "computer.enabled";

interface ComputerStatus {
  available?: boolean;
  unavailable?: string | null;
  permissions?: {
    screen_recording?: boolean;
    accessibility?: boolean;
    responsible_app?: string;
  };
}

/**
 * Whether a peko may use this computer (runtime ADR-123), the stop
 * shortcut, and on macOS the two permissions it needs, with a button that
 * asks for them.
 */
export default function ComputerSetting({ className }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const stored = settings?.find((s) => s.key === COMPUTER_KEY)?.value;
  const on = stored === undefined ? true : stored.trim().toLowerCase() !== "false";
  const status = useQuery({
    queryKey: ["computer", "status"],
    queryFn: () => computerStatus() as Promise<ComputerStatus>,
    refetchInterval: 5000,
    retry: false,
  });
  const shortcut = useQuery({ queryKey: ["computer", "shortcut"], queryFn: computerStopShortcut });
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perms = status.data?.permissions;
  const macPermissions =
    perms && (typeof perms.screen_recording === "boolean" || typeof perms.accessibility === "boolean");
  const app = perms?.responsible_app?.split("/").pop();
  const granted = (v: boolean | undefined) =>
    v ? t("layout.computer.setting.granted") : t("layout.computer.setting.notGranted");

  return (
    <div className={className}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          aria-checked={on}
          checked={on}
          disabled={setSetting.isPending}
          onChange={(e) => {
            setSetting.mutate({ key: COMPUTER_KEY, value: e.target.checked ? "true" : "false" });
          }}
          className="mt-1 h-4 w-4 shrink-0"
          data-testid="computer-toggle"
        />
        <span>
          <span className="h-section flex items-center gap-1.5">
            <MousePointer2 className="h-4 w-4 text-brand-text" />
            {t("layout.computer.setting.title")}
          </span>
          <span className="field-hint mt-0.5 block">
            {t("layout.computer.setting.hint", { shortcut: shortcut.data ?? "" })}
          </span>
        </span>
      </label>
      {status.data?.unavailable && (
        <p className="field-hint mt-2" data-testid="computer-unavailable">
          {t("layout.computer.setting.unavailable", { why: status.data.unavailable })}
        </p>
      )}
      {on && macPermissions && (
        <div className="mt-3 ml-7 space-y-1.5 text-sm" data-testid="computer-permissions">
          <div className="text-xs font-semibold text-fg-soft">
            {app
              ? t("layout.computer.setting.permissions", { app })
              : t("layout.computer.setting.permissionsPlain")}
          </div>
          <div className="flex justify-between gap-4">
            <span>{t("layout.computer.setting.screenRecording")}</span>
            <span className={perms?.screen_recording ? "text-ok" : "text-warn"}>
              {granted(perms?.screen_recording)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>{t("layout.computer.setting.accessibility")}</span>
            <span className={perms?.accessibility ? "text-ok" : "text-warn"}>
              {granted(perms?.accessibility)}
            </span>
          </div>
          {(!perms?.screen_recording || !perms?.accessibility) && (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={asking}
                data-testid="computer-ask"
                onClick={() => {
                  setAsking(true);
                  setError(null);
                  computerSetup()
                    .then(() => qc.invalidateQueries({ queryKey: ["computer", "status"] }))
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setAsking(false));
                }}
              >
                {t("layout.computer.setting.ask")}
              </button>
              <span className="field-hint">{t("layout.computer.setting.restartHint")}</span>
            </div>
          )}
        </div>
      )}
      {(setSetting.error || error) && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error ??
            (setSetting.error instanceof Error ? setSetting.error.message : String(setSetting.error))}
        </p>
      )}
    </div>
  );
}
