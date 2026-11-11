import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Hash, Link2, Loader2, Mail, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  channelInfoQuery,
  hasLeftGroup,
  useChannelInfo,
  useChannels,
} from "../../hooks/useChannels";
import { usePrincipals } from "../../hooks/usePrincipals";
import {
  groupInvitationAnswer,
  groupInvitations,
  groupJoin,
  personGroups,
  type GroupInvitation,
} from "../../lib/api";
import { groupMonogram } from "../../lib/format";
import { RailDivider, RailItem, RailPopover } from "./RailItem";

/** How often to look for a group just asked to join. */
export const JOIN_POLL_MS = 1_500;

/**
 * Every group you are in, one tile each in the app rail beside Chats —
 * the groups your pekos are in and the ones you joined from other
 * computers (runtime ADR-092 D2). Invitations wait below them, then the
 * buttons to start a group or join one by link.
 */
export default function GroupRail({ onCreateClick }: { onCreateClick?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const channelId = (params as Record<string, string | undefined>).channelId ?? "";

  const { data: principals } = usePrincipals();
  const principalNames = useMemo(() => (principals ?? []).map((p) => p.name), [principals]);
  const { data: pekoChannels, isLoading } = useChannels(principalNames);

  // Both are empty when this computer isn't signed in to PekoHub.
  const { data: invitations } = useQuery({
    queryKey: ["group-invitations"],
    queryFn: groupInvitations,
    refetchInterval: 30_000,
  });
  const { data: joined } = useQuery({
    queryKey: ["person-groups"],
    queryFn: personGroups,
    refetchInterval: 30_000,
  });

  const channels = useMemo(() => {
    const rows = [...(pekoChannels ?? [])];
    for (const g of joined ?? []) {
      if (!rows.some((r) => r.channelId === g.channelId)) {
        rows.push({ channelId: g.channelId, runtimeId: "local", memberPrincipals: [] });
      }
    }
    return rows;
  }, [pekoChannels, joined]);

  // Groups you left are hidden.
  const infos = useQueries({ queries: channels.map((c) => channelInfoQuery(c.channelId)) });
  const visible = channels.filter((_, i) => !hasLeftGroup(infos[i]?.data, infos[i]?.error));

  function open(selectedId: string, runtimeId: string, memberPrincipals: string[]) {
    // Post as the first of your pekos in the group until you pick another.
    const sender = memberPrincipals[0];
    navigate({
      to: "/channels/$channelId",
      params: { channelId: selectedId },
      search: sender ? { runtimeId, sender } : { runtimeId },
    });
  }

  return (
    <>
      {isLoading && visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2" data-testid="group-rail-loading">
          {[0, 1].map((i) => (
            <span key={i} className="skeleton h-11 w-11 rounded-[22px]" />
          ))}
        </div>
      ) : (
        visible.map((c) => (
          <GroupTile
            key={c.channelId}
            channelId={c.channelId}
            active={c.channelId === channelId}
            onSelect={() => open(c.channelId, c.runtimeId || "local", c.memberPrincipals)}
          />
        ))
      )}

      {(invitations ?? []).map((i) => (
        <InvitationTile key={i.channelId} invitation={i} />
      ))}

      {(visible.length > 0 || (invitations ?? []).length > 0) && <RailDivider />}

      {onCreateClick && (
        <RailItem label={t("layout.rail.newGroup")} variant="action" onClick={onCreateClick} testId="channel-new">
          <Plus className="h-5 w-5" />
        </RailItem>
      )}
      <JoinGroup />
    </>
  );
}

/** One group you are in: its monogram, its name on hover. */
function GroupTile({
  channelId,
  active,
  onSelect,
}: {
  channelId: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { data: info } = useChannelInfo(channelId);
  return (
    <RailItem
      label={info?.name ?? channelId}
      active={active}
      ariaCurrent={active}
      onClick={onSelect}
      testId={`channel-row-${channelId}`}
    >
      {info?.name ? (
        <span className="text-[13px] tracking-tight">{groupMonogram(info.name)}</span>
      ) : (
        <Hash className="h-4 w-4" />
      )}
    </RailItem>
  );
}

/** A group on another computer inviting you: Join or Decline beside it. */
function InvitationTile({ invitation: i }: { invitation: GroupInvitation }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const answer = useMutation({
    mutationFn: (accept: boolean) => groupInvitationAnswer(i.channelId, accept),
    onSuccess: (_, accept) => {
      void qc.invalidateQueries({ queryKey: ["group-invitations"] });
      void qc.invalidateQueries({ queryKey: ["person-groups"] });
      if (!accept) setOpen(false);
    },
  });
  // An accepted invitation becomes a group once its home hears it: look
  // often until it is listed, then open it.
  const accepted = answer.isSuccess && answer.variables === true;
  const { data: joined } = useQuery({
    queryKey: ["person-groups"],
    queryFn: personGroups,
    enabled: accepted,
    refetchInterval: accepted ? JOIN_POLL_MS : false,
  });
  const arrived = accepted && (joined ?? []).some((g) => g.channelId === i.channelId);
  useEffect(() => {
    if (!arrived) return;
    setOpen(false);
    navigate({ to: "/channels/$channelId", params: { channelId: i.channelId }, search: { runtimeId: "local" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  return (
    <div data-testid="group-invitations" className="contents">
      <RailItem
        label={t("layout.rail.invitationLabel", { name: i.name })}
        unread
        buttonRef={anchor}
        onClick={() => setOpen((v) => !v)}
        testId={`invitation-tile-${i.channelId}`}
      >
        <Mail className="h-[18px] w-[18px]" />
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand ring-[3px] ring-surface-rail" />
      </RailItem>
      {open && (
        <RailPopover anchor={anchor.current} onClose={() => setOpen(false)}>
          <div data-testid={`invitation-${i.channelId}`}>
            <div className="eyebrow">{t("layout.rail.invitation")}</div>
            <div className="mt-1.5 truncate text-sm font-semibold text-fg">{i.name}</div>
            <div className="mt-0.5 truncate text-xs text-fg-muted">
              {t("layout.rail.invitationSummary", { count: i.members, inviter: i.inviter })}
            </div>
            {accepted && !arrived && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("layout.rail.joining")}
              </div>
            )}
            {answer.error && (
              <div className="mt-2 text-xs text-danger">
                {String(answer.error instanceof Error ? answer.error.message : answer.error)}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={answer.isPending || accepted}
                onClick={() => answer.mutate(true)}
                className="btn-primary btn-sm flex-1"
              >
                {t("common.join")}
              </button>
              <button
                type="button"
                disabled={answer.isPending || accepted}
                onClick={() => answer.mutate(false)}
                className="btn-secondary btn-sm flex-1"
              >
                {t("common.decline")}
              </button>
            </div>
          </div>
        </RailPopover>
      )}
    </div>
  );
}

/**
 * Join a group by its invite link, or a public one by its ID (runtime
 * ADR-092 D5). The group appears in the rail once its home lets you in.
 */
function JoinGroup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const join = useMutation({
    mutationFn: (value: string) => groupJoin(value.trim()),
    onSuccess: () => {
      setLink("");
      void qc.invalidateQueries({ queryKey: ["person-groups"] });
    },
  });
  // The home lets you in a moment after it hears the request: look for
  // the group often until it arrives, then open it.
  const waitingFor = join.data?.channelId ?? null;
  const { data: joined } = useQuery({
    queryKey: ["person-groups"],
    queryFn: personGroups,
    enabled: !!waitingFor,
    refetchInterval: waitingFor ? JOIN_POLL_MS : false,
  });
  const arrived = !!waitingFor && (joined ?? []).some((g) => g.channelId === waitingFor);
  useEffect(() => {
    if (!arrived || !waitingFor) return;
    setOpen(false);
    join.reset();
    void qc.invalidateQueries({ queryKey: ["channel-info", waitingFor] });
    navigate({
      to: "/channels/$channelId",
      params: { channelId: waitingFor },
      search: { runtimeId: "local" },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, waitingFor]);

  const close = () => {
    setOpen(false);
    join.reset();
  };

  return (
    <>
      <RailItem
        label={t("layout.rail.joinGroup")}
        variant="action"
        buttonRef={anchor}
        onClick={() => (open ? close() : setOpen(true))}
        testId="group-join-open"
      >
        <Link2 className="h-[18px] w-[18px]" />
      </RailItem>
      {open && (
        <RailPopover anchor={anchor.current} onClose={close} className="w-80">
          <form
            data-testid="group-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) join.mutate(link);
            }}
          >
            <div className="text-sm font-semibold text-fg">{t("layout.rail.joinGroup")}</div>
            <p className="field-hint mt-0.5">{t("layout.rail.joinHint")}</p>
            <input
              type="text"
              value={link}
              autoFocus
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://pekohub.ai/g/…"
              className="input mt-3"
              data-testid="group-join-input"
            />
            {join.data && (
              <div className="note-info mt-3 text-xs" data-testid="group-join-asked">
                {t("layout.rail.joinAsked", { name: join.data.name })}
              </div>
            )}
            {join.error && (
              <div className="note-danger mt-3 text-xs">
                {String(join.error instanceof Error ? join.error.message : join.error)}
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-ghost btn-sm">
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={!link.trim() || join.isPending}
                className="btn-primary btn-sm"
              >
                {join.isPending ? t("layout.rail.asking") : t("common.join")}
              </button>
            </div>
          </form>
        </RailPopover>
      )}
    </>
  );
}
