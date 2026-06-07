import { useState, useMemo } from "react";
import { useAgents } from "../../hooks/useAgents";
import { useJoinTeam } from "../../hooks/useTeams";
import { Search, X, Plus, Bot, Loader2 } from "lucide-react";

interface ManageTeamMembersModalProps {
  open: boolean;
  teamName: string;
  currentMembers: string[];
  onClose: () => void;
}

export default function ManageTeamMembersModal({
  open,
  teamName,
  currentMembers,
  onClose,
}: ManageTeamMembersModalProps) {
  const { data: allAgents, isLoading: agentsLoading } = useAgents();
  const join = useJoinTeam();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());

  const memberSet = new Set(currentMembers);

  const availableAgents = useMemo(() => {
    if (!allAgents) return [];
    // Only show agents that are NOT already members
    const nonMembers = allAgents.filter((a) => !memberSet.has(a.name));
    const q = search.trim().toLowerCase();
    if (!q) return nonMembers;
    return nonMembers.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false)
    );
  }, [allAgents, memberSet, search]);

  async function handleAdd(agentName: string) {
    setPending((prev) => new Set(prev).add(agentName));
    try {
      await join.mutateAsync({ team: teamName, agent: agentName });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Add Members
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add agents to <span className="font-medium">{teamName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              {currentMembers.length} member{currentMembers.length !== 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
              {availableAgents.length} available
            </span>
          </div>
        </div>

        {/* Agent list — non-members only */}
        <div className="flex-1 overflow-y-auto p-2">
          {agentsLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-400 dark:text-slate-600">Loading agents...</p>
            </div>
          ) : availableAgents.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
              {search.trim() ? "No agents match" : "All agents are already in this team"}
            </div>
          ) : (
            <div className="space-y-1">
              {availableAgents.map((agent) => {
                const isPending = pending.has(agent.name);
                return (
                  <div
                    key={agent.name}
                    className="flex items-center gap-3 rounded-lg border border-transparent bg-white px-3 py-2 transition-colors hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                      <Bot className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          {agent.name}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                        {agent.model} · {agent.provider}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAdd(agent.name)}
                      disabled={isPending}
                      className={[
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300",
                        isPending ? "opacity-50" : "",
                      ].join(" ")}
                      title="Add to team"
                    >
                      {isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {currentMembers.length} member{currentMembers.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
