import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { isGenesisPending, usePrincipals } from "../hooks/usePrincipals";
import { usePekohubBundle } from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";
import {
  AWAY_AFTER_DAYS,
  longAway,
  ownPekosToAdopt,
  ownPekosToForget,
  useAccessiblePrincipals,
  useAdoptPekoDms,
  useRemotePeko,
  useRemotePrincipalAdopt,
  useRemotePrincipalRemove,
  useRemotePrincipals,
} from "../hooks/useRemotePrincipals";
import {
  usePrincipalStatus,
  statusBadge,
  type PrincipalStatusValue,
} from "../hooks/usePrincipalStatus";
import PrincipalProfileModal from "./modals/PrincipalProfileModal";
import {
  Search,
  Loader2,
  UserCircle,
  Plus,
  Settings,
  Link as LinkIcon,
  Compass,
  Circle,
  Package,
  MessageCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { configuredHubUrl, type RemotePrincipalSummary } from "../lib/api";
import PekoAvatar from "./peko/PekoAvatar";
import { pekoIdentity } from "../lib/pekoIdentity";
import { unreadKey, useUnreadCounts } from "../lib/unread";
import {
  ChatSectionLabel,
  DmRequests,
  MessagePersonForm,
  PersonRow,
  usePeople,
} from "./PeopleSection";

/**
 * One entry point for starting a chat: create a peko, wake one from a
 * `.peko` file, connect to someone else's, browse public ones, or message a
 * person (runtime ADR-095 D6).
 */
function NewChatMenu({
  onCreate,
  onImport,
  onConnect,
  onDiscover,
  onMessagePerson,
}: {
  onCreate?: () => void;
  onImport?: () => void;
  onConnect?: () => void;
  onDiscover: () => void;
  onMessagePerson: () => void;
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
    { label: "Add a peko", icon: LinkIcon, run: onConnect },
    { label: "Discover public pekos", icon: Compass, run: onDiscover },
    { label: "Message a person", icon: MessageCircle, run: onMessagePerson },
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
        New chat
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
  // Runtime ADR-095 D6: DMs with people sit with the pekos' chats.
  const personChannel = (params as Record<string, string | undefined>).channelId ?? "";
  const [messagingPerson, setMessagingPerson] = useState(false);
  // The whole URL's search: the sidebar renders at the `/chat` level,
  // where the child route's `runtimeId` isn't in its own match.
  const routeSearch = useRouterState({ select: (s) => s.location.search }) as Record<
    string,
    string | undefined
  >;
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

  // Your pekos on your other computers (pekohub ADR-005's owner-scoped
  // list, read while this computer is signed in). Each is saved as a
  // remote peko and sits in the list like a peko of this computer: no
  // section of its own, nothing to connect. Same hub-URL source the
  // profile modal uses (`pekohub.base_url` setting, canonical hub
  // fallback).
  const { data: settings } = useSettings();
  const { data: pekohubBundle } = usePekohubBundle();
  const pekohubBaseUrl = useMemo(
    () =>
      configuredHubUrl(settings),
    [settings],
  );
  const { data: accessiblePekos, isSuccess: ownListed } = useAccessiblePrincipals(
    pekohubBundle ? pekohubBaseUrl : undefined,
    pekohubBundle?.access_token,
  );
  // Pekos you have DMs with on other computers join the list the same way.
  useAdoptPekoDms(pekohubBundle ? pekohubBaseUrl : undefined);

  const adoptMut = useRemotePrincipalAdopt();
  const adopting = useRef(new Set<string>());
  useEffect(() => {
    if (!accessiblePekos || !principals || !remotePrincipals) return;
    for (const peko of ownPekosToAdopt(accessiblePekos, principals, remotePrincipals)) {
      const key = `${peko.hubId}:${peko.principalName}`;
      if (adopting.current.has(key)) continue;
      adopting.current.add(key);
      // Forget the attempt once it settles: if the saved list still
      // doesn't show it as yours on the next read, it is tried again.
      adoptMut.mutate(
        { hubUrl: pekohubBaseUrl, peko },
        { onSettled: () => adopting.current.delete(key) },
      );
    }
  }, [accessiblePekos, principals, remotePrincipals, pekohubBaseUrl, adoptMut]);

  // Yours follow your account: one it no longer lists leaves this list.
  const removeMut = useRemotePrincipalRemove();
  const forgetting = useRef(new Set<string>());
  useEffect(() => {
    if (!ownListed || !accessiblePekos || !remotePrincipals) return;
    for (const gone of ownPekosToForget(accessiblePekos, pekohubBaseUrl, remotePrincipals)) {
      const key = gone.hubId ?? gone.principalName;
      if (forgetting.current.has(key)) continue;
      forgetting.current.add(key);
      removeMut.mutate(
        { hubUrl: gone.hubUrl, owner: gone.owner, principalName: gone.principalName },
        { onSettled: () => forgetting.current.delete(key) },
      );
    }
  }, [ownListed, accessiblePekos, pekohubBaseUrl, remotePrincipals, removeMut]);

  const filtered = useMemo(() => {
    if (!principals) return [];
    if (!search.trim()) return principals;
    const q = search.toLowerCase();
    return principals.filter((p) => p.name.toLowerCase().includes(q));
  }, [principals, search]);
  // Pekos on other runtimes sit in the same list, after this runtime's.
  const filteredRemote = useMemo(() => {
    if (!remotePrincipals) return [];
    // A saved peko that now lives on this computer is listed once, here.
    const hereHub = new Set((principals ?? []).map((p) => p.hubId).filter(Boolean));
    const remote = remotePrincipals.filter((rp) => !(rp.hubId && hereHub.has(rp.hubId)));
    const q = search.trim().toLowerCase();
    if (!q) return remote;
    return remote.filter(
      (rp) => rp.principalName.toLowerCase().includes(q) || rp.owner.toLowerCase().includes(q),
    );
  }, [remotePrincipals, principals, search]);
  // Pekos of computers away for days sit apart, folded, below the rest.
  const [showAway, setShowAway] = useState(false);
  const [presentRemote, awayRemote] = useMemo(() => {
    const now = Date.now();
    const present: RemotePrincipalSummary[] = [];
    const away: RemotePrincipalSummary[] = [];
    for (const rp of filteredRemote) {
      (longAway(rp, accessiblePekos, now) ? away : present).push(rp);
    }
    return [present, away];
  }, [filteredRemote, accessiblePekos]);
  const listed = filtered.length + filteredRemote.length;
  const people = usePeople(search);

  // First-run empty state shows a richer emerald CTA inside the list
  // area; otherwise the persistent footer button below handles creation.
  const showFirstRunCTA = !isLoading && !search.trim() && listed === 0 && people.length === 0;

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
          Chats
        </h3>
      </div>

      <div className="border-b border-line p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg border border-line bg-surface-card py-1.5 pl-8 pr-3 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <DmRequests />
        {people.length > 0 && (
          <div className="mb-2" data-testid="person-dms">
            <ChatSectionLabel>People</ChatSectionLabel>
            {people.map((person) => {
              const active = person.channelId === personChannel;
              return (
                <PersonRow
                  key={person.channelId}
                  person={person}
                  active={active}
                  rowClass={`${ROW_CLASS} ${rowTone(active)}`}
                />
              );
            })}
          </div>
        )}
        {people.length > 0 && listed > 0 && <ChatSectionLabel>Pekos</ChatSectionLabel>}
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
                      title="This peko is still setting itself up"
                    >
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      waking…
                    </span>
                  )}
                  <LocalStatusDot name={p.name} />
                </button>
              );
            })}
            {presentRemote.map((rp) => (
              <RemotePekoRow
                key={`${rp.runtimeId}-${rp.owner}-${rp.principalName}`}
                remote={rp}
                active={rp.principalName === principalName && rp.runtimeId === currentRuntimeId}
                unread={unread[unreadKey(rp.principalName, rp.runtimeId)] ?? 0}
                onOpen={() => handleSelect(rp.principalName, rp.runtimeId)}
                onContextMenu={(e) => openContextMenu(e, rp.principalName, rp.runtimeId)}
              />
            ))}
            {awayRemote.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAway((v) => !v)}
                  aria-expanded={showAway}
                  data-testid="away-pekos-toggle"
                  className="mt-2 flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] font-medium text-fg-subtle hover:text-fg-muted"
                >
                  {showAway ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Not seen for {AWAY_AFTER_DAYS}+ days ({awayRemote.length})
                </button>
                {showAway &&
                  awayRemote.map((rp) => (
                    <RemotePekoRow
                      key={`${rp.runtimeId}-${rp.owner}-${rp.principalName}`}
                      remote={rp}
                      active={rp.principalName === principalName && rp.runtimeId === currentRuntimeId}
                      unread={unread[unreadKey(rp.principalName, rp.runtimeId)] ?? 0}
                      onOpen={() => handleSelect(rp.principalName, rp.runtimeId)}
                      onContextMenu={(e) => openContextMenu(e, rp.principalName, rp.runtimeId)}
                    />
                  ))}
              </>
            )}
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
        ) : people.length > 0 ? null : (
          <div className="px-2 py-8 text-center text-xs text-fg-subtle">
            No chats match
          </div>
        )}

      </div>

      {messagingPerson && <MessagePersonForm onClose={() => setMessagingPerson(false)} />}

      <div className="border-t border-line p-2">
        <NewChatMenu
          onCreate={onCreateClick}
          onImport={onImportClick}
          onConnect={onConnectClick}
          onDiscover={() => navigate({ to: "/discover" })}
          onMessagePerson={() => setMessagingPerson(true)}
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
