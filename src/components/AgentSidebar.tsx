import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "@tanstack/react-router";
import { useAgents, useRemoveAgent } from "../hooks/useAgents";
import { useTeam, useLeaveTeam } from "../hooks/useTeams";
import ConfirmModal from "./modals/ConfirmModal";
import CreateAgentModal from "./modals/CreateAgentModal";
import AgentProfileModal from "./modals/AgentProfileModal";
import ManageTeamMembersModal from "./modals/ManageTeamMembersModal";
import {
  Search,
  Plus,
  Bot,
  Loader2,
  Trash2,
  Settings,
  UserCircle,
  UserPlus,
  Minus,
} from "lucide-react";

function AgentContextMenu({
  position,
  onClose,
  onViewProfile,
  onRemoveFromTeam,
  onDeleteAgent,
  showRemoveFromTeam,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  onViewProfile: () => void;
  onRemoveFromTeam?: () => void;
  onDeleteAgent?: () => void;
  showRemoveFromTeam: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onViewProfile();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <UserCircle className="h-4 w-4" />
        View Profile
      </button>
      {showRemoveFromTeam && onRemoveFromTeam && (
        <button
          onClick={() => {
            onRemoveFromTeam();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
        >
          <Minus className="h-4 w-4" />
          Remove from Team
        </button>
      )}
      {onDeleteAgent && (
        <button
          onClick={() => {
            onDeleteAgent();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-4 w-4" />
          Delete Agent
        </button>
      )}
    </div>
  );
}

export default function AgentSidebar() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const location = useLocation();
  const teamName = (params as Record<string, string | undefined>).teamName ?? "";
  const agentName = (params as Record<string, string | undefined>).agentName ?? "";

  const isHome = location.pathname === "/" || location.pathname === "/chat" ||
    (location.pathname.startsWith("/chat/") && !location.pathname.startsWith("/chat/team/"));

  const { data: team, isLoading: teamLoading } = useTeam(teamName);
  const { data: allAgents, isLoading: agentsLoading } = useAgents();
  const remove = useRemoveAgent();
  const leave = useLeaveTeam();
  const [search, setSearch] = useState("");
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<{ team: string; agent: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileAgent, setProfileAgent] = useState<string | null>(null);
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ agentName: string; x: number; y: number } | null>(null);

  const agents = useMemo(() => {
    if (!allAgents) return [];
    let filtered: typeof allAgents;
    if (isHome) {
      filtered = allAgents;
    } else {
      const memberNames = team?.members ?? [];
      filtered = memberNames.length > 0
        ? allAgents.filter((a) => memberNames.includes(a.name))
        : allAgents.filter((a) => a.memberships?.includes(teamName));
    }
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter((a) => a.name.toLowerCase().includes(q));
  }, [allAgents, team, teamName, search, isHome]);

  function handleSelectAgent(name: string) {
    if (isHome) {
      navigate({ to: "/chat/$agentName", params: { agentName: name } });
    } else {
      navigate({
        to: "/chat/team/$teamName/$agentName",
        params: { teamName, agentName: name },
      });
    }
  }

  const isLoading = (!isHome && teamLoading) || agentsLoading;

  return (
    <div className="flex h-full w-60 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
            {isHome ? "Direct Messages" : (team?.name ?? teamName ?? "Select a team")}
          </h3>
          {!isHome && (
            <button
              onClick={() => setManageMembersOpen(true)}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              title="Add member"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          )}
        </div>
        {isHome ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            All your agents
          </p>
        ) : team?.description && (
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ agentName: agent.name, x: e.clientX, y: e.clientY });
                  }}
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
                {/* Only show delete button in home mode; team removal is via right-click */}
                {isHome && (
                  <button
                    onClick={() => setConfirmName(agent.name)}
                    className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:text-slate-500 dark:hover:text-red-400"
                    title="Delete agent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-600">
            {search.trim() ? "No agents match" : (isHome ? "No agents yet" : "No agents in this team")}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        {isHome && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </button>
        )}
        {!isHome && (
          <button
            onClick={() => teamName && navigate({ to: "/teams/$name", params: { name: teamName } })}
            disabled={!teamName}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Settings className="h-4 w-4" />
            Team Settings
          </button>
        )}
      </div>

      {/* Delete agent confirm — home mode only */}
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

      {/* Remove from team confirm — team mode only */}
      <ConfirmModal
        open={!!confirmLeave}
        title="Remove from Team"
        message={`Remove agent "${confirmLeave?.agent ?? ""}" from team "${confirmLeave?.team ?? ""}"?`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmLeave) {
            leave.mutate({ team: confirmLeave.team, agent: confirmLeave.agent });
          }
          setConfirmLeave(null);
        }}
        onCancel={() => setConfirmLeave(null)}
      />

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <AgentProfileModal
        open={!!profileAgent}
        agentName={profileAgent ?? ""}
        onClose={() => setProfileAgent(null)}
      />

      <ManageTeamMembersModal
        open={manageMembersOpen}
        teamName={teamName}
        currentMembers={team?.members ?? []}
        onClose={() => setManageMembersOpen(false)}
      />

      {contextMenu && (
        <AgentContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onViewProfile={() => setProfileAgent(contextMenu.agentName)}
          showRemoveFromTeam={!isHome}
          onRemoveFromTeam={
            !isHome
              ? () => setConfirmLeave({ team: teamName, agent: contextMenu.agentName })
              : undefined
          }
          onDeleteAgent={
            isHome
              ? () => setConfirmName(contextMenu.agentName)
              : undefined
          }
        />
      )}
    </div>
  );
}
