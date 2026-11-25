import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { NetworkConnection } from "../lib/api";
import { useNetworkStatus, useSetNetwork } from "../hooks/useNetwork";

/** Remembered once the notice about accepting connections was read. */
const NOTICE_SEEN = "peko.network.listenNoticeSeen";

const CHOICES: NetworkConnection[] = ["automatic", "pekohub", "direct"];

function seenNotice(): boolean {
  try {
    return localStorage.getItem(NOTICE_SEEN) === "1";
  } catch {
    return false;
  }
}

function rememberNotice() {
  try {
    localStorage.setItem(NOTICE_SEEN, "1");
  } catch {
    /* private window: ask again next time */
  }
}

/** One address per line or comma, blanks dropped. */
function addressesOf(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * How this computer connects to your other computers and people's
 * (runtime ADR-125 D11): through PekoHub only (the default), directly when
 * the other computer is on the same network, or directly only. A change
 * applies at once and shows nowhere but here and in Devices.
 */
export default function NetworkSetting({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { data: status, error } = useNetworkStatus();
  const set = useSetNetwork();
  const [asking, setAsking] = useState<NetworkConnection | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [listen, setListen] = useState("");
  const [told, setTold] = useState("");
  const [peers, setPeers] = useState("");

  const current = status?.connection ?? "pekohub";
  useEffect(() => {
    setListen(status?.directListen ?? "");
    setTold((status?.directAddresses ?? []).join("\n"));
    setPeers((status?.directPeers ?? []).join("\n"));
  }, [status?.directListen, status?.directAddresses, status?.directPeers]);

  function choose(next: NetworkConnection) {
    if (next === current) return;
    // Direct only always asks (D7's list); links the first time say the
    // computer will accept connections.
    if (next === "direct" || (next === "automatic" && !seenNotice())) {
      setAsking(next);
      return;
    }
    set.mutate({ connection: next });
  }

  function confirm() {
    if (!asking) return;
    rememberNotice();
    set.mutate({ connection: asking });
    setAsking(null);
  }

  const advancedChanged =
    listen.trim() !== (status?.directListen ?? "") ||
    addressesOf(told).join(",") !== (status?.directAddresses ?? []).join(",") ||
    addressesOf(peers).join(",") !== (status?.directPeers ?? []).join(",");

  const failure = set.error ?? error;

  return (
    <div className={className} data-testid="network-setting" id="network">
      <h3 className="h-section flex items-center gap-1.5">
        <Network className="h-4 w-4 text-brand-text" />
        {t("settings.network.title")}
      </h3>
      <p className="field-hint mt-0.5">{t("settings.network.hint")}</p>

      <div role="radiogroup" aria-label={t("settings.network.how")} className="mt-3 space-y-1.5">
        {CHOICES.map((choice) => (
          <label
            key={choice}
            className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-raised"
          >
            <input
              type="radio"
              name="network-connection"
              className="mt-1"
              checked={current === choice}
              disabled={set.isPending}
              onChange={() => choose(choice)}
              data-testid={`network-${choice}`}
            />
            <span>
              <span className="block text-sm text-fg">{t(`settings.network.${choice}.label`)}</span>
              <span className="field-hint block">{t(`settings.network.${choice}.hint`)}</span>
            </span>
          </label>
        ))}
      </div>

      {status?.listenError && current !== "pekohub" && (
        <p className="mt-2 text-xs text-warn" role="status" data-testid="network-listen-error">
          {t("settings.network.listenError", { reason: status.listenError })}
        </p>
      )}

      {asking && (
        <div
          className="mt-3 space-y-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm"
          data-testid="network-confirm"
        >
          <p className="text-fg">{t("settings.network.accepts")}</p>
          {asking === "direct" && (
            <>
              <p className="text-fg">{t("settings.network.directStops")}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-fg-muted">
                <li>{t("settings.network.stopsWait")}</li>
                <li>{t("settings.network.stopsPhones")}</li>
                <li>{t("settings.network.stopsWebChat")}</li>
              </ul>
            </>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-primary btn-sm" onClick={confirm} data-testid="network-confirm-yes">
              {asking === "direct" ? t("settings.network.turnOnDirect") : t("settings.network.turnOnAutomatic")}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAsking(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {current !== "pekohub" && (
        <div className="mt-3" data-testid="network-with">
          <span className="text-xs font-semibold text-fg-soft">{t("settings.network.with.title")}</span>
          <div role="radiogroup" aria-label={t("settings.network.with.title")} className="segmented mt-1">
            {(["mine", "people"] as const).map((with_) => (
              <button
                key={with_}
                type="button"
                role="radio"
                aria-checked={status?.directWith === with_}
                disabled={set.isPending}
                onClick={() => set.mutate({ directWith: with_ })}
                className={["segment", status?.directWith === with_ ? "segment-active" : ""].join(" ")}
                data-testid={`network-with-${with_}`}
              >
                {t(`settings.network.with.${with_}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="mt-3 flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        onClick={() => setAdvanced((open) => !open)}
        aria-expanded={advanced}
        data-testid="network-advanced-toggle"
      >
        {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {t("settings.network.advanced.title")}
      </button>
      {advanced && (
        <form
          className="mt-2 space-y-3"
          data-testid="network-advanced"
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate({
              directListen: listen.trim(),
              directAddresses: addressesOf(told),
              directPeers: addressesOf(peers),
            });
          }}
        >
          <label className="block">
            <span className="text-xs font-semibold text-fg-soft">{t("settings.network.advanced.listen")}</span>
            <span className="field-hint block">
              {t("settings.network.advanced.listenHint", { listening: status?.listening ?? "—" })}
            </span>
            <input
              className="input input-sm mt-1 w-full font-mono"
              value={listen}
              placeholder="0.0.0.0:11438"
              onChange={(e) => setListen(e.target.value)}
              spellCheck={false}
              data-testid="network-listen"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-fg-soft">{t("settings.network.advanced.tell")}</span>
            <span className="field-hint block">
              {t("settings.network.advanced.tellHint", { told: (status?.told ?? []).join(", ") || "—" })}
            </span>
            <textarea
              className="input mt-1 w-full font-mono text-xs"
              rows={2}
              value={told}
              onChange={(e) => setTold(e.target.value)}
              spellCheck={false}
              data-testid="network-tell"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-fg-soft">{t("settings.network.advanced.try")}</span>
            <span className="field-hint block">{t("settings.network.advanced.tryHint")}</span>
            <textarea
              className="input mt-1 w-full font-mono text-xs"
              rows={2}
              value={peers}
              onChange={(e) => setPeers(e.target.value)}
              spellCheck={false}
              data-testid="network-try"
            />
          </label>
          <button
            type="submit"
            className="btn-secondary btn-sm"
            disabled={!advancedChanged || set.isPending}
            data-testid="network-advanced-save"
          >
            {t("common.save")}
          </button>
        </form>
      )}

      {failure && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {failure instanceof Error ? failure.message : String(failure)}
        </p>
      )}
    </div>
  );
}
