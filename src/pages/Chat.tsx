import { Fragment, useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import {
  usePrincipals,
  usePrincipalSend,
  usePrincipalLog,
  usePrincipalLogWatch,
  usePrincipalStop,
  useCallerSubject,
  newestLogCursor,
  fetchOlderPrincipalLog,
} from "../hooks/usePrincipals";
import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";
import ActivitySteps from "../components/chat/ActivitySteps";
import Composer, { type ComposerModel } from "../components/chat/Composer";
import { useModels } from "../hooks/useModels";
import PekoAvatar from "../components/peko/PekoAvatar";
import PrincipalProfileModal from "../components/modals/PrincipalProfileModal";
import { pekoIdentity, type PekoIdentity } from "../lib/pekoIdentity";
import { applyActivity, EMPTY_ACTIVITY, type Activity as ReplyActivity } from "../components/chat/activity";
import {
  Loader2,
  MessageCircle,
  X,
  User,
  Plus,
  Check,
  Copy,
  RotateCcw,
} from "lucide-react";
import Markdown from "../components/chat/Markdown";
import { copyText } from "../components/chat/copy";
import type { ChatLogMessage, StreamEvent } from "../types";
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
  /**
   * Agentic-iteration number that produced this chunk (1-based, set
   * by the runtime's `principal_sent_iteration` boundary marker).
   * Only present on streamed assistant chunks — historical chunks
   * loaded from the chat log have `undefined` because the runtime
   * persists assistant turns as one flat record per turn and the
   * chat-log projection cannot recover iteration boundaries. The
   * merge predicate treats `undefined` as a single value so all
   * historical chunks in a turn collapse into one bubble.
   */
  iteration?: number;
  /** A message sent while the peko was busy, waiting for its turn. */
  queued?: boolean;
}

/** The error a stream ends with when the user pressed Stop. */
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
    <div className="group flex w-full gap-3 px-4 py-1 hover:bg-surface-raised">
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
          {item.queued && (
            <span className="text-[11px] text-warn">
              Queued — your peko will read this next
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-fg">
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{text}</p>
          ) : isError ? (
            <p className="whitespace-pre-wrap break-words text-danger">{text}</p>
          ) : (
            <Markdown>{text}</Markdown>
          )}
        </div>
        {!item.queued && text && (
          <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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

function mergeAssistantChunks(items: ChatItem[]): ChatItem[] {
  const merged: ChatItem[] = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (
      !item.isUser &&
      item.event.type === "chunk" &&
      last &&
      !last.isUser &&
      last.event.type === "chunk" &&
      // Only merge consecutive assistant chunks that share the same
      // agentic iteration. A different `iteration` (or one missing
      // and the other present) means a new LLM turn started — emit
      // a separate bubble. Two `undefined` iterations merge (this
      // is how historical chat-log items collapse into one bubble).
      last.iteration === item.iteration
    ) {
      last.event = {
        ...last.event,
        content: (last.event.content ?? "") + (item.event.content ?? ""),
      };
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
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
    if (!m.text) continue;
    out.push({
      event: {
        type: "chunk",
        content: m.text,
        timestamp: m.timestamp,
      } as StreamEvent,
      isUser: m.sender.startsWith("user:"),
    });
  }
  return out;
}

function PrincipalToolbar({
  peko,
  description,
}: {
  peko: PekoIdentity;
  description?: string;
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

  const { data: principals, isLoading, isFetching: principalsFetching } = usePrincipals();

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
  const pekoFace = useMemo(
    () =>
      pekoIdentity(
        principals?.find((p) => p.name === selectedPrincipal) ?? { name: selectedPrincipal },
      ),
    [principals, selectedPrincipal],
  );

  const sendMut = usePrincipalSend();
  const stopMut = usePrincipalStop();
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
  // leave its address instead of showing a stale thread.
  const missingLocalPeko =
    runtimeId === "local" &&
    !!principalName &&
    !!principals &&
    !principalsFetching &&
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
  // Failed tool calls reported by the last run's `runSummary`.
  const [toolErrors, setToolErrors] = useState<string[]>([]);
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
  // The latest reply's thinking and tool calls. Kept after the reply
  // lands (the thread itself records only messages) until the next send.
  const [activity, setActivity] = useState<ReplyActivity>(EMPTY_ACTIVITY);
  // `awaitingToken` drives the "Thinking…" pill: it stays `true` from
  // send until the first chunk of the current iteration lands, and
  // flips back to `true` whenever a new `principal_sent_iteration`
  // boundary marker arrives (e.g. between a tool call and the next
  // assistant reply). This makes the pill reflect the real state of
  // "we don't have a token yet" rather than the whole stream window.
  const [awaitingToken, setAwaitingToken] = useState(true);
  // Tracks the iteration number most recently stamped by the runtime
  // via `principal_sent_iteration`. Used to tag outgoing chunks so
  // `mergeAssistantChunks` can break bubbles at iteration boundaries.
  const currentIterationRef = useRef<number>(0);
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
    setToolErrors([]);
    setActivity(EMPTY_ACTIVITY);
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
    if (!message) return;
    setInput("");
    void sendText(message);
  }

  /**
   * Send `message` to the peko, streaming its reply — from the
   * composer, or again from a message's Retry.
   */
  async function sendText(message: string) {
    if (!message || !selectedPrincipal) return;
    setError(null);

    const userItem: ChatItem = {
      event: { type: "chunk", content: message, timestamp: Date.now().toString() },
      isUser: true,
    };
    // Sending while the peko is working is how the user steers it: the
    // runtime queues the message for the running turn. Show it after
    // the live reply until the thread refetches.
    const sentWhileBusy = activeSendsRef.current > 0;
    if (sentWhileBusy) {
      setQueuedItems((prev) => [...prev, { ...userItem, queued: true }]);
    } else {
      setChatItems((prev) => [...prev, userItem]);
      currentIterationRef.current = 0;
      setAwaitingToken(true);
      setToolErrors([]);
      setActivity(EMPTY_ACTIVITY);
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
      currentIterationRef.current = 0;
      setActivity(EMPTY_ACTIVITY);
    };

    try {
      await sendMut.mutateAsync({
        name: selectedPrincipal,
        message,
        runtimeId,
        overrideModel: modelChoice ?? undefined,
        onEvent: (msg: ChatStreamMsg) => {
          if (msg.kind === "queued") return;
          if (msg.kind === "runSummary") {
            setToolErrors(
              msg.toolErrors.map((t) =>
                t.toolName ? `${t.toolName}: ${t.errorMessage}` : t.errorMessage,
              ),
            );
            return;
          }
          promote();
          if (msg.kind === "thinking" || msg.kind === "toolStart" || msg.kind === "toolEnd") {
            setActivity((prev) => applyActivity(prev, msg));
            return;
          }
          if (msg.kind === "iteration") {
            // A new agentic iteration started: tag the next chunk and
            // show the pill until its first token lands.
            currentIterationRef.current = msg.iteration;
            setAwaitingToken(true);
            return;
          }
          setAwaitingToken(false);
          const delta = msg.delta;
          const iteration = currentIterationRef.current;
          setChatItems((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              !last.isUser &&
              last.event.type === "chunk" &&
              // Append only within the same agentic iteration; a new
              // iteration starts a new bubble.
              last.iteration === iteration
            ) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                event: { ...last.event, content: (last.event.content ?? "") + delta },
                isUser: false,
                iteration: last.iteration ?? iteration,
              };
              return updated;
            }
            return [
              ...prev,
              {
                event: { type: "chunk", content: delta, timestamp: Date.now().toString() },
                isUser: false,
                iteration,
              },
            ];
          });
        },
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      // Stop is not an error: the thread shows the runtime's stop marker.
      if (!text.includes(STOPPED_BY_USER)) setError(text);
    } finally {
      activeSendsRef.current -= 1;
      setActiveSends(activeSendsRef.current);
      if (activeSendsRef.current === 0) {
        setAwaitingToken(true);
        currentIterationRef.current = 0;
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

  async function handleStop() {
    if (!selectedPrincipal) return;
    try {
      await stopMut.mutateAsync({ name: selectedPrincipal, runtimeId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const displayItems = useMemo(
    () => mergeAssistantChunks([...historyItems, ...chatItems]),
    [historyItems, chatItems],
  );
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
    <div className="flex h-full flex-col overflow-hidden">
      <PrincipalToolbar
        peko={pekoFace}
        description={principals?.find((p) => p.name === selectedPrincipal)?.description}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-surface p-4">
        {displayItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-fg-subtle">
            <MessageCircle className="h-10 w-10" />
            <p className="mt-2 text-sm">Send a message to begin...</p>
          </div>
        ) : (
          <div className="space-y-3">
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
                {/* The latest reply's activity sits between the last
                    user message and the reply. */}
                {idx === lastUserIdx && <ActivitySteps activity={activity} live={isStreaming} />}
              </Fragment>
            ))}
            {isStreaming && awaitingToken && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>...</span>
                </div>
              </div>
            )}
            {queuedItems.map((item, idx) => (
              <ChatMessage key={`queued-${item.event.timestamp ?? idx}`} item={item} peko={pekoFace} />
            ))}
          </div>
        )}

        {toolErrors.length > 0 && (
          <details className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-xs text-warn">
            <summary className="cursor-pointer">
              {toolErrors.length === 1
                ? "1 tool call failed during this reply"
                : `${toolErrors.length} tool calls failed during this reply`}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {toolErrors.map((t, i) => (
                <li key={i} className="break-words">{t}</li>
              ))}
            </ul>
          </details>
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

      <div className="border-t border-line bg-surface p-4">
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          busy={isStreaming}
          stopping={stopMut.isPending}
          models={composerModels}
          model={modelChoice}
          onModelChange={setModelChoice}
        />
      </div>
    </div>
  );
}
