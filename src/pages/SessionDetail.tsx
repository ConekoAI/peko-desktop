import { useParams } from "@tanstack/react-router";
import { useSession } from "../hooks/useSessions";
import SessionTimeline from "../components/SessionTimeline";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

export default function SessionDetail() {
  const { id } = useParams({ from: "/sessions/$id" });
  const { data: session, isLoading } = useSession(id);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">
        Session not found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
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

      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <SessionTimeline messages={session.messages} />
      </div>
    </div>
  );
}
