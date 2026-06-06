import { useState, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAgents, useRemoveAgent } from "../hooks/useAgents";
import { useTeam } from "../hooks/useTeams";
import ConfirmModal from "./modals/ConfirmModal";
import {
  Search,
  Plus,
  Bot,
  Loader2,
  Trash2,
  Settings,
} from "lucide-react";

export default function AgentSidebar() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const teamName = (params as Record<string, string | undefined>).teamName ?? "";
  const agentName = (params as Record<string, string | undefined>).agentName ?? "";

  const { data: team, isLoading: teamLoading } = useTeam(teamName);
  const { data: allAgents, isLoading: agentsLoading } = useAgents();
  const remove = useRemoveAgent();
  const [search, setSearch] = useState("");
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const agents = useMemo(() => {
    if (!allAgents) return [];
    const memberNames = team?.members ?? [];
    const filtered = memberNames.length > 0
      ? allAgents.filter((a) => memberNames.includes(a.name))
      : allAgents.filter((a) => a.memberships?.includes(teamName));
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter((a) => a.name.toLowerCase().includes(q));
  }, [allAgents, team, teamName, search]);

  function handleSelectAgent(name: string) {
    navigate({
      to: "/chat/$teamName/$agentName",
      params: { teamName, agentName: name },
    });
  }

  function handleNewAgent() {
    navigate({ to: "/agents" });
  }

  const isLoading = teamLoading || agentsLoading;

  return (
    <div className="flex h-full w-60 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {team?.name ?? teamName ?? "Select a team"}
        </h3>
        {team?.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            {team.description}
          </p>
        )}
      </div>

      <div className="border-b border-slate-200 p-2 dark:border-slate-800">
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
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            <span className="text-xs text-slate-400">Loading...</span>
          </div>
        ) : agents.length > 0 ? (
          agents.map((agent) => {
            const active = agent.name === agentName;
            return (
              <div
                key={agent.name}
                className={[
                  "group flex items-center gap-1 rounded-lg pr-1",
                  active
                    ? "bg-emerald-50 dark:bg-emerald-950/50"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                <button
                  onClick={() => handleSelectAgent(agent.name)}
                  className={[
                    "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-slate-700 dark:text-slate-300",
                  ].join(" ")}
                >
                  <Bot className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
                  {active && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  )}
                </button>
                <button
                  onClick={() => setConfirmName(agent.name)}
                  className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:text-slate-500 dark:hover:text-red-400"
                  title="Remove agent"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-600">
            {search.trim() ? "No agents match" : "No agents in this team"}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <button
          onClick={handleNewAgent}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </button>
        <button
          onClick={() => teamName && navigate({ to: "/teams/$name", params: { name: teamName } })}
          disabled={!teamName}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Settings className="h-4 w-4" />
          Team Settings
        </button>
      </div>

      <ConfirmModal
        open={!!confirmName}
        title="Remove Agent"
        message={`Are you sure you want to remove agent "${confirmName ?? ""}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmName) remove.mutate(confirmName);
          setConfirmName(null);
        }}
        onCancel={() => setConfirmName(null)}
      />
    </div>
  );
}
