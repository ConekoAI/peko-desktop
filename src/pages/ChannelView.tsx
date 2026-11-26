import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { markSeen } from "../lib/unread";
import { Trans, useTranslation } from "react-i18next";
import ChannelHeader from "../components/ChannelHeader";
import ChannelComposer from "../components/ChannelComposer";
import ChannelEventRow from "../components/ChannelEventRow";
import BoardPanel from "../components/BoardPanel";
import HeldWakes from "../components/HeldWakes";
import ChannelInviteModal from "../components/modals/ChannelInviteModal";
import ChannelLeaveConfirmModal from "../components/modals/ChannelLeaveConfirmModal";
import ChannelInviteToast, {
  type InviteToastItem,
} from "../components/ChannelInviteToast";
import {
  useChannel,
  useChannelMembers,
  useChannelLeave, LOCAL_USER } from "../hooks/useChannels";
import {
  useChannelEvents,
  useChannelEventsWatch,
  useChannelStreamInvalidator,
} from "../hooks/useChannelEvents";
import { useToastQueue } from "../hooks/useToastQueue";
import { usePrincipals } from "../hooks/usePrincipals";
import { isChannelForbidden } from "../lib/channelErrors";
import { groupHistoryOlder, personDms, personGroups } from "../lib/api";
import { personLabel } from "../lib/people";
import type { Answers, ChannelEvent } from "../types";
import { useChannelPost } from "../hooks/useChannelPost";
import { groupCardStates } from "../lib/questions";
import { foldReactions, showsQuote } from "../lib/reactions";
import { channelReact } from "../lib/api";
import { useChannelDirectory } from "../hooks/useChannelDirectory";

/**
 * Channel view. PR-1 read-only + PR-2a composer + PR-3
 * create/invite/leave surface.
 *
 * `useChannelStreamInvalidator` drives two concerns:
 *   1. invalidate `["channel-events", channelId]` on inbound events
 *      (auto-refresh)
 *   2. show a transient `ChannelInviteToast` when the runtime emits
 *      a `peko-stream` event whose inner `payload.payload.kind ===
 *      "channel_invite_received"` — the user's first signal that
 *      they were added to a remote channel.
 *
 * The PR-3 modals (Invite / Leave) hoist from this page so the
 * header buttons stay presentational. `useChannelLeave` is called
 * directly here (rather than from the modal) because the page is
 * the navigation-aware owner — on a successful leave it sends the
 * user back to `/channels`.
 */
export default function ChannelView() {
  const { t } = useTranslation();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false }) as {
    runtimeId?: string;
    sender?: string;
  };
  const navigate = useNavigate();
  const channelId =
    (params as Record<string, string | undefined>).channelId ?? "";
  const runtimeId = search.runtimeId;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // P1.6: toast queue replaces the single-slot state. Inbound invites
  // append to the tail; the head is rendered. The hook auto-dismisses
  // after 6s and rotates the head on dismiss.
  const inviteToastQueue = useToastQueue<InviteToastItem>();
  const inviteToast = inviteToastQueue.current;

  useChannelStreamInvalidator(channelId, runtimeId, (incomingChannelId) => {
    inviteToastQueue.enqueue({ channelId: incomingChannelId });
  });

  const {
    data: events,
    isLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = useChannelEvents(channelId, null, runtimeId);
  // PR-2b: kick off the long-lived `ChannelEventsWatch` subscription
  // for this channel. The runtime replays events from the start of
  // the log (since=null) then forwards live events via the
  // `peko-stream` Tauri event channel — `useChannelStreamInvalidator`
  // (above) is the listener half and invalidates the matching query
  // keys. The hook is best-effort: failures log a `console.warn`
  // and the page falls back to the `refetchInterval` polling path
  // baked into `useChannelEvents`.
  useChannelEventsWatch(channelId, null, runtimeId);
  // What is on screen is read (runtime ADR-108 D5): your phone and your
  // other computers are told, and this group's dot clears.
  const newestAt = events && events.length > 0 ? events[events.length - 1].at : undefined;
  useEffect(() => {
    const read = () => {
      if (document.hasFocus()) markSeen(channelId, newestAt);
    };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [channelId, newestAt]);
  const { data: detail } = useChannel(channelId, runtimeId);
  const { data: membersData } = useChannelMembers(channelId, runtimeId);
  const { data: principals } = usePrincipals();

  // Local membership: derived from `useChannelMembers` + the local
  // principal set. A local principal that matches a `ChannelMembers`
  // row means the user can post + invite + leave.
  const localPrincipals = principals ?? [];
  // Rosters name actors by id (`user:local`, `principal:<id>`), not by
  // peko name: compared with names, you never counted as a member.
  const memberSet = new Set(membersData?.members ?? []);
  const isMember = memberSet.has(LOCAL_USER);
  const isCreator = !!detail && localPrincipals.some(
    (p) => p.name === detail.creator,
  );

  const leaveMut = useChannelLeave(channelId, runtimeId);

  // Runtime ADR-092 D3: in a group you joined from another computer, this
  // copy goes back as far as it caught up; earlier messages come from the
  // group's home on request, and aren't stored here.
  const { data: joinedGroups } = useQuery({ queryKey: ["person-groups"], queryFn: personGroups });
  // Runtime ADR-095 D6: a DM with another person. No peko is in it; until
  // they accept, what you write stays on your computers.
  const { data: people } = useQuery({
    queryKey: ["person-dms"],
    queryFn: personDms,
    refetchInterval: 15_000,
  });
  const person = (people ?? []).find((p) => p.channelId === channelId) ?? null;
  const personNames = useMemo(
    () => (person ? { [person.peer]: personLabel(person) } : undefined),
    [person],
  );
  const fromAnotherComputer = (joinedGroups ?? []).some((g) => g.channelId === channelId);
  const [older, setOlder] = useState<ChannelEvent[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  useEffect(() => {
    setOlder([]);
    setOlderDone(false);
    setOlderError(null);
  }, [channelId]);
  const shown = useMemo(() => [...older, ...(events ?? [])], [older, events]);
  // Question cards (runtime ADR-114): open until answered or replaced.
  const cardStates = useMemo(
    () =>
      groupCardStates(
        shown.map((e) =>
          e.kind === "posted"
            ? {
                author: e.author,
                msgId: e.msg_id,
                root: e.parent == null,
                ask: e.ask,
                answers: e.answers,
              }
            : { author: "" },
        ),
      ),
    [shown],
  );
  // Runtime ADR-126: reactions folded from the log, the quote above a
  // reply (not when it directly follows its message), and the post you
  // reply to.
  const reactions = useMemo(() => foldReactions(shown), [shown]);
  const directory = useChannelDirectory(channelId, personNames);
  const posts = useMemo(() => {
    const map = new Map<string, Extract<ChannelEvent, { kind: "posted" }>>();
    for (const e of shown) if (e.kind === "posted" && !e.react && e.msg_id) map.set(e.msg_id, e);
    return map;
  }, [shown]);
  const [replying, setReplying] = useState<{ msgId: string; author: string; text: string } | null>(null);
  const [reactError, setReactError] = useState<string | null>(null);
  useEffect(() => setReplying(null), [channelId]);
  function quoteAt(i: number): { author: string; text: string } | null | undefined {
    const e = shown[i];
    if (e.kind !== "posted" || !e.reply_to) return undefined;
    let previous: string | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const p = shown[j];
      if (p.kind === "posted" && !p.react) {
        previous = p.msg_id;
        break;
      }
    }
    if (!showsQuote(e.reply_to, previous)) return undefined;
    const quoted = posts.get(e.reply_to);
    return quoted ? { author: directory.resolve(quoted.author).label, text: quoted.text } : null;
  }
  async function react(msgId: string, emoji: string, remove: boolean) {
    setReactError(null);
    try {
      await channelReact(channelId, msgId, emoji, remove);
      await refetchEvents();
    } catch (err) {
      setReactError(err instanceof Error ? err.message : String(err));
    }
  }
  function jumpTo(msgId: string) {
    document
      .querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const canPost = isMember || !!person;
  const answerPost = useChannelPost(runtimeId);
  async function answer(text: string, answers: Answers) {
    await answerPost.mutateAsync({ channelId, senderName: null, text, parent: null, answers });
  }
  const oldestId = useMemo(() => {
    for (const e of shown) {
      if (e.kind === "posted" && e.msg_id) return e.msg_id;
    }
    return null;
  }, [shown]);
  async function loadOlder() {
    if (!oldestId || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await groupHistoryOlder(channelId, oldestId);
      setOlder((prev) => [...page.events, ...prev]);
      if (!page.hasMore) setOlderDone(true);
    } catch (err) {
      setOlderError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [events?.length]);

  // Computed outside the JSX: the `isChannelForbidden` type guard
  // narrows `eventsError` to `never` in the generic branch.
  const eventsErrorMessage =
    eventsError == null
      ? null
      : eventsError instanceof Error
        ? eventsError.message
        : String(eventsError);

  function handleLeaveConfirm() {
    // You leave the group yourself; your pekos stay.
    leaveMut.mutate(
      { principalName: null },
      {
        onSuccess: () => {
          setLeaveOpen(false);
          navigate({ to: "/channels" });
        },
      },
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {person ? (
        <ChannelHeader
          channelId={channelId}
          runtimeId={runtimeId}
          isMember={isMember}
          title={personLabel(person)}
        />
      ) : (
        <ChannelHeader
          channelId={channelId}
          runtimeId={runtimeId}
          isMember={isMember}
          isCreator={isCreator}
          onInviteClick={() => setInviteOpen(true)}
          onLeaveClick={() => setLeaveOpen(true)}
        />
      )}

      {/* Runtime ADR-101: a group's board; a DM has none. */}
      {!person && isMember && <BoardPanel channelId={channelId} />}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-3 py-4"
        data-testid="channel-events"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-fg-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("channel.view.loading")}
          </div>
        ) : eventsError ? (
          isChannelForbidden(eventsError) ? (
            <div
              className="mx-auto my-6 max-w-md rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-xs text-warn"
              role="alert"
              aria-live="assertive"
              data-testid="channel-events-forbidden"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">
                    {t("channel.view.forbiddenTitle")}
                  </p>
                  <p className="mt-1 opacity-80">
                    {t("channel.view.forbiddenBody")}
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <div
            className="mx-auto my-6 max-w-md rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-xs text-danger"
            role="alert"
            aria-live="assertive"
            data-testid="channel-events-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{t("channel.view.loadFailed")}</p>
                <p className="mt-1 opacity-80">
                  {eventsErrorMessage}
                </p>
                <button
                  type="button"
                  onClick={() => void refetchEvents()}
                  className="btn-danger btn-xs mt-2 border border-danger/40"
                  data-testid="channel-events-retry"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t("common.retry")}
                </button>
              </div>
            </div>
          </div>
          )
        ) : events && events.length > 0 ? (
          <>
            {fromAnotherComputer && oldestId && !olderDone && (
              <div className="mb-3 flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="btn-secondary btn-xs rounded-full px-3"
                >
                  {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t("common.loadEarlier")}
                </button>
                {olderError && <span className="text-xs text-danger">{olderError}</span>}
              </div>
            )}
            <ul className="space-y-1">
              {shown.map((e, i) =>
                e.kind === "posted" && e.react ? null : (
                  <li
                    key={i}
                    data-testid="channel-event-row"
                    data-msg-id={e.kind === "posted" ? e.msg_id : undefined}
                  >
                    <ChannelEventRow
                      event={e}
                      people={personNames}
                      channelId={channelId}
                      card={cardStates[i]}
                      onAnswer={canPost ? answer : undefined}
                      reactions={e.kind === "posted" && e.msg_id ? reactions.get(e.msg_id) : undefined}
                      quote={quoteAt(i)}
                      onJumpToQuote={
                        e.kind === "posted" && e.reply_to ? () => jumpTo(e.reply_to!) : undefined
                      }
                      onReply={
                        canPost && e.kind === "posted" && e.msg_id && !e.board
                          ? () =>
                              setReplying({
                                msgId: e.msg_id!,
                                author: directory.resolve(e.author).label,
                                text: e.text,
                              })
                          : undefined
                      }
                      onReact={
                        canPost && e.kind === "posted" && e.msg_id && !e.board
                          ? (emoji, remove) => void react(e.msg_id!, emoji, remove)
                          : undefined
                      }
                    />
                  </li>
                ),
              )}
            </ul>
          </>
        ) : (
          <div
            className="mx-auto my-12 max-w-md text-center"
            data-testid="channel-events-empty"
          >
            <div className="mb-2 text-sm text-fg-muted">
              {t("channel.view.empty")}
            </div>
            {person ? (
              <div className="text-xs text-fg-subtle">
                <Trans
                  i18nKey="channel.view.sayHello"
                  values={{ name: personLabel(person) }}
                  components={{ strong: <strong /> }}
                />
              </div>
            ) : (
              detail?.name && (
                <div className="text-xs text-fg-subtle">
                  <Trans
                    i18nKey="channel.view.beFirst"
                    values={{ name: detail.name }}
                    components={{ strong: <strong /> }}
                  />
                </div>
              )
            )}
            {!isMember && !person && (
              <div className="mt-3 text-xs text-fg-subtle">
                {t("channel.view.askInvite")}
              </div>
            )}
          </div>
        )}
      </div>

      {person?.waiting && (
        <div
          className="border-t border-line bg-surface-raised px-5 py-2 text-xs text-fg-subtle"
          data-testid="person-dm-waiting"
        >
          {t("channel.view.waitingAccept", { name: personLabel(person) })}
        </div>
      )}
      {isMember || person ? (
        <>
          {reactError && <p className="px-4 text-xs text-danger">{reactError}</p>}
          {/* Runtime ADR-128: posts to one of your pekos held by its wake limit. */}
          {!person && <HeldWakes channelId={channelId} />}
          <ChannelComposer
            channelId={channelId}
            channelName={person ? personLabel(person) : detail?.name}
            runtimeId={runtimeId}
            withPerson={!!person}
            replying={replying}
            onReplyDone={() => setReplying(null)}
          />
        </>
      ) : (
        <div
          className="m-4 mt-2 rounded-xl border border-line bg-surface-raised px-4 py-3 text-center text-xs text-fg-muted"
          data-testid="channel-composer-no-sender"
        >
          {t("channel.view.readOnly")}
        </div>
      )}

      <ChannelInviteModal
        open={inviteOpen}
        channel={channelId}
        detail={detail ?? null}
        members={membersData ?? null}
        onClose={() => setInviteOpen(false)}
      />

      <ChannelLeaveConfirmModal
        open={leaveOpen}
        channelId={channelId}
        channelName={detail?.name}
        // You leave as yourself; the creator is one of your pekos.
        isCreator={false}
        onConfirm={handleLeaveConfirm}
        onCancel={() => setLeaveOpen(false)}
      />

      {inviteToast && (
        <ChannelInviteToast
          item={inviteToast}
          runtimeId={runtimeId}
          pendingCount={inviteToastQueue.pendingCount}
          onDismiss={inviteToastQueue.dismiss}
        />
      )}
    </div>
  );
}