import { useState, useMemo } from "react";
import { useAgents } from "../../hooks/useAgents";
import { useJoinTeam, useLeaveTeam } from "../../hooks/useTeams";
import { Search, X, Plus, Minus, Bot, Check, Loader2 } from "lucide-react";

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
  const leave = useLeaveTeam();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());

  const memberSet = new Set(currentMembers);

  const filteredAgents = useMemo(() => {
    if (!allAgents) return [];
    const q = search.trim().toLowerCase();
    if (!q) return allAgents;
    return allAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false)
    );
  }, [allAgents, search]);

  async function handleToggle(agentName: string) {
    setPending((prev) => new Set(prev).add(agentName));
    try {
      if (memberSet.has(agentName)) {
        await leave.mutateAsync({ team: teamName, agent: agentName });
      } else {
        await join.mutateAsync({ team: teamName, agent: agentName });
      }
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
              Manage Members
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add or remove agents from <span className="font-medium">{teamName}</span>
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
              {allAgents ? allAgents.length - currentMembers.length : 0} available
            </span>
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto p-2">
          {agentsLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-400 dark:text-slate-600">Loading agents...</p>
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
              {search.trim() ? "No agents match" : "No agents available"}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredAgents.map((agent) => {
                const isMember = memberSet.has(agent.name);
                const isPending = pending.has(agent.name);
                return (
                  <div
                    key={agent.name}
                    className={[
                      "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                      isMember
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                        : "border-transparent bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        isMember
                          ? "bg-emerald-100 dark:bg-emerald-900/50"
                          : "bg-slate-100 dark:bg-slate-800",
                      ].join(" ")}
                    >
                      <Bot
                        className={[
                          "h-4 w-4",
                          isMember
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-400 dark:text-slate-500",
                        ].join(" ")}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          {agent.name}
                        </span>
                        {isMember && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                            <Check className="h-2.5 w-2.5" />
                            Member
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                        {agent.model} · {agent.provider}
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggle(agent.name)}
                      disabled={isPending}
                      className={[
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                        isMember
                          ? "text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                          : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300",
                        isPending ? "opacity-50" : "",
                      ].join(" ")}
                      title={isMember ? "Remove from team" : "Add to team"}
                    >
                      {isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isMember ? (
                        <Minus className="h-3.5 w-3.5" />
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
