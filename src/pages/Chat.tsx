import { Fragment, useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
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
import Composer, { type ComposerModel } from "../components/chat/Composer";
import {
  MAX_ATTACHMENTS,
  MessageAttachments,
  baseName,
} from "../components/chat/Attachments";
import { useFileDrop } from "../hooks/useFileDrop";
import { attachmentStage, pickAttachments } from "../lib/api";
import { useModels } from "../hooks/useModels";
import { useRemotePeko } from "../hooks/useRemotePrincipals";
import PekoAvatar from "../components/peko/PekoAvatar";
import PrincipalProfileModal from "../components/modals/PrincipalProfileModal";
import { pekoIdentity, type PekoIdentity } from "../lib/pekoIdentity";
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

/**
 * ToS gate: a send/stream rejection whose message starts with
 * "[tos_required]" carries the hub's terms text after the prefix.
 * The thread renders it as a distinct acknowledgement notice, not a
 * generic red error bubble.
 */
const TOS_REQUIRED_PREFIX = "[tos_required]";

interface ChatItem {
  event: StreamEvent;
  isUser: boolean;
  /** A message sent while the peko was working, shown after its reply. */
  queued?: boolean;
  /** Files sent with the message. */
  attachments?: ChatLogAttachment[];
}

/** The error a stream ends with when the run was stopped (`peko stop`). */
const STOPPED_BY_USER = "stopped by user";

function formatTime(ts?: string) {
  if (!ts) return "";
  const ms = Number(ts);
  if (!isNaN(ms) && ms > 1000000000000) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatMessage({
  item,
  peko,
  onRetry,
}: {
  item: ChatItem;
  /** The reply's author. */
  peko: PekoIdentity;
  /** Present on the latest reply: send the message before it again. */
  onRetry?: () => void;
}) {
  const { event, isUser } = item;
  const isError = event.type === "error";
  const text = event.content ?? "";
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="group relative flex w-full gap-3 px-4 py-1.5 hover:bg-surface-raised">
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
            <User className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
        ) : isError ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <X className="h-4 w-4 text-danger" />
          </div>
        ) : (
          <PekoAvatar peko={peko} size="md" />
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-fg">
            {isUser ? "You" : isError ? "Error" : peko.name}
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
        {/* Floats over the message on hover, like Slack: it takes no
            room, so messages sit close together. */}
        {!item.queued && text && (
          <div className="absolute -top-3 right-4 flex gap-1 rounded-md border border-line bg-surface-card p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <MessageAction label={copied ? "Copied" : "Copy"} onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </MessageAction>
            {onRetry && (
              <MessageAction label="Retry" onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" />
              </MessageAction>
            )}
          </div>
        )}
      </div>
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
    {
      peko_limit: "its spending limit is reached",
      provider_quota: "the model provider's quota is used up",
      provider_unreachable: "the model provider can't be reached",
    }[failure.kind] ?? failure.message;
  if (failure.nextAttemptAt) {
    const next = new Date(failure.nextAttemptAt);
    const sameDay = next.toDateString() === now.toDateString();
    const when = next.toLocaleString([], {
      ...(sameDay ? {} : { month: "short", day: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Waiting — ${reason}. It continues on its own, next try ${when}.`;
  }
  return `The last reply didn't go through — ${reason}.`;
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
  return request.actorName ? `${request.actorName} (${request.actor})` : request.actor;
}

/**
 * The requests waiting for you, the peko's owner: what someone else
 * asked it to do that its policy left to you. Approve runs exactly
 * that call for them; Always also adds a standing rule to POLICY.md.
 */
function ApprovalCards({ peko, requests }: { peko: string; requests: ApprovalRequest[] }) {
  const decide = useDecideApproval();
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const id = window.setTimeout(() => setOutcome(null), 6000);
    return () => window.clearTimeout(id);
  }, [outcome]);

  async function act(id: string, approve: boolean, always = false) {
    try {
      setOutcome(await decide.mutateAsync({ name: peko, id, approve, always }));
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : String(err));
    }
  }

  if (requests.length === 0 && !outcome) return null;
  return (
    <div className="space-y-2 border-t border-line bg-surface px-4 pt-3" data-testid="approval-cards">
      {requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm">
          <p className="text-fg">
            <span className="font-medium">{askerName(r)}</span> asks {peko} to run{" "}
            <span className="font-mono text-xs">{r.summary.replace(/`/g, "")}</span>
          </p>
          {r.reason && <p className="mt-1 text-xs text-fg-muted">{r.reason}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void act(r.id, true)}
              className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void act(r.id, true, true)}
              title={`Approve, and always allow this for ${r.actorName ?? r.actor}`}
              className="rounded-md border border-line px-3 py-1 text-xs text-fg-soft hover:bg-surface-sunken disabled:opacity-50"
            >
              Always allow
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => void act(r.id, false)}
              className="rounded-md border border-line px-3 py-1 text-xs text-fg-soft hover:bg-surface-sunken disabled:opacity-50"
            >
              Deny
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
    out.push({
      event: {
        type: "chunk",
        content: m.text,
        timestamp: m.timestamp,
      } as StreamEvent,
      isUser: m.sender.startsWith("user:"),
      ...(attachments.length > 0 && { attachments }),
    });
  }
  return out;
}

function PrincipalToolbar({
  peko,
  runtimeId,
  description,
}: {
  peko: PekoIdentity;
  runtimeId: string;
  description?: string | null;
}) {
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        title={`${peko.name}'s profile`}
        className="flex min-w-0 items-center gap-3 rounded-lg p-1 -m-1 text-left hover:bg-surface-sunken"
      >
        <PekoAvatar peko={peko} size="md" />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{peko.name}</h3>
          <p className="truncate text-xs text-fg-muted">{description || "Your peko"}</p>
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
  const navigate = useNavigate();
  const routerState = useRouterState();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const pathname = routerState.location.pathname;
  const [createOpen, setCreateOpen] = useState(false);

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
  // The engine reads attachments from this computer, so only a peko
  // here can take them.
  const canAttach = runtimeId === "local" && !!selectedPrincipal;
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
  // The model for the next message; `null` is the peko's own. Resets
  // when switching pekos.
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const { data: models } = useModels();
  const composerModels = useMemo<ComposerModel[]>(
    () =>
      (models ?? [])
        .filter((m) => m.enabled)
        .map((m) => ({ id: m.id, displayName: m.displayName || m.id })),
    [models],
  );
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
    setModelChoice(null);
    setError(null);
    setOlder([]);
    setOlderCursor(undefined);
  }, [selectedPrincipal]);

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
        overrideModel: modelChoice ?? undefined,
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
  const approvals = usePrincipalApprovals(selectedPrincipal || undefined, runtimeId === "local");
  const refetchApprovals = approvals.refetch;
  useEffect(() => {
    if (runtimeId === "local" && selectedPrincipal) void refetchApprovals();
  }, [logData, runtimeId, selectedPrincipal, refetchApprovals]);

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

  // A "[tos_required]"-tagged send/stream rejection carries the hub's
  // terms text after the prefix; it renders as the acknowledgement
  // notice below, not the generic red error box.
  const tosText =
    error && error.startsWith(TOS_REQUIRED_PREFIX)
      ? error.slice(TOS_REQUIRED_PREFIX.length).trim()
      : null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-fg-subtle" />
      </div>
    );
  }

  if (!principals || principals.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <MessageCircle className="h-12 w-12 text-fg-subtle" />
        <div className="text-center">
          <p className="text-sm font-medium text-fg-muted">
            No pekos yet
          </p>
          <p className="text-xs text-fg-subtle">
            Create your first peko to start chatting.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover"
        >
          <Plus className="h-4 w-4" />
          Create a peko
        </button>
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
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <MessageCircle className="h-12 w-12 text-fg-subtle" />
        <p className="text-sm text-fg-muted">
          Select a peko from the sidebar
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {dragging && (
        <div
          data-testid="chat-drop-overlay"
          className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-brand-soft/80 text-brand"
        >
          <Paperclip className="h-6 w-6" />
          <p className="text-sm font-medium">Drop files to attach</p>
        </div>
      )}
      <PrincipalToolbar
        peko={pekoFace}
        runtimeId={remotePeko ? runtimeId : "local"}
        description={
          remotePeko
            ? remote.description || `${remotePeko.owner}'s peko`
            : principals?.find((p) => p.name === selectedPrincipal)?.description
        }
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-surface p-4">
        {displayItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-fg-subtle">
            <MessageCircle className="h-10 w-10" />
            <p className="mt-2 text-sm">Send a message to begin...</p>
          </div>
        ) : (
          <div className="space-y-1">
            {nextOlderCursor && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-sunken disabled:opacity-50"
                >
                  {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                  Load earlier messages
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
                  {pekoFace.name} is working{workingSecs >= 3 ? ` · ${workingSecs}s` : ""}
                </span>
              </div>
            )}
            {queuedItems.map((item, idx) => (
              <ChatMessage key={`queued-${item.event.timestamp ?? idx}`} item={item} peko={pekoFace} />
            ))}
          </div>
        )}

        {runFailure && (
          <p data-testid="run-status" className="mt-2 px-4 text-xs text-fg-subtle">
            {runFailureLine(runFailure)}
          </p>
        )}

        {tosText !== null ? (
          <div
            data-testid="tos-required-notice"
            className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm text-warn"
          >
            <p className="font-medium">
              This peko requires you to acknowledge its terms before chatting.
            </p>
            <p className="mt-1 whitespace-pre-wrap break-all">{tosText}</p>
          </div>
        ) : error ? (
          <div className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </div>

      <ApprovalCards peko={selectedPrincipal} requests={approvals.data ?? []} />

      <div className="border-t border-line bg-surface p-4">
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          models={runtimeId === "local" ? composerModels : []}
          model={modelChoice}
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
