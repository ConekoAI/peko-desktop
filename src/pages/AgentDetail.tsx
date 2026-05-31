import { useParams } from "@tanstack/react-router";
import { useAgent } from "../hooks/useAgents";
import { formatDate } from "../lib/format";
import { ArrowLeft, Wrench, Puzzle } from "lucide-react";
import { Link } from "@tanstack/react-router";

const STATUS_STYLE: Record<string, string> = {
  idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  busy: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  offline: "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export default function AgentDetail() {
  const { name } = useParams({ from: "/agents/$name" });
  const { data: agent, isLoading } = useAgent(name);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">Loading...</div>
    );
  }

  if (!agent) {
    return (
      <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-600">
        Agent not found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/agents"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{agent.name}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{agent.description ?? "No description"}</p>
        </div>
        <span
          className={[
            "ml-auto inline-flex rounded-full px-3 py-1 text-xs font-medium",
            STATUS_STYLE[agent.status] ?? STATUS_STYLE.offline,
          ].join(" ")}
        >
          {agent.status}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Details</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Model</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{agent.model}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Team</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{agent.team ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Sessions</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{agent.sessionCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Created</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{formatDate(agent.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Updated</dt>
              <dd className="font-medium text-slate-900 dark:text-white">{formatDate(agent.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Tools</h3>
          </div>
          {agent.tools.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-600">No tools configured</p>
          ) : (
            <ul className="space-y-1.5">
              {agent.tools.map((tool) => (
                <li
                  key={tool}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <Wrench className="h-3 w-3 text-slate-400" />
                  {tool}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Extensions</h3>
          </div>
          {agent.extensions.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-600">No extensions installed</p>
          ) : (
            <ul className="space-y-1.5">
              {agent.extensions.map((ext) => (
                <li
                  key={ext}
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <Puzzle className="h-3 w-3 text-slate-400" />
                  {ext}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {agent.systemPrompt && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">System Prompt</h3>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {agent.systemPrompt}
          </pre>
        </div>
      )}
    </div>
  );
}
