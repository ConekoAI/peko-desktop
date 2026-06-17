import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useSession, useCompactSession, useBranchSession } from "../hooks/useSessions";
import SessionTimeline from "../components/SessionTimeline";
import ConfirmModal from "../components/modals/ConfirmModal";
import { formatDate } from "../lib/format";
import { sessionSend } from "../lib/api";
import {
  ArrowLeft,
  GitBranch,
  Minimize2,
  Send,
  Loader2,
  MessageSquare,
  Info,
  GitCommit,
} from "lucide-react";

type TabKey = "chat" | "info" | "branches";

export default function SessionDetail() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  const { data: session, isLoading } = useSession(id);
  const compact = useCompactSession();
  const branch = useBranchSession();

  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmCompact, setConfirmCompact] = useState(false);
  const [branchMessageId, setBranchMessageId] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || !id) return;
    setSending(true);
    try {
      await sessionSend(id, message.trim());
      setMessage("");
    } finally {
      setSending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
        <p className="text-sm text-slate-400 dark:text-slate-600">Loading session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <MessageSquare className="h-10 w-10 text-slate-300 dark:text-slate-700" />
        <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">Session not found</p>
        <Link
          to="/sessions"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sessions
        </Link>
      </div>
    );
  }

  const tabs: { id: TabKey; label: string; icon: React.ElementType }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "info", label: "Info", icon: Info },
    { id: "branches", label: "Branches", icon: GitCommit },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/sessions"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {session.title ?? `Session ${session.id.slice(0, 8)}`}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Agent: {session.agent} · {session.messageCount} messages
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setBranchMessageId(session.messages[session.messages.length - 1]?.id ?? null)}
            disabled={branch.isPending || session.messages.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {branch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            Branch
          </button>
          <button
            onClick={() => setConfirmCompact(true)}
            disabled={compact.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {compact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Minimize2 className="h-4 w-4" />}
            Compact
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:flex-none",
                activeTab === tab.id
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Chat Tab */}
      {activeTab === "chat" && (
        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <SessionTimeline messages={session.messages} />
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              disabled={sending}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={sending || !message.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </form>
        </div>
      )}

      {/* Info Tab */}
      {activeTab === "info" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Session Info</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">ID</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{session.id}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Agent</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{session.agent}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Status</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{session.status}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Messages</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{session.messageCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Created</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{formatDate(session.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Updated</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{formatDate(session.updatedAt)}</dd>
            </div>
            {session.parentId && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Parent</dt>
                <dd className="font-medium text-slate-900 dark:text-white">
                  <Link
                    to="/chat/$agentName/$sessionId"
                    params={{ agentName: session.agent, sessionId: session.parentId }}
                    className="text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {session.parentId.slice(0, 8)}
                  </Link>
                </dd>
              </div>
            )}
          </dl>

          {Object.keys(session.metadata).length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Metadata</h4>
              <pre className="overflow-auto rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {JSON.stringify(session.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Branches Tab */}
      {activeTab === "branches" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Branches</h3>
          {session.branches && session.branches.length > 0 ? (
            <ul className="space-y-2">
              {session.branches.map((branchId) => (
                <li key={branchId}>
                  <Link
                    to="/chat/$agentName/$sessionId"
                    params={{ agentName: session.agent, sessionId: branchId }}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-emerald-400 dark:hover:bg-slate-800"
                  >
                    <GitBranch className="h-4 w-4" />
                    {branchId}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-600">No branches yet</p>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmCompact}
        title="Compact Session"
        message="Compacting will summarize older messages to reduce token usage. This action cannot be undone."
        variant="warning"
        confirmText="Compact"
        onConfirm={() => {
          compact.mutate(id);
          setConfirmCompact(false);
        }}
        onCancel={() => setConfirmCompact(false)}
      />

      <ConfirmModal
        open={!!branchMessageId}
        title="Branch Session"
        message="Create a new branch from the latest message? The new session will inherit the conversation context up to this point."
        variant="info"
        confirmText="Branch"
        onConfirm={() => {
          if (branchMessageId) branch.mutate({ sessionId: id, messageId: branchMessageId });
          setBranchMessageId(null);
        }}
        onCancel={() => setBranchMessageId(null)}
      />
    </div>
  );
}
