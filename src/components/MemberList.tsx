import { useState } from "react";
import {
  useChangeChannelWakes,
  useChannelInfo,
  useChannelMembers,
  useChannelWakes,
  useSetChannelWake,
} from "../hooks/useChannels";
import type { ChannelPerson, WakePolicy } from "../lib/api";
import { useChannelDirectory } from "../hooks/useChannelDirectory";
import { shownAddress } from "../lib/format";
import { Globe, Loader2, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePekoDirectory } from "../hooks/usePekoDirectory";
import PekoAvatar from "./peko/PekoAvatar";
import RuntimeBadge from "./RuntimeBadge";
import type { MemberProvenance } from "../types";

/**
 * PR-1 read-only member list for a single channel. Renders the
 * principals currently in the channel, grouped into "Local" (on
 * this runtime) and "Remote" (on a peer runtime).
 *
 * PR-3b / P1.2 attribution: when the IPC returns `memberProvenance`
 * (parallel array of `{principal, runtimeId}` rows), the list is
 * split by `runtimeId === null` so remote members are visibly
 * attributable. Pre-PR-3b runtimes omit the field and every member
 * is bucketed as local — preserves the PR-1 fallback behavior.
 *
 * Empty provenance ⇒ every member is local. Empty `members` ⇒ the
 * "No members yet" empty state.
 */
export default function MemberList({
  channelId,
  runtimeId,
}: {
  channelId: string;
  runtimeId?: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useChannelMembers(channelId, runtimeId);
  const directory = usePekoDirectory();
  const { data: info } = useChannelInfo(channelId);
  // Wake policy per peko hosted here, by local id (groups only: a DM
  // always wakes on human posts).
  const wakeOf = new Map(
    info?.kind === "group" ? info.pekos.map((p) => [p.localId, p] as const) : [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-fg-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("channel.members.loading")}
      </div>
    );
  }

  // The runtime's roster names everyone once, those on other computers
  // too (runtime ChannelInfo `people`).
  if (info?.people && info.people.length > 0) {
    return <PeopleList channelId={channelId} people={info.people} wakeOf={wakeOf} />;
  }

  const members = data?.members ?? [];
  const provenance = data?.memberProvenance;

  if (members.length === 0) {
    return (
      <div className="p-4 text-xs text-fg-subtle">
        {t("channel.members.empty")}
      </div>
    );
  }

  // Build a lookup so we can tell local vs remote when attribution
  // is present. If attribution is missing, fall back to the PR-1
  // "everyone is local" rendering for back-compat.
  const provenanceByPrincipal = new Map<string, MemberProvenance>();
  provenance?.forEach((row) => provenanceByPrincipal.set(row.principal, row));

  const local: string[] = [];
  const remote: MemberProvenance[] = [];
  for (const principal of members) {
    const row = provenanceByPrincipal.get(principal);
    if (row && row.runtimeId !== null) {
      remote.push(row);
    } else {
      local.push(principal);
    }
    // If `row` is undefined (attribution missing for this principal),
    // we treat the principal as local — matches the PR-1 fallback.
  }

  const hasAttribution = provenanceByPrincipal.size > 0;

  return (
    <div className="p-3">
      <section data-testid="channel-members-local">
        <div className="eyebrow mb-1.5 px-2">
          {t("channel.members.local")}
        </div>
        <ul className="grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
          {local.map((did) => {
            const who = directory.resolve(did);
            const wakePeko = wakeOf.get(did.replace(/^principal:(local:)?/, ""));
            return (
              <li
                key={did}
                title={did}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
                data-testid={`channel-member-${did}`}
              >
                {who.peko ? (
                  <PekoAvatar peko={who.peko} size="sm" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
                    <User className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{who.label}</span>
                  {who.handle && (
                    <span className="ml-1.5 text-xs text-fg-muted" data-testid="member-handle">
                      @{who.handle}
                    </span>
                  )}
                </span>
                {wakePeko ? (
                  <>
                    <WakeLimit channelId={channelId} pekoName={wakePeko.name} />
                    <WakePicker channelId={channelId} pekoName={wakePeko.name} wake={wakePeko.wake} />
                  </>
                ) : (
                  <RuntimeBadge runtimeId="local" />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {remote.length > 0 && (
        <section className="mt-3" data-testid="channel-members-remote">
          <div className="eyebrow mb-1.5 px-2">
            {t("channel.members.remote")}
          </div>
          <ul className="grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {remote.map((row) => (
              <li
                key={row.principal}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
                data-testid={`channel-member-${row.principal}`}
              >
                <Globe className="h-4 w-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate font-medium" title={row.principal}>
                  {directory.resolve(row.principal).label}
                </span>
                <RuntimeBadge
                  runtimeId={row.runtimeId ?? "local"}
                  showLabel={hasAttribution}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
/** Everyone in the group once: on this computer, then elsewhere. */
function PeopleList({
  channelId,
  people,
  wakeOf,
}: {
  channelId: string;
  people: ChannelPerson[];
  wakeOf: Map<string, { name: string; localId: string; wake: WakePolicy }>;
}) {
  const { t } = useTranslation();
  const directory = useChannelDirectory(channelId);
  const here = people.filter((p) => p.here || p.you);
  const elsewhere = people.filter((p) => !p.here && !p.you);
  const row = (p: ChannelPerson) => {
    const who = directory.resolve(p.address);
    const localId = p.address.match(/^principal:local:(.+)$/)?.[1];
    const wakePeko = localId ? wakeOf.get(localId) : undefined;
    return (
      <li
        key={p.address}
        title={shownAddress(p.address)}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
        data-testid={`channel-member-${p.address}`}
      >
        {who.peko ? (
          <PekoAvatar peko={who.peko} size="sm" />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
            <User className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{who.label}</span>
          {who.handle && (
            <span className="ml-1.5 text-xs text-fg-muted" data-testid="member-handle">
              @{who.handle}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-fg-muted">
          {p.kind === "principal" ? t("channel.members.peko") : t("channel.members.person")}
        </span>
        {wakePeko && (
          <>
            <WakeLimit channelId={channelId} pekoName={wakePeko.name} />
            <WakePicker channelId={channelId} pekoName={wakePeko.name} wake={wakePeko.wake} />
          </>
        )}
      </li>
    );
  };
  return (
    <div className="p-3">
      <section data-testid="channel-members-local">
        <div className="eyebrow mb-1.5 px-2">
          {t("channel.members.here")}
        </div>
        <ul className="grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">{here.map(row)}</ul>
      </section>
      {elsewhere.length > 0 && (
        <section className="mt-3" data-testid="channel-members-remote">
          <div className="eyebrow mb-1.5 px-2">
            {t("channel.members.elsewhere")}
          </div>
          <ul className="grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">{elsewhere.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

const WAKE_OPTIONS: WakePolicy[] = ["mention", "human", "off"];

/** A limit as the runtime sends it (`"60"`, `"none"`) for a number field. */
function limitField(limit: string): string {
  return limit === "none" ? "" : limit;
}

/** A number field's text as the runtime takes it; `null` when it is not a whole number. */
function limitValue(field: string): string | null {
  const text = field.trim();
  if (text === "") return "none";
  return /^\d{1,6}$/.test(text) ? String(Number(text)) : null;
}

/**
 * How often other pekos may wake one of your pekos in this group
 * (runtime ADR-128): a small button that shows what is spent of the
 * hourly limit and opens the two numbers. An empty field is no limit.
 * Shows nothing on an engine that does not know the request.
 */
function WakeLimit({ channelId, pekoName }: { channelId: string; pekoName: string }) {
  const { t } = useTranslation();
  const { data: wakes } = useChannelWakes(channelId, pekoName);
  const change = useChangeChannelWakes(channelId);
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState("");
  const [day, setDay] = useState("");
  if (!wakes) return null;
  const perHour = limitValue(hour);
  const perDay = limitValue(day);
  const valid = perHour !== null && perDay !== null;
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        title={t("channel.members.wakeLimit.title", { name: pekoName })}
        data-testid={`wake-limit-${pekoName}`}
        onClick={() => {
          setHour(limitField(wakes.perHour));
          setDay(limitField(wakes.perDay));
          setOpen((o) => !o);
        }}
        className={[
          "rounded-md border px-1.5 py-1 text-[11px] tabular-nums",
          wakes.held > 0 ? "border-warn/40 bg-warn-soft text-fg" : "border-line text-fg-muted hover:bg-surface-sunken",
        ].join(" ")}
      >
        {wakes.perHour === "none"
          ? t("channel.members.wakeLimit.noLimit")
          : t("channel.members.wakeLimit.spent", { spent: wakes.spentHour, limit: wakes.perHour })}
      </button>
      {open && (
        <form
          className="popover absolute right-0 top-full z-10 mt-1 w-64 space-y-2 p-3 text-xs"
          data-testid={`wake-limit-form-${pekoName}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            change.mutate(
              { pekoName, perHour: perHour!, perDay: perDay! },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          <p className="text-fg-soft">{t("channel.members.wakeLimit.intro", { name: pekoName })}</p>
          <label className="flex items-center justify-between gap-2">
            <span>{t("channel.members.wakeLimit.perHour")}</span>
            <input
              inputMode="numeric"
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              placeholder={t("channel.members.wakeLimit.none")}
              aria-label={t("channel.members.wakeLimit.perHour")}
              className="input input-sm w-20 text-right"
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>{t("channel.members.wakeLimit.perDay")}</span>
            <input
              inputMode="numeric"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              placeholder={t("channel.members.wakeLimit.none")}
              aria-label={t("channel.members.wakeLimit.perDay")}
              className="input input-sm w-20 text-right"
            />
          </label>
          <p className="text-fg-muted">
            {t("channel.members.wakeLimit.used", { hour: wakes.spentHour, day: wakes.spentDay })}
          </p>
          {change.error && (
            <p role="alert" className="text-danger">
              {change.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>
              {t("channel.members.wakeLimit.cancel")}
            </button>
            <button type="submit" className="btn-primary btn-sm" disabled={!valid || change.isPending}>
              {t("channel.members.wakeLimit.save")}
            </button>
          </div>
        </form>
      )}
    </span>
  );
}

/**
 * What starts a turn for one of your pekos in this group (ADR-082,
 * ADR-128): posts that address it (the default), also people's posts
 * that address no one, or nothing. Saved as soon as it changes; a
 * refusal (not your peko) shows inline.
 */
function WakePicker({
  channelId,
  pekoName,
  wake,
}: {
  channelId: string;
  pekoName: string;
  wake: WakePolicy;
}) {
  const { t } = useTranslation();
  const setWake = useSetChannelWake(channelId);
  const current = setWake.isPending ? setWake.variables?.wake ?? wake : wake;
  return (
    <span className="flex shrink-0 flex-col items-end">
      <select
        aria-label={t("channel.members.wakeLabel", { name: pekoName })}
        value={current}
        disabled={setWake.isPending}
        title={t(`channel.members.wake.${current}.hint`)}
        onChange={(e) => setWake.mutate({ pekoName, wake: e.target.value as WakePolicy })}
        className="select input-sm w-auto py-1 pr-7 text-[11px] text-fg-soft disabled:opacity-60"
      >
        {WAKE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {t(`channel.members.wake.${o}.label`)}
          </option>
        ))}
      </select>
      {setWake.error && (
        <span role="alert" className="mt-0.5 max-w-[12rem] truncate text-[10px] text-danger" title={setWake.error.message}>
          {setWake.error.message}
        </span>
      )}
    </span>
  );
}
