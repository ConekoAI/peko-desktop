import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import {
  usePrincipals,
  usePrincipalSend,
  usePrincipalLog,
  usePrincipalLogWatch,
  usePrincipalStop,
  useCallerSubject,
  newestLogCursor,
} from "../hooks/usePrincipals";
import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";
import {
  Send,
  Loader2,
  MessageCircle,
  X,
  User,
  Bot as BotIcon,
  Plus,
  Activity,
  Square,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
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

function ChatMessage({ item }: { item: ChatItem }) {
  const { event, isUser } = item;
  const isError = event.type === "error";

  return (
    <div className="flex w-full gap-3 px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/50">
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
            <User className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
        ) : isError ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <X className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <BotIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isUser ? "You" : isError ? "Error" : "Assistant"}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {formatTime(event.timestamp)}
          </span>
          {item.queued && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              Queued — your peko will read this next
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
          {isUser ? (
            <p className="whitespace-pre-wrap break-all">{event.content ?? ""}</p>
          ) : isError ? (
            <p className="whitespace-pre-wrap break-all text-red-600 dark:text-red-400">
              {event.content ?? ""}
            </p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-all">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {event.content ?? ""}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
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

function PrincipalToolbar({ principalName }: { principalName: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
          <BotIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {principalName}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Private conversation
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() =>
            navigate({ to: "/log/$pekoName", params: { pekoName: principalName } })
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Activity className="h-3.5 w-3.5" />
          Activity
        </button>
      </div>
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

  // Reset live items when the selected principal changes; the historical
  // half is re-derived from `logData` in the `displayItems` memo.
  useEffect(() => {
    setChatItems([]);
    setQueuedItems([]);
    setToolErrors([]);
    setError(null);
  }, [selectedPrincipal]);

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
  const historyItems = useMemo<ChatItem[]>(
    () => (logData?.messages ? chatLogMessagesToChatItems(logData.messages) : []),
    [logData],
  );

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !selectedPrincipal) return;
    const message = input.trim();
    setError(null);
    setInput("");

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
    };

    try {
      await sendMut.mutateAsync({
        name: selectedPrincipal,
        message,
        runtimeId,
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
        <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
      </div>
    );
  }

  if (!principals || principals.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <MessageCircle className="h-12 w-12 text-slate-300 dark:text-slate-700" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            No pekos yet
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Create your first peko to start chatting.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Create a peko
        </button>
        <CreatePrincipalModal open={createOpen} onClose={() => setCreateOpen(false)} />
      </div>
    );
  }

  if (!selectedPrincipal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <MessageCircle className="h-12 w-12 text-slate-300 dark:text-slate-700" />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Select a peko from the sidebar
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PrincipalToolbar principalName={selectedPrincipal} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white p-4 dark:bg-slate-950">
        {displayItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400 dark:text-slate-600">
            <MessageCircle className="h-10 w-10" />
            <p className="mt-2 text-sm">Send a message to begin...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayItems.map((item, idx) => (
              <ChatMessage key={item.event.timestamp ?? idx} item={item} />
            ))}
            {isStreaming && awaitingToken && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>...</span>
                </div>
              </div>
            )}
            {queuedItems.map((item, idx) => (
              <ChatMessage key={`queued-${item.event.timestamp ?? idx}`} item={item} />
            ))}
          </div>
        )}

        {toolErrors.length > 0 && (
          <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
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
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <p className="font-medium">
              This peko requires you to acknowledge its terms before chatting.
            </p>
            <p className="mt-1 whitespace-pre-wrap break-all">{tosText}</p>
          </div>
        ) : error ? (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "Add to what it's doing..." : "Type a message..."}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          {isStreaming && (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopMut.isPending}
              title="Stop"
              aria-label="Stop"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
