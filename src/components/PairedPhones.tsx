import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Smartphone, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  pairedPhoneRemove,
  pairedPhones,
  phonePairStart,
  type PairedPhone,
  type PhonePairing,
} from "../lib/api";
import { timeAgo } from "../lib/format";

/** How often the list is read again while a code is on screen. */
const WATCH_MS = 2000;

/** What the app is told when this computer is not signed in to PekoHub. */
const NOT_SIGNED_IN = "not_signed_in";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The phones paired with this computer (runtime ADR-108). A paired phone
 * reads and posts as you through this computer. You pair one by showing
 * it a code here, and remove it here.
 *
 * The code works once and for ten minutes. While it is on screen the list
 * is read every two seconds, so the code goes away as soon as a phone has
 * scanned it.
 */
export default function PairedPhones({ className }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pairing, setPairing] = useState<PhonePairing | null>(null);
  const [expired, setExpired] = useState(false);
  const [justPaired, setJustPaired] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The phones that were paired when the code was shown. */
  const known = useRef<Set<string>>(new Set());

  const { data: phones, isLoading } = useQuery({
    queryKey: ["paired-phones"],
    queryFn: pairedPhones,
    refetchInterval: pairing ? WATCH_MS : false,
  });

  const start = useMutation({
    mutationFn: phonePairStart,
    onMutate: () => {
      setExpired(false);
      setJustPaired(null);
    },
    onSuccess: (next) => {
      known.current = new Set((phones ?? []).map((p) => p.deviceId));
      setPairing(next);
    },
  });

  const remove = useMutation({
    mutationFn: (deviceId: string) => pairedPhoneRemove(deviceId),
    onSuccess: (now) => {
      qc.setQueryData(["paired-phones"], now);
      setConfirming(null);
      // "… is paired" is about a phone that may be the one just removed.
      setJustPaired(null);
    },
  });

  // A phone scanned the code: it is in the list and was not before.
  useEffect(() => {
    if (!pairing || !phones) return;
    const added = phones.find((p) => !known.current.has(p.deviceId));
    if (added) {
      setPairing(null);
      setJustPaired(added.name || added.deviceId);
    }
  }, [pairing, phones]);

  // The code stops working at its time; take it off the screen then.
  useEffect(() => {
    if (!pairing) return;
    const left = Date.parse(pairing.expiresAt) - Date.now();
    if (isNaN(left)) return;
    const timer = setTimeout(
      () => {
        setPairing(null);
        setExpired(true);
      },
      Math.max(left, 0),
    );
    return () => clearTimeout(timer);
  }, [pairing]);

  const startError = start.error ? messageOf(start.error) : null;

  return (
    <div className={className} data-testid="paired-phones">
      <h3 className="h-section flex items-center gap-1.5">
        <Smartphone className="h-4 w-4 text-brand-text" />
        {t("settings.phones.title")}
      </h3>
      <p className="field-hint mt-0.5">{t("settings.phones.hint")}</p>

      {isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (phones ?? []).length === 0 ? (
        <div className="mt-3 text-xs text-fg-subtle" data-testid="paired-phones-empty">
          {t("settings.phones.empty")}
        </div>
      ) : (
        <ul className="rows mt-3">
          {phones!.map((phone) => (
            <PhoneRow
              key={phone.deviceId}
              phone={phone}
              confirming={confirming === phone.deviceId}
              busy={remove.isPending}
              onAsk={() => setConfirming(phone.deviceId)}
              onCancel={() => setConfirming(null)}
              onRemove={() => remove.mutate(phone.deviceId)}
            />
          ))}
        </ul>
      )}

      {justPaired && (
        <p className="mt-3 text-xs text-ok" role="status" data-testid="paired-phones-done">
          {t("settings.phones.paired", { name: justPaired })}
        </p>
      )}

      {pairing ? (
        <div className="mt-4 flex flex-wrap items-start gap-4" data-testid="paired-phones-code">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(pairing.svg)}`}
            alt={t("settings.phones.codeAlt")}
            className="h-52 w-52 shrink-0 rounded-md border border-border bg-white"
          />
          <div className="min-w-0 flex-1 basis-56 space-y-2 text-sm text-fg">
            <p>{t("settings.phones.scan")}</p>
            <p className="text-xs text-warn">{t("settings.phones.warning")}</p>
            <p className="text-xs text-fg-subtle">
              {t("settings.phones.expires", {
                time: new Date(pairing.expiresAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </p>
            <button
              type="button"
              onClick={() => setPairing(null)}
              className="btn-secondary btn-xs"
              data-testid="paired-phones-hide"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {expired && (
            <p className="mb-2 text-xs text-fg-subtle" data-testid="paired-phones-expired">
              {t("settings.phones.expired")}
            </p>
          )}
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => start.mutate()}
            className="btn-secondary btn-sm"
            data-testid="paired-phones-pair"
          >
            {start.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("settings.phones.pair")}
          </button>
        </div>
      )}

      {startError && (
        <p className="mt-2 text-xs text-danger" role="alert" data-testid="paired-phones-error">
          {startError === NOT_SIGNED_IN ? t("settings.phones.notSignedIn") : startError}
        </p>
      )}
      {remove.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {messageOf(remove.error)}
        </p>
      )}
    </div>
  );
}

function PhoneRow({
  phone,
  confirming,
  busy,
  onAsk,
  onCancel,
  onRemove,
}: {
  phone: PairedPhone;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const platform =
    phone.platform === "ios"
      ? t("settings.phones.platformIos")
      : phone.platform === "android"
        ? t("settings.phones.platformAndroid")
        : phone.platform;
  const paired = timeAgo(phone.pairedAt);
  return (
    <li className="flex items-center gap-2 px-3 py-2.5" data-testid={`phone-${phone.deviceId}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-fg">
          {phone.name || phone.deviceId}
          {platform && <span className="ml-1.5 text-xs text-fg-subtle">{platform}</span>}
        </div>
        <div className="truncate text-xs text-fg-subtle">
          {paired && t("settings.phones.pairedAt", { when: paired })}
          {paired && " · "}
          {phone.lastSeen
            ? t("settings.phones.lastSeen", { when: timeAgo(phone.lastSeen) })
            : t("settings.phones.neverSeen")}
        </div>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-fg-muted">{t("settings.phones.removeConfirm")}</span>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="btn-danger-solid btn-xs"
            data-testid={`phone-confirm-remove-${phone.deviceId}`}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            {t("common.confirm")}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary btn-xs">
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAsk}
          className="btn-secondary btn-xs shrink-0"
          data-testid={`phone-remove-${phone.deviceId}`}
        >
          {t("common.remove")}
        </button>
      )}
    </li>
  );
}
