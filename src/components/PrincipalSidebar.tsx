import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { isGenesisPending, usePrincipals } from "../hooks/usePrincipals";
import { useRuntimes, usePekohubBundle } from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";
import {
  useAccessiblePrincipals,
  useRemotePrincipalAdd,
  useRemotePrincipals,
  useRemotePrincipalRemove,
  type AccessiblePrincipal,
} from "../hooks/useRemotePrincipals";
import {
  usePrincipalStatus,
  statusBadge,
  type PrincipalStatusValue,
} from "../hooks/usePrincipalStatus";
import { shareUrlFor } from "../lib/discovery";
import PrincipalProfileModal from "./modals/PrincipalProfileModal";
import {
  Search,
  Bot,
  Loader2,
  UserCircle,
  Activity,
  Monitor,
  Globe,
  Plus,
  Settings,
  Link as LinkIcon,
  Trash2,
  Compass,
  Circle,
  Package,
} from "lucide-react";
import type { PrincipalSummary, RemotePrincipalSummary } from "../lib/api";

/**
 * PR #3: group principals by `runtime_id` so the sidebar can render
 * a "Local" section and one "Remote" section per remote runtime.
 *
 * `runtimeId` of `"local"` renders as "Local"; anything else is
 * presented using the raw id (`hub:pekohub.org` shows as
 * `hub:pekohub.org`) until PR #5 lands runtime aliases. The grouping
 * preserves the original list order inside each section.
 */
function groupByRuntime(
  principals: PrincipalSummary[],
): Array<{ runtimeId: string; label: string; items: PrincipalSummary[] }> {
  const buckets = new Map<string, PrincipalSummary[]>();
  for (const p of principals) {
    const key = p.runtimeId || "local";
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  return Array.from(buckets.entries()).map(([runtimeId, items]) => ({
    runtimeId,
    label: runtimeId === "local" ? "Local" : runtimeId,
    items,
  }));
}

function PrincipalContextMenu({
  position,
  onClose,
  onOpenChat,
  onOpenLog,
  onOpenProfile,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  onOpenChat: () => void;
  onOpenLog: () => void;
  onOpenProfile: () => void;
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
          onOpenChat();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <UserCircle className="h-4 w-4" />
        Open Chat
      </button>
      <button
        onClick={() => {
          onOpenLog();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Activity className="h-4 w-4" />
        View Activity
      </button>
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <button
        onClick={() => {
          onOpenProfile();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Settings className="h-4 w-4" />
        Settings
      </button>
    </div>
  );
}

/**
 * PR #9: per-row status indicator. Subscribes to `usePrincipalStatus`
 * for THIS principal's runtime/name pair so the sidebar pill matches
 * what the principal actually reports — not the runtime's generic
 * `connectionType`/`status` (which used to be the same thing for
 * every row and never updated).
 *
 * The `runtime` prop is kept around purely so we can pick the right
 * icon shape (Monitor vs Globe) and pass the hub URL down for the
 * remote polling path. If the runtime row isn't registered (e.g.
 * the principal record is stale), we fall back to "unknown".
 */
function PrincipalStatusIndicator({
  runtimeId,
  principalName,
  ownerForRemote,
  hubUrlForRemote,
  type,
}: {
  runtimeId: string;
  principalName: string;
  ownerForRemote?: string;
  hubUrlForRemote?: string;
  type: "local" | "remote";
}) {
  const { data } = usePrincipalStatus(
    runtimeId,
    principalName,
    ownerForRemote,
    hubUrlForRemote,
  );
  const status: PrincipalStatusValue = data?.status ?? "unknown";
  const badge = statusBadge(status);
  const Icon = type === "local" ? Monitor : Globe;
  return (
    <span
      className={`inline-flex items-center gap-1 ${badge.color}`}
      data-testid={`principal-status-${principalName}`}
      title={`${badge.label} · ${type}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <Circle
        className="h-1.5 w-1.5 fill-current"
        aria-hidden="true"
      />
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

/**
 * PR #4: a row representing a remote principal persisted in
 * `~/.peko/remote-principals.json`. Clicking navigates into the
 * chat with `runtimeId = hub:<hub_url>` so the PR #3 routing
 * layer can route messages through the HubRemoteClient once PR #5
 * lands. Until then the chat view falls back to opening the hub's
 * web chat in a new tab (preserves the IDE tab from a stale
 * resolution).
 *
 * Right-click surfaces a "Remove" action that drops the record
 * from the JSON table. The action lives on the row because remote
 * principals are a storage concept, not a runtime one — they have
 * no in-runtime profile to open.
 */
function RemotePrincipalRow({
  remote,
  active,
  onOpen,
}: {
  remote: RemotePrincipalSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const removeMut = useRemotePrincipalRemove();
  return (
    <div
      className={[
        "group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
      ].join(" ")}
      onContextMenu={(e) => {
        e.preventDefault();
        if (window.confirm(`Remove ${remote.displayName}?`)) {
          removeMut.mutate({
            hubUrl: remote.hubUrl,
            owner: remote.owner,
            principalName: remote.principalName,
          });
        }
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Globe className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        <span className="min-w-0 flex-1 truncate">
          <span className="block truncate font-medium">{remote.displayName}</span>
          <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
            {remote.owner} · {shortHub(remote.hubUrl)}
            {remote.hasInviteToken ? " · token" : ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`Remove ${remote.displayName}?`)) {
            removeMut.mutate({
              hubUrl: remote.hubUrl,
              owner: remote.owner,
              principalName: remote.principalName,
            });
          }
        }}
        className="hidden shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600 group-hover:block dark:hover:bg-slate-700"
        aria-label={`Remove ${remote.displayName}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {active && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      )}
    </div>
  );
}

/** `https://pekohub.org/foo` → `pekohub.org`. */
function shortHub(hubUrl: string): string {
  try {
    return new URL(hubUrl).host;
  } catch {
    return hubUrl;
  }
}

/**
 * Pekohub ADR-005: a row from the hub's `/v1/me/accessible-pekos`
 * endpoint (the signed-in user's own pekos plus `private`-exposure
 * entries they can reach). Clicking connects the desktop to the peko
 * through the standard share-link add flow, then opens its chat.
 */
function AccessiblePekoRow({
  peko,
  hubUrl,
  alreadyAdded,
  onOpen,
}: {
  peko: AccessiblePrincipal;
  hubUrl: string;
  alreadyAdded: boolean;
  onOpen: () => void;
}) {
  const addMut = useRemotePrincipalAdd();
  const [addError, setAddError] = useState<string | null>(null);

  function handleConnect() {
    setAddError(null);
    addMut.mutate(shareUrlFor(hubUrl, peko), {
      onSuccess: onOpen,
      onError: (err) =>
        setAddError(err instanceof Error ? err.message : String(err)),
    });
  }

  return (
    <div className="rounded-lg px-2.5 py-2 text-sm text-slate-700 dark:text-slate-300">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        <span className="min-w-0 flex-1 truncate">
          <span className="block truncate font-medium">{peko.publicName}</span>
          <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
            {peko.ownerName} · {peko.status}
          </span>
        </span>
        {alreadyAdded ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Added
          </span>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={addMut.isPending}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {addMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <LinkIcon className="h-3 w-3" />
            )}
            Connect
          </button>
        )}
      </div>
      {addError && (
        <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
          {addError}
        </p>
      )}
    </div>
  );
}

export default function PrincipalSidebar({
  onCreateClick,
  onConnectClick,
  onImportClick,
}: {
  onCreateClick?: () => void;
  onConnectClick?: () => void;
  onImportClick?: () => void;
} = {}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const principalName = (params as Record<string, string | undefined>).pekoName ?? "";

  const { data: principals, isLoading } = usePrincipals();
  const { data: remotePrincipals } = useRemotePrincipals();
  const { data: runtimes } = useRuntimes();
  const [search, setSearch] = useState("");
  const [profilePrincipal, setProfilePrincipal] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    principalName: string;
    x: number;
    y: number;
  } | null>(null);

  // Pekohub ADR-005: "accessible pekos" — the signed-in user's own
  // pekos plus private-exposure entries they can reach. The endpoint
  // is owner-scoped, so the section only renders while a PekoHub
  // OAuth bundle is stored. Same hub-URL source the profile modal
  // uses (`pekohub.base_url` setting, canonical hub fallback).
  const { data: settings } = useSettings();
  const { data: pekohubBundle } = usePekohubBundle();
  const pekohubBaseUrl = useMemo(
    () =>
      settings?.find((s) => s.key === "pekohub.base_url")?.value ??
      "https://pekohub.org",
    [settings],
  );
  const { data: accessiblePekos } = useAccessiblePrincipals(
    pekohubBundle ? pekohubBaseUrl : undefined,
    pekohubBundle?.access_token,
  );

  const filtered = useMemo(() => {
    if (!principals) return [];
    if (!search.trim()) return principals;
    const q = search.toLowerCase();
    return principals.filter((p) => p.name.toLowerCase().includes(q));
  }, [principals, search]);

  // First-run empty state shows a richer emerald CTA inside the list
  // area; otherwise the persistent footer button below handles creation.
  const showFirstRunCTA = !isLoading && !search.trim() && filtered.length === 0;

  function handleSelect(name: string, runtimeId: string) {
    navigate({
      to: "/chat/$pekoName",
      params: { pekoName: name },
      search: { runtimeId },
    });
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          Pekos
        </h3>
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
          Your pekos, grouped by runtime
        </p>
      </div>

      <div className="border-b border-slate-200 p-2 dark:border-slate-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pekos…"
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
        ) : filtered.length > 0 ? (
          // PR #3: group principals by `runtime_id` so the sidebar
          // shows "Local" and "Remote" sections once PR #4 + #5
          // add remote principals. The grouping is runtime-agnostic
          // today — every principal has `runtimeId === "local"`
          // until PR #4 lands — so the header only renders when
          // there is more than one distinct runtime.
          groupByRuntime(filtered).map(({ runtimeId, label, items }) => (
            <div key={runtimeId} className="mb-3">
              {groupByRuntime(filtered).length > 1 ? (
                <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {label}
                </div>
              ) : null}
              {items.map((p) => {
            const active = p.name === principalName;
            const runtime = runtimes?.find((r) => r.id === p.runtimeId);
            const isLocal = p.runtimeId === "local";
            return (
              <button
                key={`${p.runtimeId}-${p.name}`}
                onClick={() => handleSelect(p.name, p.runtimeId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ principalName: p.name, x: e.clientX, y: e.clientY });
                }}
                className={[
                  "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                <Bot className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {/* Genesis (ADR-054): a freshly created peko can sit in
                    `genesis_pending` (or an earlier boot state) for up to
                    a few minutes. `isGenesisPending` treats an absent
                    `bootState` (older runtimes) as already organized, so
                    the badge never shows stale. */}
                {isGenesisPending(p) && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    data-testid={`waking-badge-${p.name}`}
                    title="This peko is still booting (genesis in progress)"
                  >
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    waking…
                  </span>
                )}
                {/* PR #9: per-row live status indicator. For remote
                    principals we forward `owner` + `pekohubUrl` from
                    the registered runtime; if the runtime row hasn't
                    been registered, we fall back to the cached
                    remote-principal record's hub URL so polling
                    still works. */}
                <PrincipalStatusIndicator
                  runtimeId={p.runtimeId}
                  principalName={p.name}
                  ownerForRemote={isLocal ? undefined : p.owner}
                  hubUrlForRemote={
                    isLocal
                      ? undefined
                      : runtime?.pekohubUrl ??
                        remotePrincipals?.find(
                          (rp) => rp.principalName === p.name && rp.runtimeId === p.runtimeId,
                        )?.hubUrl
                  }
                  type={isLocal ? "local" : "remote"}
                />
                {active && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                )}
              </button>
            );
              })}
            </div>
          ))
        ) : showFirstRunCTA ? (
          <div className="px-2 py-8 text-center text-xs text-slate-400 dark:text-slate-600">
            <span className="block space-y-3">
              <span className="block">No pekos yet</span>
              {onCreateClick && (
                <button
                  type="button"
                  onClick={onCreateClick}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create your first peko
                </button>
              )}
            </span>
          </div>
        ) : (
          <div className="px-2 py-8 text-center text-xs text-slate-400 dark:text-slate-600">
            No pekos match
          </div>
        )}

        {remotePrincipals && remotePrincipals.length > 0 ? (
          <div className="mt-1">
            <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Remote
            </div>
            {remotePrincipals
              .filter(
                (rp) =>
                  !search.trim() ||
                  rp.principalName.toLowerCase().includes(search.toLowerCase()) ||
                  rp.owner.toLowerCase().includes(search.toLowerCase()),
              )
              .map((rp) => (
                <RemotePrincipalRow
                  key={`${rp.hubUrl}-${rp.owner}-${rp.principalName}`}
                  remote={rp}
                  active={rp.principalName === principalName}
                  onOpen={() => handleSelect(rp.principalName, rp.runtimeId)}
                />
              ))}
          </div>
        ) : null}

        {accessiblePekos && accessiblePekos.length > 0 ? (
          <div className="mt-1">
            <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Accessible pekos
            </div>
            <p className="px-2.5 pb-1 text-[10px] text-slate-400 dark:text-slate-500">
              Your pekos on {shortHub(pekohubBaseUrl)}, including private ones
              only you can reach.
            </p>
            {accessiblePekos
              .filter(
                (ap) =>
                  !search.trim() ||
                  ap.publicName.toLowerCase().includes(search.toLowerCase()) ||
                  ap.ownerName.toLowerCase().includes(search.toLowerCase()),
              )
              .map((ap) => (
                <AccessiblePekoRow
                  key={ap.id || `${ap.ownerName}-${ap.publicName}`}
                  peko={ap}
                  hubUrl={pekohubBaseUrl}
                  alreadyAdded={
                    !!remotePrincipals?.some(
                      (rp) =>
                        rp.owner === ap.ownerName &&
                        rp.principalName === ap.principalName,
                    )
                  }
                  onOpen={() =>
                    handleSelect(ap.principalName, `hub:${pekohubBaseUrl}`)
                  }
                />
              ))}
          </div>
        ) : null}
      </div>

      {(onCreateClick || onConnectClick || onImportClick) && (
        <div className="space-y-1 border-t border-slate-200 p-2 dark:border-slate-800">
          {onCreateClick && (
            <button
              type="button"
              onClick={onCreateClick}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              <span>Create peko</span>
            </button>
          )}
          {onImportClick && (
            <button
              type="button"
              onClick={onImportClick}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Package className="h-4 w-4" />
              <span>Import .peko</span>
            </button>
          )}
          {onConnectClick && (
            <button
              type="button"
              onClick={onConnectClick}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LinkIcon className="h-4 w-4" />
              <span>Connect to a remote peko</span>
            </button>
          )}
          {/* PR #8: in-app discovery button. Always rendered so a
              user who hasn't added any remote pekos can still
              browse the public hub from inside the desktop. */}
          <button
            type="button"
            onClick={() => navigate({ to: "/discover" })}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Compass className="h-4 w-4" />
            <span>Discover public pekos</span>
          </button>
        </div>
      )}

      {contextMenu && (
        <PrincipalContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onOpenChat={() =>
            navigate({
              to: "/chat/$pekoName",
              params: { pekoName: contextMenu.principalName },
            })
          }
          onOpenLog={() =>
            navigate({
              to: "/log/$pekoName",
              params: { pekoName: contextMenu.principalName },
            })
          }
          onOpenProfile={() => setProfilePrincipal(contextMenu.principalName)}
        />
      )}

      {profilePrincipal && (
        <PrincipalProfileModal
          open={!!profilePrincipal}
          principalName={profilePrincipal}
          onClose={() => setProfilePrincipal(null)}
          onRemoved={() => {
            setProfilePrincipal(null);
            navigate({ to: "/chat" });
          }}
        />
      )}
    </div>
  );
}
