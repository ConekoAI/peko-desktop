import { useState, useRef, useEffect } from "react";
import { useAgents } from "../hooks/useAgents";
import { useIpcStream } from "../hooks/useIpcStream";
import { sessionSend } from "../lib/api";
import { Send, Loader2, MessageCircle, X, User, Bot as BotIcon } from "lucide-react";
import type { StreamEvent } from "../types";

function formatTime(ts?: string) {
  if (!ts) return "";
  // Handle epoch millis string (e.g. "1780480809752") — parse as number
  const ms = Number(ts);
  if (!isNaN(ms) && ms > 1000000000000) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  // Fallback for ISO strings
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatMessage({ event }: { event: StreamEvent }) {
  const isUser = event.type === "tool_call" || (event.data?.role === "user");
  const isError = event.type === "error";

  return (
    <div className={["flex w-full", isUser ? "justify-end" : "justify-start"].join(" ")}>
      <div
        className={[
          "flex max-w-[80%] gap-2 rounded-xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-indigo-600 text-white"
            : isError
            ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
            : "bg-emerald-50 text-slate-800 dark:bg-emerald-950/30 dark:text-emerald-100",
        ].join(" ")}
      >
        <div className="mt-0.5 shrink-0">
          {isUser ? (
            <User className="h-4 w-4" />
          ) : isError ? (
            <X className="h-4 w-4" />
          ) : (
            <BotIcon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <p className="whitespace-pre-wrap break-words">{event.content ?? ""}</p>
          <span className="mt-1 block text-[10px] opacity-60">{formatTime(event.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [input, setInput] = useState("");
  const { messages, isStreaming, error, sendMessage, clearMessages } = useIpcStream({ channel: "peko-stream" });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (agents && agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0].name);
    }
  }, [agents, selectedAgent]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming || !selectedAgent) return;

    const message = input.trim();
    setInput("");

    // For now we use a placeholder session id derived from agent name.
    // In a full implementation this would create a session first.
    const sessionId = `chat-${selectedAgent}`;
    await sendMessage(() => sessionSend(sessionId, message));
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Chat</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Send messages to agents via IPC streaming
          </p>
        </div>
        <div className="flex items-center gap-3">
          {agentsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            >
              {agents?.map((agent) => (
                <option key={agent.name} value={agent.name}>
                  {agent.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={clearMessages}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400 dark:text-slate-600">
            <MessageCircle className="h-10 w-10" />
            <p className="mt-2 text-sm">Select an agent and send a message to start chatting</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => (
              <ChatMessage key={msg.id ?? idx} event={msg} />
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

      <form onSubmit={handleSend} className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming || !selectedAgent}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
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
  );
}
