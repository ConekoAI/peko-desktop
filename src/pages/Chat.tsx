import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAgents } from "../hooks/useAgents";
import { useSessions, useSessionHistory } from "../hooks/useSessions";

import { useIpcStream } from "../hooks/useIpcStream";
import { sessionSend } from "../lib/api";
import {
  Send,
  Loader2,
  MessageCircle,
  X,
  User,
  Bot as BotIcon,
  Plus,
  ChevronDown,
  Clock,
  Search,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamEvent, SessionSummary } from "../types";

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

function formatRelativeTime(ts?: string) {
  if (!ts) return "";
  const ms = Number(ts);
  const date = !isNaN(ms) && ms > 1000000000000 ? new Date(ms) : new Date(ts);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ChatMessage({ item }: { item: ChatItem }) {
  const { event, isUser } = item;
  const isError = event.type === "error";

  return (
    <div className="flex w-full gap-3 px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/50">
      {/* Avatar */}
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
      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isUser ? "You" : isError ? "Error" : "Assistant"}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{formatTime(event.timestamp)}</span>
        </div>
        <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{event.content ?? ""}</p>
          ) : isError ? (
            <p className="whitespace-pre-wrap break-words text-red-600 dark:text-red-400">{event.content ?? ""}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {event.content ?? ""}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Merge consecutive assistant chunk events into single messages.
 */
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

function AgentListSidebar({
  agents,
  selectedAgent,
  onSelectAgent,
}: {
  agents: { name: string; description?: string }[] | undefined;
  selectedAgent: string;
  onSelectAgent: (name: string) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!agents) return [];
    const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, search]);

  return (
    <div className="flex h-full w-64 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.map((agent) => {
          const isActive = agent.name === selectedAgent;
          return (
            <button
              key={agent.name}
              onClick={() => onSelectAgent(agent.name)}
              className={[
                "flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm transition-colors",
                isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <span className="flex items-center gap-2 font-medium">
                <span
                  className={[
                    "h-2 w-2 rounded-full",
                    isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
                  ].join(" ")}
                />
                {agent.name}
              </span>
              {agent.description && (
                <span className="mt-0.5 pl-4 text-[11px] text-slate-400 dark:text-slate-500">
                  {agent.description}
                </span>
              )}
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-600">
            No agents found
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <a
          href="/agents"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = "/agents";
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </a>
      </div>
    </div>
  );
}

function SessionToolbar({
  agentName,
  sessions,
  currentSessionId,
  onNewSession,
  onSwitchSession,
}: {
  agentName: string;
  sessions: SessionSummary[] | undefined;
  currentSessionId: string | undefined;
  onNewSession: () => void;
  onSwitchSession: (sessionId: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    if (historyOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [historyOpen]);

  const currentSession = sessions?.find((s) => s.id === currentSessionId);

  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
          <BotIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{agentName}</h3>
          {currentSession && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {currentSession.title ?? `Session ${currentSession.id.slice(0, 8)}`} ·{" "}
              {currentSession.messageCount} messages
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onNewSession}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Clock className="h-3.5 w-3.5" />
            History
            <ChevronDown className="h-3 w-3" />
          </button>

          {historyOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {sessions && sessions.length > 0 ? (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => {
                      onSwitchSession(session.id);
                      setHistoryOpen(false);
                    }}
                    className={[
                      "flex w-full flex-col px-3 py-2 text-left text-sm transition-colors",
                      session.id === currentSessionId
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                    ].join(" ")}
                  >
                    <span className="font-medium">
                      {session.title ?? `Session ${session.id.slice(0, 8)}`}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {session.messageCount} messages · {formatRelativeTime(session.updatedAt)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                  No session history
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  // Parse params from pathname manually since Chat is used by multiple routes
  const pathParts = pathname.split("/").filter(Boolean);
  const params = {
    agentName: pathParts[0] === "chat" ? pathParts[1] : undefined,
    sessionId: pathParts[0] === "chat" && pathParts[2] ? pathParts[2] : undefined,
  };

  const { data: agents, isLoading: agentsLoading } = useAgents();

  // Determine selected agent: URL param → first agent → none
  const selectedAgent = params.agentName ?? agents?.[0]?.name ?? "";

  // Fetch sessions for selected agent
  const { data: sessions } = useSessions(selectedAgent || undefined);

  // Determine current session: URL param → active session from daemon → first session
  const activeSessionId = sessions?.find((s) => s.status === "active")?.id;
  const currentSessionId = params.sessionId ?? activeSessionId ?? sessions?.[0]?.id;

  // Fetch session history from daemon
  const historyId = currentSessionId ? `${selectedAgent}/${currentSessionId}` : "";
  const { data: sessionHistory } = useSessionHistory(historyId);

  // Local chat state
  const [input, setInput] = useState("");
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [isNewSession, setIsNewSession] = useState(false);
  const { messages, isStreaming, error, sendMessage, clearMessages } = useIpcStream({
    channel: "peko-stream",
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const mergedCountRef = useRef(0);

  // Clear chat when switching sessions
  useEffect(() => {
    setChatItems([]);
    mergedCountRef.current = 0;
    clearMessages();
  }, [currentSessionId, clearMessages]);

  // Load session history when data arrives
  useEffect(() => {
    if (sessionHistory && sessionHistory.length > 0) {
      const historyItems: ChatItem[] = sessionHistory.map((msg) => ({
        event: {
          type: "chunk",
          content: msg.content,
          timestamp: msg.timestamp,
        } as StreamEvent,
        isUser: msg.role === "user",
      }));
      setChatItems(historyItems);
    }
  }, [sessionHistory]);

  // Append new streamed messages to chatItems
  useEffect(() => {
    if (messages.length === 0) {
      mergedCountRef.current = 0;
      return;
    }
    const newCount = messages.length - mergedCountRef.current;
    if (newCount <= 0) return;

    const newMessages = messages.slice(mergedCountRef.current);
    mergedCountRef.current = messages.length;

    setChatItems((prev) => {
      const newItems: ChatItem[] = newMessages.map((event) => ({ event, isUser: false }));
      return [...prev, ...newItems];
    });
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatItems, isStreaming]);

  function handleSelectAgent(name: string) {
    setIsNewSession(false);
    navigate({ to: "/chat/$agentName", params: { agentName: name } });
  }

  function handleNewSession() {
    // Navigate without sessionId and set flag to force new session creation
    navigate({ to: "/chat/$agentName", params: { agentName: selectedAgent } });
    setChatItems([]);
    setIsNewSession(true);
    clearMessages();
  }

  function handleSwitchSession(sessionId: string) {
    setIsNewSession(false);
    navigate({
      to: "/chat/$agentName/$sessionId",
      params: { agentName: selectedAgent, sessionId },
    });
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming || !selectedAgent) return;

    const message = input.trim();
    setInput("");

    // Add user message to chat immediately
    const userEvent: StreamEvent = {
      type: "chunk",
      content: message,
      timestamp: Date.now().toString(),
    };
    setChatItems((prev) => [...prev, { event: userEvent, isUser: true }]);

    // Build session ID for backend: if we have a current session, pass it
    const sessionId = currentSessionId
      ? `${selectedAgent}/${currentSessionId}`
      : `chat-${selectedAgent}`;
    await sendMessage(() => sessionSend(sessionId, message, isNewSession));
    // After first message in a new session, clear the flag
    if (isNewSession) {
      setIsNewSession(false);
    }
  }

  const displayItems = useMemo(() => mergeAssistantChunks(chatItems), [chatItems]);

  if (agentsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <MessageCircle className="h-12 w-12 text-slate-300 dark:text-slate-700" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No agents yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Create an agent to start chatting
          </p>
        </div>
        <a
          href="/agents"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = "/agents";
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Create Agent
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Agent list sidebar */}
      <AgentListSidebar
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
      />

      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Session toolbar */}
        <SessionToolbar
          agentName={selectedAgent}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onNewSession={handleNewSession}
          onSwitchSession={handleSwitchSession}
        />

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-white p-4 dark:bg-slate-950"
        >
          {displayItems.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-400 dark:text-slate-600">
              <MessageCircle className="h-10 w-10" />
              <p className="mt-2 text-sm">
                {currentSessionId
                  ? "Start the conversation..."
                  : "Start a new session to begin chatting"}
              </p>
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

        {/* Input */}
        <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isStreaming || !selectedAgent}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim() || !selectedAgent}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
