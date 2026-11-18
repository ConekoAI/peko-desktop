import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Laptop, Loader2, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  deviceAdd,
  deviceJoin,
  deviceRemove,
  securityDecide,
  type AccountDevice,
  type JoinCodeShown,
  type SecurityItem,
} from "../lib/api";
import { timeAgo } from "../lib/format";
import { ACCOUNT_DEVICES_KEY as KEY, useAccountDevices } from "../hooks/useAccountDevices";
import { IdentityCodeView } from "./IdentityCode";

/** What the app is told when this computer is not signed in to PekoHub. */
const NOT_SIGNED_IN = "not_signed_in";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Your account's devices (runtime ADR-111): your computers and phones, one
 * list the devices on it sign. A device joins with a code shown on one
 * already on it; you show that code here, and remove devices here. What
 * waits about your account (an owner change, a peko's new identity, a
 * contact whose devices started over) is decided here too, once.
 */
export default function AccountDevices({ className }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [shown, setShown] = useState<JoinCodeShown | null>(null);
  const [expired, setExpired] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  /** The devices on the list when the code was shown. */
  const known = useRef<Set<string>>(new Set());

  const { data, isLoading, error } = useAccountDevices(!!shown);
  const panel = useRef<HTMLDivElement>(null);

  // Opened at `#devices` (the banner, the Settings badge): into view.
  useEffect(() => {
    if (window.location.hash === "#devices") panel.current?.scrollIntoView?.({ block: "start" });
  }, []);

  const add = useMutation({
    mutationFn: deviceAdd,
    onMutate: () => {
      setExpired(false);
      setJoined(null);
    },
    onSuccess: (next) => {
      known.current = new Set((data?.devices ?? []).map((d) => d.id));
      setShown(next);
    },
  });

  const join = useMutation({
    mutationFn: (code: string) => deviceJoin(code),
    onSuccess: (now) => {
      qc.setQueryData(KEY, now);
      setTyped("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deviceRemove(id),
    onSuccess: (now) => {
      qc.setQueryData(KEY, now);
      setConfirming(null);
      setJoined(null);
    },
  });

  // A device joined: it is on the list and was not before.
  useEffect(() => {
    if (!shown || !data) return;
    const added = data.devices.find((d) => !known.current.has(d.id));
    if (added) {
      setShown(null);
      setJoined(added.name || t(added.kind === "phone" ? "settings.devices.phone" : "settings.devices.computer"));
    }
  }, [shown, data, t]);

  // The code stops working at its time; take it off the screen then.
  useEffect(() => {
    if (!shown) return;
    const left = Date.parse(shown.expiresAt) - Date.now();
    if (isNaN(left)) return;
    const timer = setTimeout(
      () => {
        setShown(null);
        setExpired(true);
      },
      Math.max(left, 0),
    );
    return () => clearTimeout(timer);
  }, [shown]);

  const addError = add.error ? messageOf(add.error) : null;
  const loadError = error ? messageOf(error) : null;
  const signedOut = !isLoading && (loadError === NOT_SIGNED_IN || (data && !data.account));

  return (
    <div className={className} data-testid="account-devices" id="devices" ref={panel}>
      <h3 className="h-section flex items-center gap-1.5">
        <Laptop className="h-4 w-4 text-brand-text" />
        {t("settings.devices.title")}
      </h3>
      <p className="field-hint mt-0.5">{t("settings.devices.hint")}</p>

      {isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("common.loading")}
        </div>
      ) : signedOut ? (
        <p className="mt-3 text-xs text-fg-subtle" data-testid="account-devices-signed-out">
          {t("settings.devices.notSignedIn")}
        </p>
      ) : (
        <>
          {(data?.security ?? []).length > 0 && <SecurityList items={data!.security} />}

          {data && !data.onList && (
            <form
              className="mt-3 space-y-2 rounded-md border border-warn/30 bg-warn-soft p-3"
              data-testid="account-devices-join"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) join.mutate(typed.trim());
              }}
            >
              <p className="text-sm text-fg">{t("settings.devices.notOnList")}</p>
              <p className="text-xs text-fg-muted">{t("settings.devices.joinHow")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={t("settings.devices.codePlaceholder")}
                  aria-label={t("settings.devices.codeLabel")}
                  className="input input-sm w-48 font-mono uppercase"
                  autoCapitalize="characters"
                  spellCheck={false}
                  data-testid="account-devices-code"
                />
                <button
                  type="submit"
                  disabled={!typed.trim() || join.isPending}
                  className="btn-primary btn-sm"
                  data-testid="account-devices-join-go"
                >
                  {join.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {join.isPending ? t("settings.devices.joining") : t("settings.devices.join")}
                </button>
              </div>
              {join.error && (
                <p className="text-xs text-danger" role="alert">
                  {messageOf(join.error)}
                </p>
              )}
            </form>
          )}

          <ul className="rows mt-3">
            {(data?.devices ?? []).map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onList={!!data?.onList}
                confirming={confirming === device.id}
                busy={remove.isPending}
                onAsk={() => setConfirming(device.id)}
                onCancel={() => setConfirming(null)}
                onRemove={() => remove.mutate(device.id)}
              />
            ))}
          </ul>

          {joined && (
            <p className="mt-3 text-xs text-ok" role="status" data-testid="account-devices-joined">
              {t("settings.devices.joined", { name: joined })}
            </p>
          )}

          {data?.onList &&
            (shown ? (
              <div className="mt-4 flex flex-wrap items-start gap-4" data-testid="account-devices-code-shown">
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(shown.svg)}`}
                  alt={t("settings.devices.codeAlt")}
                  className="h-52 w-52 shrink-0 rounded-md border border-border bg-white"
                />
                <div className="min-w-0 flex-1 basis-56 space-y-2 text-sm text-fg">
                  <p className="font-mono text-2xl tracking-wider" data-testid="account-devices-code-text">
                    {shown.code}
                  </p>
                  <p>{t("settings.devices.scanOrType")}</p>
                  <p className="text-xs text-warn">{t("settings.devices.warning")}</p>
                  <p className="text-xs text-fg-subtle">
                    {t("settings.devices.expires", {
                      time: new Date(shown.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShown(null)}
                    className="btn-secondary btn-xs"
                    data-testid="account-devices-hide"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                {expired && (
                  <p className="mb-2 text-xs text-fg-subtle" data-testid="account-devices-expired">
                    {t("settings.devices.expired")}
                  </p>
                )}
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate()}
                  className="btn-secondary btn-sm"
                  data-testid="account-devices-add"
                >
                  {add.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("settings.devices.add")}
                </button>
              </div>
            ))}

          {addError && (
            <p className="mt-2 text-xs text-danger" role="alert" data-testid="account-devices-error">
              {addError === NOT_SIGNED_IN ? t("settings.devices.notSignedIn") : addError}
            </p>
          )}
          {remove.error && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {messageOf(remove.error)}
            </p>
          )}

          {data?.onList && data.code && (
            <div className="mt-5 border-t border-border pt-4">
              <IdentityCodeView
                code={data.code}
                label={t("settings.devices.accountCode")}
                hint={t("settings.devices.accountCodeHint")}
                testId="account-code"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeviceRow({
  device,
  onList,
  confirming,
  busy,
  onAsk,
  onCancel,
  onRemove,
}: {
  device: AccountDevice;
  onList: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const Icon = device.kind === "phone" ? Smartphone : Laptop;
  const kind = t(device.kind === "phone" ? "settings.devices.phone" : "settings.devices.computer");
  const added = timeAgo(device.addedAt);
  return (
    <li className="flex items-center gap-2 px-3 py-2.5" data-testid={`device-${device.id}`}>
      <Icon className="h-4 w-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-fg">
          {device.name || kind}
          {device.this && <span className="ml-1.5 text-xs text-fg-subtle">{t("settings.devices.thisComputer")}</span>}
        </div>
        <div className="truncate text-xs text-fg-subtle">
          {kind}
          {added && ` · ${t("settings.devices.addedAt", { when: added })}`}
          {device.lastSeen && ` · ${t("settings.devices.lastSeen", { when: timeAgo(device.lastSeen) })}`}
        </div>
      </div>
      {!onList ? null : confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-fg-muted">
            {device.this ? t("settings.devices.removeThisConfirm") : t("settings.devices.removeConfirm")}
          </span>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="btn-danger-solid btn-xs"
            data-testid={`device-confirm-remove-${device.id}`}
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
          data-testid={`device-remove-${device.id}`}
        >
          {t("settings.devices.remove")}
        </button>
      )}
    </li>
  );
}

/** What waits for you about your account, each once. */
function SecurityList({ items }: { items: SecurityItem[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => securityDecide(id, approve),
    onSuccess: (message) => {
      setOutcome(message);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const headline = (item: SecurityItem) =>
    item.kind === "owner_change"
      ? t("settings.devices.ownerChange", { peko: item.peko ?? "" })
      : item.kind === "key_change"
        ? t("settings.devices.keyChange")
        : item.kind === "devices_reset"
          ? t("settings.devices.devicesReset")
          : item.summary;
  return (
    <div className="mt-3" data-testid="account-security">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <ShieldAlert className="h-4 w-4 text-warn" />
        {t("settings.devices.waiting")}
      </h4>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-warn/25 bg-warn-soft p-3 text-sm"
            data-testid={`security-${item.id}`}
          >
            <p className="text-fg">{headline(item)}</p>
            <p className="mt-1 text-xs text-fg-muted">{item.summary}</p>
            {item.code && (
              <div className="mt-2 space-y-2 rounded-md bg-surface/60 p-2.5">
                <IdentityCodeView
                  code={item.code}
                  label={t("settings.devices.itsCode")}
                  testId={`security-code-${item.id}`}
                />
                {item.pinnedCode && (
                  <IdentityCodeView code={item.pinnedCode} label={t("settings.devices.untilNow")} />
                )}
                <p className="text-xs text-fg-muted">{t("settings.devices.compare")}</p>
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: item.id, approve: true })}
                className="btn-primary btn-xs"
                data-testid={`security-approve-${item.id}`}
              >
                {t("settings.devices.approve")}
              </button>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: item.id, approve: false })}
                className="btn-secondary btn-xs"
                data-testid={`security-deny-${item.id}`}
              >
                {t("settings.devices.deny")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {outcome && (
        <p className="mt-2 text-xs text-ok" role="status">
          {outcome}
        </p>
      )}
      {decide.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {messageOf(decide.error)}
        </p>
      )}
    </div>
  );
}
