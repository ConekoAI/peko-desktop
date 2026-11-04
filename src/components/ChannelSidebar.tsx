import { useState, useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Search, Hash, Link2, Loader2, Mail, MessageCircle, Plus, User } from "lucide-react";
import {
  channelInfoQuery,
  hasLeftGroup,
  useChannelInfo,
  useChannels,
} from "../hooks/useChannels";
import { usePrincipals } from "../hooks/usePrincipals";
import {
  dmRequestAnswer,
  dmRequests,
  groupInvitationAnswer,
  groupInvitations,
  groupJoin,
  personDmOpen,
  personDms,
  personGroups,
} from "../lib/api";
import { personLabel } from "../lib/people";
import RuntimeBadge from "./RuntimeBadge";

/**
 * Channel sidebar. Mirrors `PrincipalSidebar.tsx`: `w-60` surface,
 * search box, runtime-grouped list, per-row active indicator,
 * footer CTAs. PR-3 wires the "+ New channel" button to a layout-
 * level `ChannelCreateModal` (matches the `CreatePrincipalModal`
 * hoist pattern at `Layout.tsx:222`).
 *
 * The list is built by `useChannels` which fans out across the
 * local principals and dedupes by `channelId`. For PR-1 every
 * channel lived on the local runtime; PR-3's receiver-bootstrap
 * path (`ChannelStore::join_remote`) lets the sidebar also surface
 * channels that were invited in from a peer runtime. The runtime-
 * badge column already handles the runtime attribution so PR-3
 * doesn't need to touch the row component.
 */
export default function ChannelSidebar({
  onCreateClick,
}: {
  onCreateClick?: () => void;
} = {}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const channelId =
    (params as Record<string, string | undefined>).channelId ?? "";
  const [search, setSearch] = useState("");

  const { data: principals } = usePrincipals();
  const principalNames = useMemo(
    () => (principals ?? []).map((p) => p.name),
    [principals],
  );

  const { data: pekoChannels, isLoading } = useChannels(principalNames);
  const qc = useQueryClient();

  // Runtime ADR-092 D2: groups on other computers that invited you, and
  // the ones you joined. Both are empty when this computer isn't signed in.
  const { data: invitations } = useQuery({
    queryKey: ["group-invitations"],
    queryFn: groupInvitations,
    refetchInterval: 30_000,
  });
  const { data: joined } = useQuery({
    queryKey: ["person-groups"],
    queryFn: personGroups,
    refetchInterval: 30_000,
  });
  const answer = useMutation({
    mutationFn: ({ channelId, accept }: { channelId: string; accept: boolean }) =>
      groupInvitationAnswer(channelId, accept),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["group-invitations"] });
      void qc.invalidateQueries({ queryKey: ["person-groups"] });
    },
  });
  // Runtime ADR-095 D6: DMs with other people, and people asking to DM you.
  const { data: people } = useQuery({
    queryKey: ["person-dms"],
    queryFn: personDms,
    refetchInterval: 15_000,
  });
  const { data: requests } = useQuery({
    queryKey: ["dm-requests"],
    queryFn: dmRequests,
    refetchInterval: 30_000,
  });
  const answerRequest = useMutation({
    mutationFn: ({ channelId, answer }: { channelId: string; answer: "accept" | "decline" | "block" }) =>
      dmRequestAnswer(channelId, answer),
    onSuccess: (opened) => {
      void qc.invalidateQueries({ queryKey: ["dm-requests"] });
      void qc.invalidateQueries({ queryKey: ["person-dms"] });
      void qc.invalidateQueries({ queryKey: ["blocked-people"] });
      if (opened) openPersonDm(opened);
    },
  });
  function openPersonDm(id: string) {
    navigate({
      to: "/channels/$channelId",
      params: { channelId: id },
      search: { runtimeId: "local" },
    });
  }
  const shownPeople = useMemo(() => {
    const rows = people ?? [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((p) => personLabel(p).toLowerCase().includes(q) || p.account.includes(q));
  }, [people, search]);

  const channels = useMemo(() => {
    if (!pekoChannels && !joined) return undefined;
    const rows = [...(pekoChannels ?? [])];
    for (const g of joined ?? []) {
      if (!rows.some((r) => r.channelId === g.channelId)) {
        rows.push({ channelId: g.channelId, runtimeId: "local", memberPrincipals: [] });
      }
    }
    return rows;
  }, [pekoChannels, joined]);

  // Search by the group's name (once its info has loaded) or its id.
  const filtered = useMemo(() => {
    if (!channels) return [];
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter((c) => {
      const name = qc.getQueryData<{ name?: string }>(["channel-info", c.channelId])?.name ?? "";
      return name.toLowerCase().includes(q) || c.channelId.toLowerCase().includes(q);
    });
  }, [channels, search, qc]);

  // Groups you left are hidden; the list is empty when they all are.
  const infos = useQueries({
    queries: filtered.map((c) => channelInfoQuery(c.channelId)),
  });
  const visible = filtered.filter((_, i) => !hasLeftGroup(infos[i]?.data, infos[i]?.error));

  function handleSelect(
    selectedId: string,
    runtimeId: string,
    memberPrincipals: string[],
  ) {
    // PR-2a: stamp `sender` from the first member principal so the
    // composer is wired without forcing the user to edit the URL.
    // PR-3 will replace this with a proper "post as" selector that
    // surfaces the choice when the user is a member of the channel
    // via multiple principals.
    const sender = memberPrincipals[0];
    navigate({
      to: "/channels/$channelId",
      params: { channelId: selectedId },
      search: sender ? { runtimeId, sender } : { runtimeId },
    });
  }

  return (
    <div className="flex h-full w-60 flex-col border-r border-line bg-surface-raised">
      <div className="border-b border-line p-3">
        <h3 className="truncate text-sm font-semibold text-fg">
          Groups
        </h3>
      </div>

      <div className="border-b border-line p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-fg-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="w-full rounded-lg border border-line bg-surface-card py-1.5 pl-8 pr-3 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            data-testid="channel-search"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {(invitations ?? []).length > 0 && (
          <div className="mb-2 space-y-1" data-testid="group-invitations">
            <div className="px-2 pb-1 text-xs font-medium text-fg-subtle">Invitations</div>
            {invitations!.map((i) => (
              <div
                key={i.channelId}
                className="rounded-lg border border-line bg-surface-card p-2 text-sm"
                data-testid={`invitation-${i.channelId}`}
              >
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{i.name}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-fg-subtle">
                  {i.members} {i.members === 1 ? "member" : "members"} · from {i.inviter}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ channelId: i.channelId, accept: true })}
                    className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ channelId: i.channelId, accept: false })}
                    className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {answer.error && (
              <div className="px-2 text-xs text-red-600 dark:text-red-400">
                {String(answer.error instanceof Error ? answer.error.message : answer.error)}
              </div>
            )}
          </div>
        )}
        {(requests ?? []).length > 0 && (
          <div className="mb-2 space-y-1" data-testid="dm-requests">
            <div className="px-2 pb-1 text-xs font-medium text-fg-subtle">Message requests</div>
            {requests!.map((r) => (
              <div
                key={r.channelId}
                className="rounded-lg border border-line bg-surface-card p-2 text-sm"
                data-testid={`dm-request-${r.channelId}`}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">
                    {r.name ?? r.account}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-fg-subtle">
                  wants to message you. You&apos;ll see what they wrote once you accept.
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={answerRequest.isPending}
                    onClick={() => answerRequest.mutate({ channelId: r.channelId, answer: "accept" })}
                    className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={answerRequest.isPending}
                    onClick={() => answerRequest.mutate({ channelId: r.channelId, answer: "decline" })}
                    className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={answerRequest.isPending}
                    onClick={() => answerRequest.mutate({ channelId: r.channelId, answer: "block" })}
                    className="ml-auto rounded-md px-2.5 py-1 text-xs text-danger hover:bg-danger-soft disabled:opacity-50"
                  >
                    Block
                  </button>
                </div>
              </div>
            ))}
            {answerRequest.error && (
              <div className="px-2 text-xs text-red-600 dark:text-red-400">
                {String(
                  answerRequest.error instanceof Error
                    ? answerRequest.error.message
                    : answerRequest.error,
                )}
              </div>
            )}
          </div>
        )}
        {shownPeople.length > 0 && (
          <div className="mb-2 space-y-1" data-testid="person-dms">
            <div className="px-2 pb-1 text-xs font-medium text-fg-subtle">People</div>
            {shownPeople.map((p) => (
              <button
                key={p.channelId}
                onClick={() => openPersonDm(p.channelId)}
                data-testid={`person-dm-row-${p.channelId}`}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  p.channelId === channelId ? "bg-brand-soft text-brand" : "text-fg-soft hover:bg-surface-sunken",
                ].join(" ")}
              >
                <User className="h-4 w-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{personLabel(p)}</span>
                {p.waiting && <span className="shrink-0 text-xs text-fg-subtle">invited</span>}
              </button>
            ))}
          </div>
        )}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />
            <span className="text-xs text-fg-subtle">Loading…</span>
          </div>
        ) : visible.length > 0 ? (
          <div className="space-y-1">
            {visible.map((c) => (
              <GroupRow
                key={c.channelId}
                channelId={c.channelId}
                runtimeId={c.runtimeId}
                active={c.channelId === channelId}
                onSelect={() =>
                  handleSelect(c.channelId, c.runtimeId || "local", c.memberPrincipals)
                }
              />
            ))}
          </div>
        ) : shownPeople.length > 0 ? null : (
          <div
            className="px-2 py-8 text-center text-xs text-fg-subtle"
            data-testid="channel-empty"
          >
            {search.trim()
              ? "No groups match"
              : "No groups yet."}
          </div>
        )}
      </div>

      <MessagePerson onOpened={openPersonDm} />
      <JoinGroup />

      {onCreateClick && (
        <div className="border-t border-line p-2">
          <button
            type="button"
            onClick={onCreateClick}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
            data-testid="channel-new"
          >
            <Plus className="h-4 w-4" />
            <span>New group</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Message a person by their PekoHub account ID (runtime ADR-095 D6). They
 * get a message request; the DM opens here at once, and what you write
 * reaches them when they accept.
 */
function MessagePerson({ onOpened }: { onOpened: (channelId: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const start = useMutation({
    mutationFn: () => personDmOpen(account.trim().replace(/^user:hub:/, ""), name.trim() || undefined),
    onSuccess: (channelId) => {
      setAccount("");
      setName("");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["person-dms"] });
      onOpened(channelId);
    },
  });
  if (!open) {
    return (
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
          data-testid="person-dm-open"
        >
          <MessageCircle className="h-4 w-4" />
          <span>Message a person</span>
        </button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2 border-t border-line p-2"
      data-testid="person-dm-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (account.trim()) start.mutate();
      }}
    >
      <input
        type="text"
        value={account}
        autoFocus
        onChange={(e) => setAccount(e.target.value)}
        placeholder="Their PekoHub account ID"
        className="w-full rounded-lg border border-line bg-surface-card px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        data-testid="person-dm-account"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What to call them (optional)"
        className="w-full rounded-lg border border-line bg-surface-card px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        data-testid="person-dm-name"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!account.trim() || start.isPending}
          className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
        >
          {start.isPending ? "Opening…" : "Message"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            start.reset();
          }}
          className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
      <div className="text-xs text-fg-subtle">
        They get a message request. What you write reaches them once they accept.
      </div>
      {start.error && (
        <div className="text-xs text-red-600 dark:text-red-400" data-testid="person-dm-error">
          {String(start.error instanceof Error ? start.error.message : start.error)}
        </div>
      )}
    </form>
  );
}

/** One group you are in: its name, its id until the name loads. */
function GroupRow({
  channelId,
  runtimeId,
  active,
  onSelect,
}: {
  channelId: string;
  runtimeId?: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { data: info } = useChannelInfo(channelId);
  return (
    <button
      onClick={onSelect}
      data-testid={`channel-row-${channelId}`}
      className={[
        "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        active ? "bg-brand-soft text-brand" : "text-fg-soft hover:bg-surface-sunken",
      ].join(" ")}
    >
      <Hash className="h-4 w-4 shrink-0 text-fg-subtle" />
      {info?.name ? (
        <span className="min-w-0 flex-1 truncate">{info.name}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{channelId}</span>
      )}
      {runtimeId && runtimeId !== "local" && <RuntimeBadge runtimeId={runtimeId} />}
    </button>
  );
}

/**
 * Join a group by its invite link, or a public one by its ID (runtime
 * ADR-092 D5). The group appears in the list once its home lets you in.
 */
function JoinGroup() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const join = useMutation({
    mutationFn: (value: string) => groupJoin(value.trim()),
    onSuccess: () => {
      setLink("");
      void qc.invalidateQueries({ queryKey: ["person-groups"] });
    },
  });
  if (!open) {
    return (
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-soft transition-colors hover:bg-surface-sunken"
          data-testid="group-join-open"
        >
          <Link2 className="h-4 w-4" />
          <span>Join a group</span>
        </button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2 border-t border-line p-2"
      data-testid="group-join"
      onSubmit={(e) => {
        e.preventDefault();
        if (link.trim()) join.mutate(link);
      }}
    >
      <input
        type="text"
        value={link}
        autoFocus
        onChange={(e) => setLink(e.target.value)}
        placeholder="Invite link or group ID"
        className="w-full rounded-lg border border-line bg-surface-card px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        data-testid="group-join-input"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!link.trim() || join.isPending}
          className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
        >
          {join.isPending ? "Asking…" : "Join"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            join.reset();
          }}
          className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
      {join.data && (
        <div className="text-xs text-fg-muted" data-testid="group-join-asked">
          Asked to join {join.data.name}. It appears here when its owner&apos;s computer lets you in.
        </div>
      )}
      {join.error && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {String(join.error instanceof Error ? join.error.message : join.error)}
        </div>
      )}
    </form>
  );
}
