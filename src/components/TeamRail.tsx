import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "@tanstack/react-router";
import { useTeams, useCreateTeam, useRemoveTeam } from "../hooks/useTeams";
import ConfirmModal from "./modals/ConfirmModal";
import {
  Plus,
  Settings,
  Loader2,
  X,
  Trash2,
  MessageCircle,
} from "lucide-react";
import type { TeamSummary } from "../types";

function getTeamInitials(name: string) {
  return name
    .split(/[-_\s]+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getTeamHue(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

function TeamIcon({ team, active }: { team: TeamSummary; active: boolean }) {
  const hue = getTeamHue(team.name);
  return (
    <div
      className={[
        "flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white transition-all",
        active ? "ring-2 ring-white ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-900 rounded-2xl" : "hover:rounded-2xl",
      ].join(" ")}
      style={{ backgroundColor: `hsl(${hue} 70% 45%)` }}
      title={team.name}
    >
      {getTeamInitials(team.name)}
    </div>
  );
}

function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTeam();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
      },
      { onSuccess: onClose }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create Team</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-team"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TeamContextMenu({
  position,
  onClose,
  onDelete,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
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
      className="fixed z-50 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>
    </div>
  );
}

export default function TeamRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false });
  const { data: teams, isLoading } = useTeams();
  const remove = useRemoveTeam();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ team: TeamSummary; x: number; y: number } | null>(null);

  const selectedTeam =
    (params as Record<string, string | undefined>).teamName ?? teams?.[0]?.name ?? "";

  function handleSelectTeam(name: string) {
    navigate({ to: "/chat/$teamName", params: { teamName: name } });
  }

  if (isLoading) {
    return (
      <aside className="flex h-full w-16 flex-col items-center border-r border-slate-200 bg-slate-50 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </aside>
    );
  }

  return (
    <>
      <aside className="flex h-full w-16 flex-col items-center gap-2 border-r border-slate-200 bg-slate-50 py-3 dark:border-slate-800 dark:bg-slate-900">
        {/* Home / Chat */}
        <button
          onClick={() => navigate({ to: "/" })}
          className={[
            "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
            (location.pathname === "/" || location.pathname.startsWith("/chat/"))
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
          ].join(" ")}
          title="Chat"
        >
          <MessageCircle className="h-5 w-5" />
        </button>

        <div className="h-px w-8 bg-slate-200 dark:bg-slate-800" />

        {/* Teams */}
        {teams?.map((team) => {
          const active = team.name === selectedTeam;
          return (
            <div key={team.name} className="relative group">
              <button
                onClick={() => handleSelectTeam(team.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ team, x: e.clientX, y: e.clientY });
                }}
                className={[
                  "relative flex items-center justify-center rounded-xl p-1 transition-colors",
                  active
                    ? "before:absolute before:-left-2 before:h-8 before:w-1 before:rounded-r-full before:bg-emerald-500 dark:before:bg-emerald-400"
                    : "",
                ].join(" ")}
              >
                <TeamIcon team={team} active={active} />
              </button>

              <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-slate-800 sm:block">
                {team.name}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => setCreateOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-400 transition-all hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-500 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
          title="New Team"
        >
          <Plus className="h-5 w-5" />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => navigate({ to: "/settings" })}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </aside>

      <CreateTeamModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmModal
        open={!!confirmName}
        title="Remove Team"
        message={`Are you sure you want to remove team "${confirmName ?? ""}"? This action cannot be undone.`}
        variant="danger"
        confirmText="Remove"
        onConfirm={() => {
          if (confirmName) remove.mutate(confirmName);
          setConfirmName(null);
        }}
        onCancel={() => setConfirmName(null)}
      />

      {contextMenu && (
        <TeamContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onDelete={() => setConfirmName(contextMenu.team.name)}
        />
      )}
    </>
  );
}
