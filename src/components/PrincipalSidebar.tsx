import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { isGenesisPending, usePrincipals } from "../hooks/usePrincipals";
import { usePekohubBundle } from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";
import {
  useAccessiblePrincipals,
  useRemotePeko,
  useRemotePrincipalAdd,
  useRemotePrincipals,
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
  Loader2,
  UserCircle,
  Globe,
  Plus,
  Settings,
  Link as LinkIcon,
  Compass,
  Circle,
  Package,
} from "lucide-react";
import { DEFAULT_HUB_URL, type RemotePrincipalSummary } from "../lib/api";
import PekoAvatar from "./peko/PekoAvatar";
import { pekoIdentity } from "../lib/pekoIdentity";
import { unreadKey, useUnreadCounts } from "../lib/unread";

/**
 * One entry point for adding a peko: create one, wake one from a
 * `.peko` file, connect to someone else's, or browse public ones.
 */
function NewPekoMenu({
  onCreate,
  onImport,
  onConnect,
  onDiscover,
}: {
  onCreate?: () => void;
  onImport?: () => void;
  onConnect?: () => void;
  onDiscover: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const items = [
    { label: "Create a peko", icon: Plus, run: onCreate },
    { label: "Import a .peko file", icon: Package, run: onImport },
    { label: "Connect to a remote peko", icon: LinkIcon, run: onConnect },
    { label: "Discover public pekos", icon: Compass, run: onDiscover },
  ].filter((item) => item.run);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-line bg-surface-card py-1 shadow-lg"
        >
          {items.map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                run?.();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-soft hover:bg-surface-sunken"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
      >
        <Plus className="h-4 w-4" />
        New peko
      </button>
    </div>
  );
}

function PrincipalContextMenu({
  position,
  onClose,
  onOpenChat,
  onOpenProfile,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  onOpenChat: () => void;
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
      className="fixed z-50 w-48 rounded-lg border border-line bg-surface-card py-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onOpenChat();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-soft hover:bg-surface-sunken"
      >
        <UserCircle className="h-4 w-4" />
        Open Chat
      </button>
      <div className="my-1 border-t border-line" />
      <button
        onClick={() => {
          onOpenProfile();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-fg-soft hover:bg-surface-sunken"
      >
        <Settings className="h-4 w-4" />
        Profile
      </button>
    </div>
  );
}

/**
 * A peko's status dot in the list: its own heartbeat for a peko on
 * this runtime, the hub's record for a remote one. No dot when nobody
 * reported a status. Where the peko runs is the profile's business,
 * not the list's.
 */
function StatusDot({ status, name }: { status: PrincipalStatusValue; name: string }) {
  if (status === "unknown") return null;
  const badge = statusBadge(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center ${badge.color}`}
      data-testid={`principal-status-${name}`}
      title={badge.label}
    >
      <Circle className="h-1.5 w-1.5 fill-current" aria-hidden="true" />
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

function LocalStatusDot({ name }: { name: string }) {
  const { data } = usePrincipalStatus("local", name);
  return <StatusDot status={data?.status ?? "unknown"} name={name} />;
}

function UnreadBadge({ count, testId }: { count: number; testId: string }) {
  return (
    <span
      className="shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-brand-fg"
      data-testid={testId}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const ROW_CLASS = "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors";
const rowTone = (active: boolean) =>
  active ? "bg-brand-soft text-brand" : "text-fg-soft hover:bg-surface-sunken";

/**
 * A peko on someone else's runtime, saved in
 * `~/.peko/remote-principals.json`. It sits in the list like any other
 * peko, with the avatar its runtime announced to the hub.
 */
function RemotePekoRow({
  remote,
  active,
  unread,
  onOpen,
  onContextMenu,
}: {
  remote: RemotePrincipalSummary;
  active: boolean;
  unread: number;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { identity, status } = useRemotePeko(remote.runtimeId, remote.principalName);
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={`${ROW_CLASS} ${rowTone(active)}`}
    >
      <PekoAvatar peko={identity} size="sm" />
      <span
        className={[
          "min-w-0 flex-1 truncate",
          unread ? "font-semibold text-fg" : "font-medium",
        ].join(" ")}
      >
        {remote.principalName}
      </span>
      {unread > 0 && <UnreadBadge count={unread} testId={`unread-${remote.principalName}`} />}
      <StatusDot status={status.data?.status ?? "unknown"} name={remote.principalName} />
    </button>
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
    <div className="rounded-lg px-2.5 py-2 text-sm text-fg-soft">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate">
          <span className="block truncate font-medium">{peko.publicName}</span>
          <span className="block truncate text-[10px] text-fg-subtle">
            {peko.ownerName} · {peko.status}
          </span>
        </span>
        {alreadyAdded ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-brand">
            Added
          </span>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={addMut.isPending}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-card px-2 py-1 text-[11px] font-medium text-fg-soft transition-colors hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
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
        <p className="mt-1 text-[10px] text-danger">
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
  const unread = useUnreadCounts();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const principalName = (params as Record<string, string | undefined>).pekoName ?? "";
  const routeSearch = useSearch({ strict: false }) as Record<string, string | undefined>;
  const currentRuntimeId = routeSearch.runtimeId ?? "local";

  const { data: principals, isLoading } = usePrincipals();
  const { data: remotePrincipals } = useRemotePrincipals();
  const [search, setSearch] = useState("");
  const [profilePeko, setProfilePeko] = useState<{ name: string; runtimeId: string } | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    principalName: string;
    runtimeId: string;
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
      DEFAULT_HUB_URL,
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
  // Pekos on other runtimes sit in the same list, after this runtime's.
  const filteredRemote = useMemo(() => {
    if (!remotePrincipals) return [];
    const q = search.trim().toLowerCase();
    if (!q) return remotePrincipals;
    return remotePrincipals.filter(
      (rp) => rp.principalName.toLowerCase().includes(q) || rp.owner.toLowerCase().includes(q),
    );
  }, [remotePrincipals, search]);
  const listed = filtered.length + filteredRemote.length;

  // First-run empty state shows a richer emerald CTA inside the list
  // area; otherwise the persistent footer button below handles creation.
  const showFirstRunCTA = !isLoading && !search.trim() && listed === 0;

  function openContextMenu(e: React.MouseEvent, name: string, runtimeId: string) {
    e.preventDefault();
    setContextMenu({ principalName: name, runtimeId, x: e.clientX, y: e.clientY });
  }

  function handleSelect(name: string, runtimeId: string) {
    navigate({
      to: "/chat/$pekoName",
      params: { pekoName: name },
      search: { runtimeId },
    });
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-line bg-surface-raised">
      <div className="border-b border-line p-3">
        <h3 className="truncate text-sm font-semibold text-fg">
          Pekos
        </h3>
      </div>

      <div className="border-b border-line p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pekos…"
            className="w-full rounded-lg border border-line bg-surface-card py-1.5 pl-8 pr-3 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            <span className="text-xs text-slate-400">Loading...</span>
          </div>
        ) : listed > 0 ? (
          <div className="mb-3">
            {filtered.map((p) => {
              const active = p.name === principalName && currentRuntimeId === "local";
              return (
                <button
                  key={`local-${p.name}`}
                  onClick={() => handleSelect(p.name, "local")}
                  onContextMenu={(e) => openContextMenu(e, p.name, "local")}
                  className={`${ROW_CLASS} ${rowTone(active)}`}
                >
                  <PekoAvatar peko={pekoIdentity(p)} size="sm" />
                  <span
                    className={[
                      "min-w-0 flex-1 truncate",
                      unread[p.name] ? "font-semibold text-fg" : "font-medium",
                    ].join(" ")}
                  >
                    {p.name}
                  </span>
                  {!!unread[p.name] && (
                    <UnreadBadge count={unread[p.name]} testId={`unread-${p.name}`} />
                  )}
                  {/* Genesis (ADR-054): a freshly created peko can sit in
                      `genesis_pending` (or an earlier boot state) for up to
                      a few minutes. `isGenesisPending` treats an absent
                      `bootState` (older runtimes) as already organized, so
                      the badge never shows stale. */}
                  {isGenesisPending(p) && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn"
                      data-testid={`waking-badge-${p.name}`}
                      title="This peko is still booting (genesis in progress)"
                    >
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      waking…
                    </span>
                  )}
                  <LocalStatusDot name={p.name} />
                </button>
              );
            })}
            {filteredRemote.map((rp) => (
              <RemotePekoRow
                key={`${rp.runtimeId}-${rp.owner}-${rp.principalName}`}
                remote={rp}
                active={rp.principalName === principalName && rp.runtimeId === currentRuntimeId}
                unread={unread[unreadKey(rp.principalName, rp.runtimeId)] ?? 0}
                onOpen={() => handleSelect(rp.principalName, rp.runtimeId)}
                onContextMenu={(e) => openContextMenu(e, rp.principalName, rp.runtimeId)}
              />
            ))}
          </div>
        ) : showFirstRunCTA ? (
          <div className="px-2 py-8 text-center text-xs text-fg-subtle">
            <span className="block space-y-3">
              <span className="block">No pekos yet</span>
              {onCreateClick && (
                <button
                  type="button"
                  onClick={onCreateClick}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create your first peko
                </button>
              )}
            </span>
          </div>
        ) : (
          <div className="px-2 py-8 text-center text-xs text-fg-subtle">
            No pekos match
          </div>
        )}

        {accessiblePekos && accessiblePekos.length > 0 ? (
          <div className="mt-1">
            <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Accessible pekos
            </div>
            <p className="px-2.5 pb-1 text-[10px] text-fg-subtle">
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

      <div className="border-t border-line p-2">
        <NewPekoMenu
          onCreate={onCreateClick}
          onImport={onImportClick}
          onConnect={onConnectClick}
          onDiscover={() => navigate({ to: "/discover" })}
        />
      </div>

      {contextMenu && (
        <PrincipalContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onOpenChat={() => handleSelect(contextMenu.principalName, contextMenu.runtimeId)}
          onOpenProfile={() =>
            setProfilePeko({ name: contextMenu.principalName, runtimeId: contextMenu.runtimeId })
          }
        />
      )}

      {profilePeko && (
        <PrincipalProfileModal
          open
          principalName={profilePeko.name}
          runtimeId={profilePeko.runtimeId}
          onClose={() => setProfilePeko(null)}
          onRemoved={() => {
            setProfilePeko(null);
            navigate({ to: "/chat" });
          }}
        />
      )}
    </div>
  );
}
