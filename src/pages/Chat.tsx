import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useAgents } from "../hooks/useAgents";
import { useTeams } from "../hooks/useTeams";
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
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{formatTime(event.timestamp)}</span>
        </div>
        <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
          {isUser ? (
            <p className="whitespace-pre-wrap break-all">{event.content ?? ""}</p>
          ) : isError ? (
            <p className="whitespace-pre-wrap break-all text-red-600 dark:text-red-400">{event.content ?? ""}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none break-all">
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
  const params = useParams({ strict: false });
  const pathname = routerState.location.pathname;

  const { isLoading: teamsLoading } = useTeams();
  const { data: agents, isLoading: agentsLoading } = useAgents();

  // Parse route to determine mode: personal (home) vs team
  // / or /chat → home (personal)
  // /chat/$agentName → personal chat
  // /chat/$agentName/$sessionId → personal chat with session
  // /chat/team/$teamName → team view
  // /chat/team/$teamName/$agentName → team chat
  // /chat/team/$teamName/$agentName/$sessionId → team chat with session
  const pathParts = pathname.split("/").filter(Boolean);

  let isPersonal = true;
  let teamName: string | undefined;
  let agentName: string | undefined;
  let sessionId: string | undefined;

  if (pathParts[0] === "chat") {
    if (pathParts[1] === "team") {
      // Team mode: /chat/team/$teamName/...
      isPersonal = false;
      teamName = pathParts[2];
      agentName = pathParts[3];
      sessionId = pathParts[4];
    } else if (pathParts.length >= 2) {
      // Personal mode: /chat/$agentName/...
      agentName = pathParts[1];
      sessionId = pathParts[2];
    }
  }

  const paramTeam = (params as Record<string, string | undefined>).teamName;
  const paramAgent = (params as Record<string, string | undefined>).agentName;
  const paramSession = (params as Record<string, string | undefined>).sessionId;
  if (paramTeam) teamName = paramTeam;
  if (paramAgent) agentName = paramAgent;
  if (paramSession) sessionId = paramSession;

  // For team mode, filter agents by membership. For personal mode, show all.
  const visibleAgents = useMemo(() => {
    if (!agents) return [];
    if (isPersonal) return agents;
    const resolvedTeam = teamName ?? "";
    return agents.filter((a) => a.memberships?.includes(resolvedTeam));
  }, [agents, teamName, isPersonal]);

  const selectedAgent = agentName ?? visibleAgents[0]?.name ?? "";

  // Redirect / to /chat if no agent selected, or to personal chat if agents exist
  useEffect(() => {
    if (pathname === "/" && selectedAgent) {
      navigate({ to: "/chat/$agentName", params: { agentName: selectedAgent } });
    }
  }, [pathname, selectedAgent, navigate]);

  const { data: sessions, refetch: refetchSessions } = useSessions(selectedAgent || undefined);

  const [input, setInput] = useState("");
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [pendingNewSession, setPendingNewSession] = useState(false);

  const activeSessionId = sessions?.find((s) => s.status === "active")?.id;
  const currentSessionId = pendingNewSession
    ? sessionId
    : (sessionId ?? activeSessionId ?? sessions?.[0]?.id);

  const historyId = currentSessionId ? `${selectedAgent}/${currentSessionId}` : "";
  const { data: sessionHistory } = useSessionHistory(historyId);
  const { messages, isStreaming, error, sendMessage, clearMessages } = useIpcStream({
    channel: "peko-stream",
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const mergedCountRef = useRef(0);

  useEffect(() => {
    setChatItems([]);
    mergedCountRef.current = 0;
    clearMessages();
  }, [currentSessionId, clearMessages]);

  useEffect(() => {
    if (pendingNewSession) {
      clearMessages();
    }
  }, [pendingNewSession, clearMessages]);

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

  useEffect(() => {
    if (!pendingNewSession) return;
    if (isStreaming) return;
    if (messages.length === 0) return;

    refetchSessions().then((result) => {
      const newActiveSession = result.data?.find((s) => s.status === "active");
      if (newActiveSession && selectedAgent) {
        if (isPersonal) {
          navigate({
            to: "/chat/$agentName/$sessionId",
            params: { agentName: selectedAgent, sessionId: newActiveSession.id },
          });
        } else if (teamName) {
          navigate({
            to: "/chat/team/$teamName/$agentName/$sessionId",
            params: { teamName, agentName: selectedAgent, sessionId: newActiveSession.id },
          });
        }
      }
      setPendingNewSession(false);
    });
  }, [isStreaming, pendingNewSession, messages.length, selectedAgent, teamName, isPersonal, navigate, refetchSessions]);

  function handleNewSession() {
    if (!selectedAgent) return;
    if (isPersonal) {
      navigate({ to: "/chat/$agentName", params: { agentName: selectedAgent } });
    } else if (teamName) {
      navigate({
        to: "/chat/team/$teamName/$agentName",
        params: { teamName, agentName: selectedAgent },
      });
    }
    setChatItems([]);
    setPendingNewSession(true);
  }

  function handleSwitchSession(id: string) {
    if (!selectedAgent) return;
    setPendingNewSession(false);
    if (isPersonal) {
      navigate({
        to: "/chat/$agentName/$sessionId",
        params: { agentName: selectedAgent, sessionId: id },
      });
    } else if (teamName) {
      navigate({
        to: "/chat/team/$teamName/$agentName/$sessionId",
        params: { teamName, agentName: selectedAgent, sessionId: id },
      });
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming || !selectedAgent) return;

    const message = input.trim();
    setInput("");

    const userEvent: StreamEvent = {
      type: "chunk",
      content: message,
      timestamp: Date.now().toString(),
    };
    setChatItems((prev) => [...prev, { event: userEvent, isUser: true }]);

    const sid = currentSessionId ? `${selectedAgent}/${currentSessionId}` : `chat-${selectedAgent}`;
    await sendMessage(() => sessionSend(sid, message, pendingNewSession));
  }

  const displayItems = useMemo(() => mergeAssistantChunks(chatItems), [chatItems]);

  if (teamsLoading || agentsLoading) {
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
        <button
          onClick={() => navigate({ to: "/agents" })}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Create Agent
        </button>
      </div>
    );
  }

  if (!selectedAgent) {
    const hasAgents = agents && agents.length > 0;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <MessageCircle className="h-12 w-12 text-slate-300 dark:text-slate-700" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            {isPersonal
              ? (hasAgents ? "Select an agent to start chatting" : "No agents yet")
              : (hasAgents ? `No agents in ${teamName}` : "No agents yet")}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {isPersonal
              ? (hasAgents ? "Choose from the sidebar" : "Create an agent to start chatting")
              : (hasAgents ? "Assign agents to this team in Team Settings" : "Create an agent to start chatting")}
          </p>
        </div>
        {!hasAgents && (
          <button
            onClick={() => navigate({ to: "/agents" })}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Create Agent
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SessionToolbar
        agentName={selectedAgent}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
      />

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
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
