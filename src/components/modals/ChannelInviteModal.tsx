import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Hash, Monitor, UserPlus, X } from "lucide-react";

import { useChannelInvite } from "../../hooks/useChannels";
import { usePrincipals } from "../../hooks/usePrincipals";
import { useRemotePrincipals } from "../../hooks/useRemotePrincipals";
import { useModalA11y } from "../../hooks/useModalA11y";
import type { ChannelDetail, ChannelMembers } from "../../types";

/**
 * PR-3: invite a principal to an existing channel. Sectioned picker:
 *   - Local principals (from `usePrincipals`)
 *   - Remote principals (from `useRemotePrincipals`)
 * Search box filters both lists. Already-invited principals are
 * filtered out so the user can't re-invite by mistake.
 *
 * The runtime emits a signed `TunnelChannelInvite` envelope as a
 * side-effect for any invitee hosted on a peer runtime. The IPC
 * response only acknowledges the local invite; cross-runtime
 * bootstrap is asynchronous (driven by the hub's pure-relay path).
 *
 * Inviter defaults to the channel's `creator` if the user is the
 * creator, otherwise to the first local principal that's already a
 * member. This matches the CLI's `peko channel invite <channel>
 * <inviter> <invitee>` contract — the runtime validates the inviter
 * is a current member.
 */
export default function ChannelInviteModal({
  open,
  channel,
  detail,
  members,
  onClose,
}: {
  open: boolean;
  channel: string;
  detail: ChannelDetail | null;
  members: ChannelMembers | null;
  onClose: () => void;
}) {
  const { data: principals } = usePrincipals();
  const { data: remotes } = useRemotePrincipals();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const memberSet = useMemo(
    () => new Set(members?.members ?? []),
    [members?.members],
  );

  // Build the unified list. Local principals are filtered to those
  // that AREN'T already members. Remote principals (whose DID carries
  // the `@<runtime-id>` suffix) get the same filter.
  const candidates = useMemo(() => {
    const locals = (principals ?? []).map((p) => ({
      kind: "local" as const,
      name: p.name,
      label: p.description ? `${p.name} — ${p.description}` : p.name,
    }));
    const remoteRows = (remotes ?? []).map((r) => {
      // Remote DID form: `<principal_name>@<hub_url>`. Matches the
      // runtime's `@<runtime-id>` suffix convention.
      const did = `${r.principalName}@${r.runtimeId}`;
      return {
        kind: "remote" as const,
        name: did,
        label: `${r.principalName} (${r.hubUrl})`,
      };
    });
    return [...locals, ...remoteRows].filter((c) => !memberSet.has(c.name));
  }, [principals, remotes, memberSet]);

  const filtered = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase();
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q),
    );
  }, [candidates, search]);

  // Pick a sensible inviter. The runtime requires the inviter to be
  // a current local member. Creator is the natural default when the
  // creator is local; otherwise the first local member.
  const inviterName = useMemo(() => {
    const creator = detail?.creator;
    if (creator && memberSet.has(creator) && (principals ?? []).some((p) => p.name === creator)) {
      return creator;
    }
    const firstLocalMember = (principals ?? []).find((p) => memberSet.has(p.name));
    return firstLocalMember?.name ?? null;
  }, [detail?.creator, memberSet, principals]);

  const inviteMut = useChannelInvite(channel);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(null);
      inviteMut.reset();
    }
    // We intentionally exclude `inviteMut` to avoid resetting on every
    // mutation status change — only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    if (!selected || !inviterName) return;
    inviteMut.mutate(
      { inviterName, inviteeName: selected },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  const errorMessage =
    inviteMut.error instanceof Error
      ? inviteMut.error.message
      : inviteMut.error
        ? String(inviteMut.error)
        : null;

  // Escape closes the modal and focus stays inside it. Hooks run on

  // every render, open or not: called after the early return, they

  // crashed the app the first time the dialog opened (React #310).

  const containerRef = useRef<HTMLDivElement | null>(null);

  useModalA11y(open, containerRef, onClose);


  if (!open) return null;

  const canSubmit = !!selected && !!inviterName && !inviteMut.isPending;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-invite-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex w-full max-w-md flex-col rounded-xl border border-line bg-surface-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-brand" />
            <h2
              id="channel-invite-modal-title"
              className="text-base font-semibold text-fg"
            >
              Invite to <span className="font-mono">{channel}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm text-fg-soft">
          <p className="text-xs text-fg-muted">
            Pick a peko to add to this group.
          </p>

          {!inviterName && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
              Only a member can add others. Ask someone in this group to add
              one of your pekos first.
            </div>
          )}

          <div>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pekos…"
              className="w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              data-testid="channel-invite-search"
            />
          </div>

          <div
            className="max-h-72 overflow-y-auto rounded-lg border border-line"
            data-testid="channel-invite-candidates"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-fg-subtle">
                {candidates.length === 0
                  ? "No inviteable pekos yet — every local peko is already a member."
                  : "No pekos match your search."}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.name)}
                      className={[
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                        selected === c.name
                          ? "bg-brand-soft text-brand"
                          : "text-fg-soft hover:bg-surface-sunken",
                      ].join(" ")}
                      data-testid={`channel-invite-row-${c.name}`}
                    >
                      {c.kind === "local" ? (
                        <Monitor className="h-3.5 w-3.5 text-fg-subtle" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-fg-subtle" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {c.label}
                      </span>
                      <Hash className="hidden h-3.5 w-3.5 text-fg-subtle" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-surface-card px-4 py-1.5 text-sm font-medium text-fg-soft transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50"
            data-testid="channel-invite-submit"
          >
            <Check className="h-3.5 w-3.5" />
            {inviteMut.isPending ? "Inviting…" : "Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}