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

  if (!open) return null;

  // P1.5: Escape closes the modal + focus is trapped inside it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(open, containerRef, onClose);

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
      <div className="flex w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <h2
              id="channel-invite-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-white"
            >
              Invite to <span className="font-mono">{channel}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pick a principal to invite. Cross-runtime invites bootstrap
            a local mirror on the recipient&apos;s runtime.
          </p>

          {!inviterName && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
              You need a local principal that&apos;s already a member of this
              channel to invite others. Ask a current member to invite you
              first, or invite from the CLI.
            </div>
          )}

          <div>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search principals…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
              data-testid="channel-invite-search"
            />
          </div>

          <div
            className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800"
            data-testid="channel-invite-candidates"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                {candidates.length === 0
                  ? "No inviteable principals yet — every local principal is already a member."
                  : "No principals match your search."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {filtered.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.name)}
                      className={[
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                        selected === c.name
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                      ].join(" ")}
                      data-testid={`channel-invite-row-${c.name}`}
                    >
                      {c.kind === "local" ? (
                        <Monitor className="h-3.5 w-3.5 text-slate-400" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-slate-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {c.label}
                      </span>
                      <Hash className="hidden h-3.5 w-3.5 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
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