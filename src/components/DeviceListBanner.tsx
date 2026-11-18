import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAccountDevices } from "../hooks/useAccountDevices";

/**
 * Above every page while this computer is signed in to PekoHub but not on
 * its account's devices (runtime ADR-111): what it sends as you waits,
 * and nothing else says why. One button goes to where it joins.
 */
export default function DeviceListBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useAccountDevices();
  if (!data?.account || data.onList) return null;
  return (
    <div
      role="status"
      data-testid="device-list-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-sm text-fg"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-warn" />
      <span className="min-w-0 flex-1">{t("layout.deviceList.notOn")}</span>
      <button
        type="button"
        className="btn-primary btn-xs"
        onClick={() => {
          void navigate({ to: "/settings", hash: "devices" }).then(() =>
            document.getElementById("devices")?.scrollIntoView?.({ block: "start" }),
          );
        }}
        data-testid="device-list-banner-join"
      >
        {t("layout.deviceList.join")}
      </button>
    </div>
  );
}
