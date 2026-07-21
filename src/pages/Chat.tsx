import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import {
  usePrincipals,
  usePrincipalSend,
  usePrincipalLog,
  useCallerSubject,
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
  Shield,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { ChatLogMessage, StreamEvent } from "../types";

interface ChatItem {
  event: StreamEvent;
  isUser: boolean;
}

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
      last.event.type === "chunk"
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
            navigate({ to: "/principal/$principalName", params: { principalName } })
          }
          title={`Manage what ${principalName} is allowed to do`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Shield className="h-3.5 w-3.5" />
          Permissions
        </button>
        <button
          onClick={() =>
            navigate({ to: "/log/$principalName", params: { principalName } })
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
  const paramName = (params as Record<string, string | undefined>).principalName;
  if (paramName) principalName = paramName;

  const selectedPrincipal = principalName ?? principals?.[0]?.name ?? "";

  const sendMut = usePrincipalSend();
  const callerSubject = useCallerSubject();
  // ADR-042: scope the chat-history read to the caller's peer thread so
  // the desktop shows only the conversation between `selectedPrincipal`
  // and the active user. The runtime enforces ownership / Chat grants;
  // if the caller is the owner it returns the merged thread, otherwise
  // just the caller's own thread.
  const { data: logData } = usePrincipalLog(
    selectedPrincipal || undefined,
    callerSubject,
  );

  useEffect(() => {
    if ((pathname === "/" || pathname === "/chat") && selectedPrincipal) {
      navigate({
        to: "/chat/$principalName",
        params: { principalName: selectedPrincipal },
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
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset live items when the selected principal changes; the historical
  // half is re-derived from `logData` in the `displayItems` memo.
  useEffect(() => {
    setChatItems([]);
    setError(null);
  }, [selectedPrincipal]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatItems, isStreaming, logData]);

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
    if (!input.trim() || isStreaming || !selectedPrincipal) return;
    const message = input.trim();
    setError(null);
    setInput("");

    const userEvent: StreamEvent = {
      type: "chunk",
      content: message,
      timestamp: Date.now().toString(),
    };
    setChatItems((prev) => [...prev, { event: userEvent, isUser: true }]);

    setIsStreaming(true);
    try {
      await sendMut.mutateAsync({
        name: selectedPrincipal,
        message,
        onChunk: (delta) => {
          setChatItems((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              !last.isUser &&
              last.event.type === "chunk" &&
              (last.event as { toolCallId?: string }).toolCallId === undefined
            ) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                event: {
                  ...last.event,
                  content: (last.event.content ?? "") + delta,
                },
                isUser: false,
              };
              return updated;
            }
            return [
              ...prev,
              {
                event: {
                  type: "chunk",
                  content: delta,
                  timestamp: Date.now().toString(),
                } as StreamEvent,
                isUser: false,
              },
            ];
          });
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStreaming(false);
    }
  }

  const displayItems = useMemo(
    () => mergeAssistantChunks([...historyItems, ...chatItems]),
    [historyItems, chatItems],
  );

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
            No principals yet
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Create your first principal to start chatting.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Create a principal
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
          Select a principal from the sidebar
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
            {isStreaming && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isStreaming}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
