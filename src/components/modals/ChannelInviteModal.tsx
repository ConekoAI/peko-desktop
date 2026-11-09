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

  // Members come as addresses (`principal:<local id>`, or with `local:`);
  // match local pekos by address as well as by name.
  const isLocalMember = useMemo(() => {
    return (p: { name: string; localId?: string | null }) =>
      memberSet.has(p.name) ||
      (!!p.localId &&
        (memberSet.has(`principal:${p.localId}`) ||
          memberSet.has(`principal:local:${p.localId}`)));
  }, [memberSet]);

  // Build the unified list. Local principals are filtered to those
  // that AREN'T already members. Remote principals (whose DID carries
  // the `@<runtime-id>` suffix) get the same filter.
  const candidates = useMemo(() => {
    const locals = (principals ?? [])
      .filter((p) => !isLocalMember(p))
      .map((p) => ({
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
  }, [principals, remotes, memberSet, isLocalMember]);

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
    const localMembers = (principals ?? []).filter(isLocalMember);
    const creatorPeko = localMembers.find(
      (p) =>
        p.name === creator ||
        (!!p.localId &&
          (creator === `principal:${p.localId}` || creator === `principal:local:${p.localId}`)),
    );
    return (creatorPeko ?? localMembers[0])?.name ?? null;
  }, [detail?.creator, isLocalMember, principals]);

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
      className="modal-backdrop"
    >
      <div className="modal-panel flex w-full max-w-md flex-col">
        <div className="modal-header shrink-0 justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-brand-text" />
            <h2
              id="channel-invite-modal-title"
              className="modal-title"
            >
              Invite to <span className="font-mono">{channel}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="btn-icon -mr-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm text-fg-soft">
          <p className="text-xs text-fg-muted">
            Pick a peko to add to this group.
          </p>

          {!inviterName && (
            <div className="rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn">
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
              className="input"
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
                          ? "bg-brand-soft text-brand-text"
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

        <div className="modal-footer shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary"
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