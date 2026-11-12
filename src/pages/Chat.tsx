import { Fragment, useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import {
  usePrincipals,
  usePrincipalSend,
  usePrincipalLog,
  usePrincipalLogWatch,
  usePrincipalApprovals,
  useDecideApproval,
  useCallerSubject,
  newestLogCursor,
  fetchOlderPrincipalLog,
} from "../hooks/usePrincipals";
import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";
import { requestPekohubSignIn } from "../lib/pekohubSignIn";
import { usePekohubBundle } from "../hooks/useRuntimes";
import Composer, { type ComposerModel } from "../components/chat/Composer";
import {
  MAX_ATTACHMENTS,
  MessageAttachments,
  baseName,
} from "../components/chat/Attachments";
import { useFileDrop } from "../hooks/useFileDrop";
import { attachmentStage, pickAttachments } from "../lib/api";
import { useModels, useRemotePekoModels } from "../hooks/useModels";
import { saveModelChoice, savedModelChoice } from "../lib/modelChoice";
import {
  useRemotePeko,
  useRemotePrincipals,
  useUndeliveredMessages,
} from "../hooks/useRemotePrincipals";
import PekoAvatar from "../components/peko/PekoAvatar";
import SetupPanel from "../components/peko/SetupPanel";
import PrincipalProfileModal from "../components/modals/PrincipalProfileModal";
import { pekoIdentity, type PekoIdentity } from "../lib/pekoIdentity";
import { shownAddress, timeAgo } from "../lib/format";
import {
  Loader2,
  MessageCircle,
  X,
  User,
  Plus,
  Check,
  Copy,
  RotateCcw,
  Paperclip,
  Clock,
  Moon,
} from "lucide-react";
import Markdown from "../components/chat/Markdown";
import { copyText } from "../components/chat/copy";
import type {
  ApprovalRequest,
  ChatLogAttachment,
  ChatLogMessage,
  RunFailure,
  StreamEvent,
} from "../types";
import type { ChatStreamMsg } from "../lib/api";
import { currentLocale, t as translate } from "../i18n";

interface ChatItem {
  event: StreamEvent;
  isUser: boolean;
  /** A message sent while the peko was working, shown after its reply. */
  queued?: boolean;
  /** Files sent with the message. */
  attachments?: ChatLogAttachment[];
  /** Replies the peko suggested with this message (runtime ADR-093). */
  options?: string[];
  /** The post's own id (a remote peko's thread), to match undelivered ones. */
  msgId?: string;
}

/**
 * Over the composer while a peko's computer is offline: it can't work
 * until that computer is back, and what you send waits for it (the
 * runtime keeps it and delivers it then). Its answer arrives as a
 * notification.
 */
function HostOfflineNotice({
  peko,
  computer,
  lastSeenAt,
}: {
  peko: string;
  computer: string;
  lastSeenAt: string | null;
}) {
  const ago = lastSeenAt ? timeAgo(lastSeenAt) : "";
  return (
    <div
      role="status"
      data-testid="host-offline"
      className="flex items-start gap-2 border-t border-line bg-surface-raised px-5 py-2 text-xs text-fg-muted"
    >
      <Moon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <Trans
          i18nKey={ago ? "chat.hostOfflineSince" : "chat.hostOffline"}
          values={{ peko, ago }}
          components={{ computer: <span className="font-medium text-fg">{computer}</span> }}
        />
      </p>
    </div>
  );
}

/** The error a stream ends with when the run was stopped (`peko stop`). */
const STOPPED_BY_USER = "stopped by user";

function formatTime(ts?: string) {
  if (!ts) return "";
  const ms = Number(ts);
  if (!isNaN(ms) && ms > 1000000000000) {
    return new Date(ms).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  }
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

function ChatMessage({
  item,
  peko,
  onRetry,
  onPick,
  waitingFor,
}: {
  item: ChatItem;
  /**
   * Set on your message that hasn't reached the peko yet: the computer it
   * waits for (asleep or off), named as it names itself.
   */
  waitingFor?: string;
  /** The reply's author. */
  peko: PekoIdentity;
  /** Present on the latest reply: send the message before it again. */
  onRetry?: () => void;
  /**
   * Present while this reply is the thread's latest: send one of its
   * suggested replies as your own message.
   */
  onPick?: (reply: string) => void;
}) {
  const { event, isUser } = item;
  const isError = event.type === "error";
  const { t } = useTranslation();
  const text = event.content ?? "";
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="group relative flex w-full gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface-raised">
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-peko-800 text-peko-100">
            <User className="h-4 w-4" />
          </div>
        ) : isError ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-danger-soft">
            <X className="h-4 w-4 text-danger" />
          </div>
        ) : (
          <PekoAvatar peko={peko} size="md" />
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-fg">
            {isUser ? t("common.you") : isError ? t("common.error") : peko.name}
          </span>
          <span className="text-[11px] text-fg-subtle">
            {formatTime(event.timestamp)}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-fg">
          {isUser ? (
            text && <p className="whitespace-pre-wrap break-words">{text}</p>
          ) : isError ? (
            <p className="whitespace-pre-wrap break-words text-danger">{text}</p>
          ) : (
            <Markdown>{text}</Markdown>
          )}
          {item.attachments && <MessageAttachments attachments={item.attachments} />}
        </div>
        {waitingFor && (
          <p
            className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-subtle"
            data-testid="message-waiting"
          >
            <Clock className="h-3 w-3" />
            {t("chat.waitingFor", { name: waitingFor })}
          </p>
        )}
        {onPick && item.options && item.options.length > 0 && (
          <SuggestedReplies replies={item.options} onPick={onPick} />
        )}
        {/* Floats over the message on hover, like Slack: it takes no
            room, so messages sit close together. */}
        {!item.queued && text && (
          <div className="absolute -top-3 right-3 flex gap-0.5 rounded-lg border border-line bg-surface-card p-0.5 opacity-0 shadow-pop transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <MessageAction label={copied ? t("common.copied") : t("common.copy")} onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </MessageAction>
            {onRetry && (
              <MessageAction label={t("common.retry")} onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" />
              </MessageAction>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Replies the peko suggested (runtime ADR-093), under its latest
 * message. A tap sends the reply's text as your message, exactly as if
 * you typed it; the composer stays free for anything else. Plain
 * outlined pills, unlike the approval card: they decide nothing.
 */
function SuggestedReplies({
  replies,
  onPick,
}: {
  replies: string[];
  onPick: (reply: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("chat.suggestedReplies")}
      data-testid="suggested-replies"
      className="mt-2 flex flex-wrap gap-1.5"
    >
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          onClick={() => onPick(reply)}
          className="rounded-full border border-line-strong bg-surface-card px-3 py-1 text-xs font-medium text-fg-soft transition-colors hover:border-peko-400/60 hover:bg-brand-soft hover:text-fg"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}

function MessageAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
    >
      {children}
      {label}
    </button>
  );
}

/**
 * Fold the streamed text of one agentic iteration into the reply. A
 * reply is one bubble: a new iteration's text replaces the previous
 * one's (the engine records only the last iteration's text as the
 * reply), so what streams is what the thread keeps.
 */
export function foldReplyText(current: string, delta: string, newIteration: boolean): string {
  return newIteration ? delta : current + delta;
}

/** A short, plain phrase for why a run is waiting or failed. */
export function runFailureLine(failure: RunFailure, now: Date = new Date()): string {
  const reason =
    failure.kind === "peko_limit" ||
    failure.kind === "provider_quota" ||
    failure.kind === "provider_unreachable"
      ? translate(`chat.runFailure.reason.${failure.kind}`)
      : failure.message;
  if (failure.nextAttemptAt) {
    const next = new Date(failure.nextAttemptAt);
    const sameDay = next.toDateString() === now.toDateString();
    const when = next.toLocaleString(currentLocale(), {
      ...(sameDay ? {} : { month: "short", day: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
    });
    return translate("chat.runFailure.waiting", { reason, when });
  }
  return translate("chat.runFailure.failed", { reason });
}

/** Seconds since `since`, ticking once a second while `live`. */
function useElapsed(since: number | null, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/** Who is asking, as the card names them. */
function askerName(request: ApprovalRequest): string {
  const address = shownAddress(request.actor);
  return request.actorName
    ? translate("chat.approval.asker", { name: request.actorName, address })
    : address;
}

/**
 * The requests waiting for you, the peko's owner: what someone else
 * asked it to do that its policy left to you. Approve runs exactly
 * that call for them; Always also adds a standing rule to POLICY.md.
 */
function ApprovalCards({
  peko,
  runtimeId,
  requests,
}: {
  peko: string;
  runtimeId: string;
  requests: ApprovalRequest[];
}) {
  const { t } = useTranslation();
  const decide = useDecideApproval();
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const id = window.setTimeout(() => setOutcome(null), 6000);
    return () => window.clearTimeout(id);
  }, [outcome]);

  async function act(id: string, approve: boolean, always = false) {
    try {
      setOutcome(await decide.mutateAsync({ name: peko, id, approve, always, runtimeId }));
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : String(err));
    }
  }

  if (requests.length === 0 && !outcome) return null;
  return (
    <div className="space-y-2 border-t border-line bg-surface px-4 pt-3" data-testid="approval-cards">
      {requests.map((r) => (
        <div key={r.id} className="rounded-xl border border-warn/25 bg-warn-soft p-3.5 text-sm">
          {r.kind === "owner_task" ? (
            <>
              <p className="text-fg">
                {t("chat.approval.ownerTask", {
                  peko,
                  where: r.reason || t("chat.approval.ownerTaskWhere"),
                })}
              </p>
              <p
                className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface p-2.5 text-xs text-fg"
                data-testid="owner-task-brief"
              >
                {r.summary}
              </p>
            </>
          ) : (
            <>
              <p className="text-fg">
                <Trans
                  i18nKey="chat.approval.toolRequest"
                  values={{ peko }}
                  components={{
                    asker: <span className="font-medium">{askerName(r)}</span>,
                    summary: <span className="font-mono text-xs">{r.summary.replace(/`/g, "")}</span>,
                  }}
                />
              </p>
              {r.reason && <p className="mt-1 text-xs text-fg-muted">{r.reason}</p>}
            </>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void act(r.id, true)}
              className="btn-primary btn-sm"
            >
              {t("chat.approval.approve")}
            </button>
            {r.kind !== "owner_task" && (
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => void act(r.id, true, true)}
                title={t("chat.approval.alwaysTitle", { name: r.actorName ?? r.actor })}
                className="btn-secondary btn-sm"
              >
                {t("chat.approval.always")}
              </button>
            )}
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void act(r.id, false)}
              className="btn-secondary btn-sm"
            >
              {t("chat.approval.deny")}
            </button>
          </div>
        </div>
      ))}
      {outcome && <p className="text-xs text-fg-muted">{outcome}</p>}
    </div>
  );
}

/**
 * Map the runtime-owned chat log directly onto chat bubbles. Each
 * `ChatLogMessage` is one immutable line, so the projection is a
 * flat map — no session-internal `kind` filter, no `role` mapping,
 * no merging across `kind` boundaries. The chat log is the only
 * source of truth for what the user and the principal exchanged.
 *
 * Sender identity: a `user:*` sender renders as a user bubble;
 * anything else (typically `principal:<did>`) renders as the
 * principal's bubble. This matches the runtime's `Subject` tagging
 * and keeps the projection safe even for principal-to-principal
 * exchanges the chat page renders as a single timeline.
 *
 * Exported for unit testing so the mapping stays decoupled from
 * React rendering.
 */
export function chatLogMessagesToChatItems(
  messages: ChatLogMessage[],
): ChatItem[] {
  const out: ChatItem[] = [];
  for (const m of messages) {
    const attachments = m.attachments ?? [];
    if (!m.text && attachments.length === 0) continue;
    const isUser = m.sender.startsWith("user:");
    const options = isUser ? [] : (m.options ?? []);
    out.push({
      event: {
        type: "chunk",
        content: m.text,
        timestamp: m.timestamp,
      } as StreamEvent,
      isUser,
      ...(m.msgId && { msgId: m.msgId }),
      ...(attachments.length > 0 && { attachments }),
      ...(options.length > 0 && { options }),
    });
  }
  return out;
}

function PrincipalToolbar({
  peko,
  runtimeId,
  description,
  computer,
}: {
  peko: PekoIdentity;
  runtimeId: string;
  description?: string | null;
  /** The other computer it runs on, when it isn't this one. */
  computer?: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        title={t("peko.remote.profileLabel", { name: peko.name })}
        className="-mx-1.5 flex min-w-0 items-center gap-3 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-sunken"
      >
        <PekoAvatar peko={peko} size="md" />
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-fg">{peko.name}</h3>
          <p className="truncate text-xs leading-tight text-fg-muted">
            {description || t("chat.yourPeko")}
            {computer && <span data-testid="peko-computer"> {t("chat.onComputer", { computer })}</span>}
          </p>
        </div>
      </button>
      <PrincipalProfileModal
        open={profileOpen}
        principalName={peko.name}
        runtimeId={runtimeId}
        onClose={() => setProfileOpen(false)}
        onRemoved={() => navigate({ to: "/chat", replace: true })}
      />
    </div>
  );
}

/**
 * Principal chat surface.
 *
 * The principal sends through `principal_send_stream` IPC. There is no
 * external session concept (ADR-042): the runtime allocates a session
 * id per principal on first send and persists the streamed exchange
 * as a single thread. The `history` route (`peko log <PRINCIPAL>`)
 * reads it back via `principal_log` with the privacy gate.
 */
export default function Chat() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const params = useParams({ strict: false });
  // The whole URL's search, not one route match's: this page renders at
  // the `/chat` level (`routes/chat.tsx`), where `runtimeId` and `say` —
  // declared by the child `/chat/$pekoName` — would read as absent, and a
  // peko on another computer would bounce back to `/chat` as a missing
  // local one.
  const search = routerState.location.search as Record<string, string | undefined>;
  const pathname = routerState.location.pathname;
  const [createOpen, setCreateOpen] = useState(false);
  // A fresh computer with no peko of its own: point to signing in, which
  // brings the person's pekos on their other computers here.
  const { data: hubBundle } = usePekohubBundle();
  const signedInToHub = hubBundle !== null && hubBundle !== undefined;

  const runtimeId = search.runtimeId ?? "local";

  const { data: principals, isLoading } = usePrincipals();

  let principalName: string | undefined;
  if (pathname === "/" || pathname === "/chat") {
    principalName = undefined;
  } else if (pathname.startsWith("/chat/")) {
    const parts = pathname.split("/").filter(Boolean);
    principalName = parts[1];
  }
  const paramName = (params as Record<string, string | undefined>).pekoName;
  if (paramName) principalName = paramName;

  const selectedPrincipal = principalName ?? principals?.[0]?.name ?? "";
  // A peko on another runtime, reached through a hub: its face comes
  // from the hub's record, and the header names its owner.
  const remote = useRemotePeko(runtimeId, selectedPrincipal);
  const remotePeko = remote.record;
  const { data: remotePrincipals } = useRemotePrincipals();
  const localFace = useMemo(
    () =>
      pekoIdentity(
        principals?.find((p) => p.name === selectedPrincipal) ?? { name: selectedPrincipal },
      ),
    [principals, selectedPrincipal],
  );
  const pekoFace = remotePeko ? remote.identity : localFace;

  const sendMut = usePrincipalSend();
  const callerSubject = useCallerSubject();
  // ADR-042: scope the chat-history read to the caller's peer thread so
  // the desktop shows only the conversation between `selectedPrincipal`
  // and the active user. The runtime enforces ownership / Chat grants;
  // if the caller is the owner it returns the merged thread, otherwise
  // just the caller's own thread.
  const logQuery = usePrincipalLog(selectedPrincipal || undefined, callerSubject, runtimeId);
  const logData = logQuery.data;

  // New DM rows (replies to queued messages, cron posts, approval
  // requests, stop markers) refresh the thread while it is open.
  // It starts once the thread has loaded (or failed to — a new peko
  // has no thread yet), from the newest row already shown.
  const logWatch = usePrincipalLogWatch(
    selectedPrincipal || undefined,
    callerSubject,
    runtimeId,
    logQuery.isSuccess || logQuery.isError ? newestLogCursor(logData?.messages) : undefined,
  );

  // A local peko that no longer exists (removed here or elsewhere):
  // leave its address instead of showing a stale thread. The cached
  // list is the authority: removing and creating update it at once, so
  // this does not wait for a refetch (which a busy engine can hold up).
  const missingLocalPeko =
    runtimeId === "local" &&
    !!principalName &&
    !!principals &&
    !principals.some((p) => p.name === principalName);
  useEffect(() => {
    if (missingLocalPeko) navigate({ to: "/chat", replace: true });
  }, [missingLocalPeko, navigate]);

  useEffect(() => {
    if ((pathname === "/" || pathname === "/chat") && selectedPrincipal) {
      navigate({
        to: "/chat/$pekoName",
        params: { pekoName: selectedPrincipal },
        search: { runtimeId },
      });
    }
  }, [pathname, selectedPrincipal, navigate, runtimeId]);

  const [input, setInput] = useState("");
  // Files going with the next message (paths on this computer).
  const [pendingFiles, setPendingFiles] = useState<string[]>([]);
  // The engine reads attachments from this computer; a peko on another
  // computer gets them through PekoHub (runtime ADR-094: at most 10 MB a
  // file and 25 MB a message — the runtime says so when a file is over).
  const canAttach = !!selectedPrincipal && (runtimeId === "local" || !!remotePeko);
  function addFiles(paths: string[]) {
    setPendingFiles((prev) =>
      [...prev, ...paths.filter((p) => !prev.includes(p))].slice(0, MAX_ATTACHMENTS),
    );
  }
  const dragging = useFileDrop(canAttach, addFiles);
  async function pasteFiles(files: File[]) {
    try {
      addFiles(await Promise.all(files.map(attachmentStage)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function chooseFiles() {
    try {
      addFiles(await pickAttachments());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  // `chatItems` holds live items (sends + streamed chunks) added during
  // the current session. Historical messages from `principal_log` are
  // merged in `displayItems` below so they survive principal switches
  // and don't clobber in-flight streaming.
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  // Messages sent while the peko is busy, shown after the live reply.
  const [queuedItems, setQueuedItems] = useState<ChatItem[]>([]);
  // Number of sends still waiting on the runtime. Only one of them is
  // ever streaming; the rest settle as `queued`.
  const [activeSends, setActiveSends] = useState(0);
  const activeSendsRef = useRef(0);
  const isStreaming = activeSends > 0;
  // When the peko started on the message it is working on.
  const [workStartedAt, setWorkStartedAt] = useState<number | null>(null);
  const workingSecs = useElapsed(workStartedAt, isStreaming);
  // The model for the next message; `null` is the peko's own. Each
  // peko keeps its own pick (`lib/modelChoice`), across switches and
  // restarts.
  const [modelChoice, setModelChoiceState] = useState<string | null>(() =>
    savedModelChoice(selectedPrincipal, runtimeId),
  );
  function setModelChoice(model: string | null) {
    setModelChoiceState(model);
    if (selectedPrincipal) saveModelChoice(selectedPrincipal, runtimeId, model);
  }
  const { data: models } = useModels();
  // A peko of yours on another computer runs on that computer's models
  // (runtime ADR-097); other people's pekos offer no pick.
  const ownRemote = runtimeId !== "local" && !!remotePeko?.fromAccount;
  // A peko on another computer works only while that computer is on: say
  // so while it is offline, and mark what you sent that hasn't reached it.
  const hostLabel = remotePeko?.runtimeName || t("chat.pekosComputer", { name: pekoFace.name });
  const hostOffline = !!remotePeko && remote.status.data?.status === "offline";
  const undelivered = useUndeliveredMessages(runtimeId, selectedPrincipal, !!remotePeko, hostOffline);
  const waiting = useMemo(() => new Set(undelivered.data ?? []), [undelivered.data]);
  const { data: hostModels } = useRemotePekoModels(runtimeId, selectedPrincipal, ownRemote);
  const composerModels = useMemo<ComposerModel[]>(() => {
    if (runtimeId === "local") {
      return (models ?? [])
        .filter((m) => m.enabled)
        .map((m) => ({ id: m.id, displayName: m.displayName || m.id }));
    }
    return ownRemote ? (hostModels ?? []) : [];
  }, [runtimeId, ownRemote, models, hostModels]);
  // A remembered pick that is not offered (yet, or any more) shows and
  // sends as the peko's own model; it stays remembered in case it comes
  // back.
  const effectiveModel =
    modelChoice && composerModels.some((m) => m.id === modelChoice) ? modelChoice : null;
  // How the peko works — thinking, tools, steps — stays inside it; the
  // chat shows only that it is working. `awaitingToken` is true while
  // no text of the current step has arrived yet (the indicator shows),
  // and `newIterationRef` makes the next step's text replace the
  // reply's instead of adding to it.
  const [awaitingToken, setAwaitingToken] = useState(true);
  const newIterationRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Messages older than the latest page, loaded on demand (oldest
  // first), and the cursor for the next older page.
  const [older, setOlder] = useState<ChatLogMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Keeps the view on the same message while older ones are added above.
  const scrollAnchorRef = useRef<number | null>(null);

  // Reset live items when the selected principal changes; the historical
  // half is re-derived from `logData` in the `displayItems` memo.
  useEffect(() => {
    setChatItems([]);
    setQueuedItems([]);
    setPendingFiles([]);
    setModelChoiceState(savedModelChoice(selectedPrincipal, runtimeId));
    setError(null);
    setOlder([]);
    setOlderCursor(undefined);
  }, [selectedPrincipal, runtimeId]);

  // Until an older page is loaded, the next one starts where the
  // latest page ends.
  const nextOlderCursor = olderCursor === undefined ? (logData?.nextCursor ?? null) : olderCursor;

  async function loadOlder() {
    if (!nextOlderCursor || loadingOlder || !selectedPrincipal) return;
    setLoadingOlder(true);
    try {
      const page = await fetchOlderPrincipalLog({
        name: selectedPrincipal,
        peer: callerSubject,
        cursor: nextOlderCursor,
        runtimeId,
      });
      scrollAnchorRef.current = scrollRef.current
        ? scrollRef.current.scrollHeight - scrollRef.current.scrollTop
        : null;
      setOlder((prev) => [...page.messages, ...prev]);
      setOlderCursor(page.hasMore ? (page.nextCursor ?? null) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && scrollAnchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - scrollAnchorRef.current;
      scrollAnchorRef.current = null;
    }
  }, [older]);

  // Keep the newest message in view when the thread grows after
  // rendering (a thumbnail loading, a reply's activity expanding) —
  // unless you have scrolled up to read.
  const pinnedToBottomRef = useRef(true);
  const hasMessages = (logData?.messages?.length ?? 0) + chatItems.length > 0;
  useEffect(() => {
    const el = scrollRef.current;
    const content = el?.firstElementChild;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const onScroll = () => {
      pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    const observer = new ResizeObserver(() => {
      if (pinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll);
    observer.observe(content);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
    // Re-bind when the message list replaces the empty state.
  }, [selectedPrincipal, hasMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatItems, queuedItems, isStreaming, logData]);

  // Map the runtime's chat log directly onto chat bubbles. The
  // chat log is the only consumer-visible source of truth — no
  // session internals (tool calls, thinking, compactions) leak
  // into this view because the runtime doesn't expose them on the
  // `principal_log` IPC anymore. Empty messages are filtered so
  // a streamed reply that collapses to "" doesn't render a blank
  // bubble.
  const historyItems = useMemo<ChatItem[]>(() => {
    const latest = logData?.messages ?? [];
    const seen = new Set(latest.map((m) => m.id));
    return chatLogMessagesToChatItems([...older.filter((m) => !seen.has(m.id)), ...latest]);
  }, [logData, older]);

  /** Send what's in the composer. */
  function handleSend() {
    const message = input.trim();
    const files = pendingFiles;
    if (!message && files.length === 0) return;
    setInput("");
    setPendingFiles([]);
    void sendText(message, files);
  }

  /**
   * Send `message` to the peko, streaming its reply — from the
   * composer, or again from a message's Retry.
   */
  async function sendText(message: string, files: string[] = []) {
    if ((!message && files.length === 0) || !selectedPrincipal) return;
    setError(null);

    const userItem: ChatItem = {
      event: { type: "chunk", content: message, timestamp: Date.now().toString() },
      isUser: true,
      // Shown from the original paths until the thread has the
      // engine's copies.
      ...(files.length > 0 && {
        attachments: files.map((path) => ({
          name: baseName(path),
          path,
          mime: "",
          size: 0,
        })),
      }),
    };
    // A message sent while the peko works reaches it at once (the
    // runtime hands it to the running turn, which reads it next). Show
    // it after the live reply until the thread refetches.
    const sentWhileBusy = activeSendsRef.current > 0;
    if (sentWhileBusy) {
      setQueuedItems((prev) => [...prev, { ...userItem, queued: true }]);
    } else {
      setChatItems((prev) => [...prev, userItem]);
      newIterationRef.current = false;
      setAwaitingToken(true);
      setWorkStartedAt(Date.now());
    }
    activeSendsRef.current += 1;
    setActiveSends(activeSendsRef.current);
    // The stream renders this reply itself; the log watch waits.
    logWatch.pausedRef.current = true;

    // A send made while busy can still start a run of its own if the
    // previous turn finished in between; promote it on its first event.
    let promoted = !sentWhileBusy;
    const promote = () => {
      if (promoted) return;
      promoted = true;
      setQueuedItems((prev) => prev.filter((q) => q.event !== userItem.event));
      setChatItems((prev) => [...prev, userItem]);
      newIterationRef.current = false;
      setWorkStartedAt(Date.now());
    };

    try {
      await sendMut.mutateAsync({
        name: selectedPrincipal,
        message,
        runtimeId,
        overrideModel: effectiveModel ?? undefined,
        attachments: files,
        onEvent: (msg: ChatStreamMsg) => {
          if (msg.kind === "queued" || msg.kind === "runSummary") return;
          promote();
          // Thinking and tool calls are the peko's own business.
          if (msg.kind === "thinking" || msg.kind === "toolStart" || msg.kind === "toolEnd") return;
          if (msg.kind === "iteration") {
            // A new step: the indicator shows until its text arrives,
            // and that text becomes the reply.
            newIterationRef.current = true;
            setAwaitingToken(true);
            return;
          }
          setAwaitingToken(false);
          const delta = msg.delta;
          const newIteration = newIterationRef.current;
          newIterationRef.current = false;
          setChatItems((prev) => {
            const last = prev[prev.length - 1];
            if (last && !last.isUser && last.event.type === "chunk") {
              const updated = [...prev];
              updated[updated.length - 1] = {
                event: {
                  ...last.event,
                  content: foldReplyText(last.event.content ?? "", delta, newIteration),
                },
                isUser: false,
              };
              return updated;
            }
            return [
              ...prev,
              {
                event: { type: "chunk", content: delta, timestamp: Date.now().toString() },
                isUser: false,
              },
            ];
          });
        },
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      // A stop (`peko stop`) is not an error.
      if (!text.includes(STOPPED_BY_USER)) setError(text);
    } finally {
      activeSendsRef.current -= 1;
      setActiveSends(activeSendsRef.current);
      if (activeSendsRef.current === 0) {
        setAwaitingToken(true);
        setWorkStartedAt(null);
        newIterationRef.current = false;
        logWatch.pausedRef.current = false;
        // The DM channel is the record: once it has the exchange, the
        // live copies go.
        await logWatch.flush();
        setChatItems([]);
        setQueuedItems([]);
      }
    }
  }

  // A first message handed over by onboarding (`?say=`): send it once,
  // then drop it from the URL so a reload doesn't send it again.
  const firstMessageSent = useRef(false);
  const say = search.say;
  useEffect(() => {
    if (!say || firstMessageSent.current || !selectedPrincipal || !principalName) return;
    firstMessageSent.current = true;
    navigate({
      to: "/chat/$pekoName",
      params: { pekoName: selectedPrincipal },
      search: { runtimeId: search.runtimeId },
      replace: true,
    });
    void sendText(say);
    // sendText reads current state; run once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say, selectedPrincipal, principalName]);

  // Requests someone else made that wait for you, the owner. The
  // peko's notice lands in this thread, so a new row refetches them.
  // One of yours on another computer is asked through its host.
  const ownsApprovals = runtimeId === "local" || ownRemote;
  const approvals = usePrincipalApprovals(
    selectedPrincipal || undefined,
    ownsApprovals,
    runtimeId,
  );
  const refetchApprovals = approvals.refetch;
  useEffect(() => {
    if (ownsApprovals && selectedPrincipal) void refetchApprovals();
  }, [logData, ownsApprovals, selectedPrincipal, refetchApprovals]);

  // Why the last run here didn't go through, shown beside the thread.
  const runFailure = !isStreaming ? (logData?.runFailure ?? null) : null;

  const displayItems = useMemo(() => [...historyItems, ...chatItems], [historyItems, chatItems]);
  const lastUserIdx = useMemo(() => {
    for (let i = displayItems.length - 1; i >= 0; i--) if (displayItems[i].isUser) return i;
    return -1;
  }, [displayItems]);
  // Retry sits on the latest reply and re-sends the message before it.
  const retryIdx =
    lastUserIdx >= 0 && lastUserIdx < displayItems.length - 1 ? displayItems.length - 1 : -1;
  const retryText = lastUserIdx >= 0 ? (displayItems[lastUserIdx].event.content ?? "").trim() : "";
  // Suggested replies show only on the thread's latest message, and only
  // while nothing is in flight: once anyone says anything, they're gone.
  const pickIdx =
    !isStreaming && queuedItems.length === 0 && displayItems.length > 0
      ? displayItems.length - 1
      : -1;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" />
      </div>
    );
  }

  // No peko of your own: a peko on another computer you added still opens.
  if ((!principals || principals.length === 0) && !remotePeko) {
    if (remotePrincipals && remotePrincipals.length > 0) {
      return (
        <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-4 p-8">
          <div className="tile h-14 w-14 rounded-2xl"><MessageCircle className="h-6 w-6" /></div>
          <p className="text-sm text-fg-muted">{t("chat.selectPeko")}</p>
        </div>
      );
    }
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-4 p-8">
        <div className="tile h-14 w-14 rounded-2xl"><MessageCircle className="h-6 w-6" /></div>
        <div className="text-center">
          <p className="h-section">
            {t("chat.noPekos")}
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {t("chat.noPekosHint")}
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" />
          {t("chat.createPeko")}
        </button>
        {!signedInToHub && (
          <p className="text-xs text-fg-subtle">
            <Trans
              i18nKey="chat.signInPrompt"
              components={{
                signIn: (
                  <button
                    type="button"
                    data-testid="empty-sign-in"
                    onClick={requestPekohubSignIn}
                    className="link font-medium"
                  />
                ),
              }}
            />
          </p>
        )}
        <CreatePrincipalModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => navigate({ to: "/chat/$pekoName", params: { pekoName: name } })}
        />
      </div>
    );
  }

  if (!selectedPrincipal) {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-4 p-8">
        <div className="tile h-14 w-14 rounded-2xl"><MessageCircle className="h-6 w-6" /></div>
        <p className="text-sm text-fg-muted">
          {t("chat.selectPeko")}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {dragging && (
        <div
          data-testid="chat-drop-overlay"
          className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-brand-soft/80 text-brand-text"
        >
          <Paperclip className="h-6 w-6" />
          <p className="text-sm font-medium">{t("chat.dropFiles")}</p>
        </div>
      )}
      <PrincipalToolbar
        peko={pekoFace}
        runtimeId={remotePeko ? runtimeId : "local"}
        description={
          remotePeko
            ? // One of yours on another computer reads like one of this
              // computer's ("Your peko" when it has no description).
              remote.description ||
              (remotePeko.fromAccount ? undefined : t("chat.ownersPeko", { owner: remotePeko.owner }))
            : principals?.find((p) => p.name === selectedPrincipal)?.description
        }
        computer={remotePeko?.runtimeName}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-surface px-3 py-4">
        {displayItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-fg-subtle">
            <MessageCircle className="h-10 w-10" />
            <p className="mt-2 text-sm">{t("chat.begin")}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {nextOlderCursor && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="btn-secondary btn-xs rounded-full px-3"
                >
                  {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t("common.loadEarlier")}
                </button>
              </div>
            )}
            {displayItems.map((item, idx) => (
              <Fragment key={item.event.timestamp ?? idx}>
                <ChatMessage
                  item={item}
                  peko={pekoFace}
                  onRetry={
                    idx === retryIdx && retryText && !isStreaming
                      ? () => void sendText(retryText)
                      : undefined
                  }
                  onPick={idx === pickIdx ? (reply) => void sendText(reply) : undefined}
                  waitingFor={
                    item.isUser && item.msgId && waiting.has(item.msgId)
                      ? hostLabel
                      : undefined
                  }
                />
              </Fragment>
            ))}
            {isStreaming && awaitingToken && (
              <div
                data-testid="working-indicator"
                className="flex items-center gap-2 px-4 py-1.5 text-xs text-fg-subtle"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {workingSecs >= 3
                    ? t("chat.workingFor", { name: pekoFace.name, seconds: workingSecs })
                    : t("chat.working", { name: pekoFace.name })}
                </span>
              </div>
            )}
            {queuedItems.map((item, idx) => (
              <ChatMessage key={`queued-${item.event.timestamp ?? idx}`} item={item} peko={pekoFace} />
            ))}
          </div>
        )}

        {selectedPrincipal && !remotePeko && (
          <SetupPanel name={selectedPrincipal} runtimeId={runtimeId} />
        )}

        {runFailure && (
          <p data-testid="run-status" className="mt-2 px-4 text-xs text-fg-subtle">
            {runFailureLine(runFailure)}
          </p>
        )}

        {error ? (
          <div className="note-danger mt-3">
            {error}
          </div>
        ) : null}
      </div>

      <ApprovalCards
        peko={selectedPrincipal}
        runtimeId={runtimeId}
        requests={ownsApprovals ? (approvals.data ?? []) : []}
      />

      {hostOffline && (
        <HostOfflineNotice
          peko={pekoFace.name}
          computer={hostLabel}
          lastSeenAt={remote.status.data?.lastSeenAt ?? null}
        />
      )}

      <div className="bg-surface px-4 pb-4 pt-2">
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          models={composerModels}
          model={effectiveModel}
          onModelChange={setModelChoice}
          attachments={pendingFiles}
          onAttach={canAttach ? () => void chooseFiles() : undefined}
          onRemoveAttachment={(path) => setPendingFiles((prev) => prev.filter((p) => p !== path))}
          onPasteFiles={canAttach ? (files) => void pasteFiles(files) : undefined}
        />
      </div>
    </div>
  );
}
