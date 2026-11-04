import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle, User } from "lucide-react";
import { dmRequestAnswer, dmRequests, personDmOpen, personDms } from "../lib/api";
import { personLabel } from "../lib/people";

/** Open a DM with a person: it sits with the chats (runtime ADR-095 D6). */
export function usePersonDmNavigate() {
  const navigate = useNavigate();
  return (channelId: string) =>
    navigate({
      to: "/people/$channelId",
      params: { channelId },
      search: { runtimeId: "local" },
    });
}

/** Section heading inside the chat list. */
export function ChatSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </div>
  );
}

/**
 * People asking to message you (runtime ADR-095 D6). A request names only
 * who asks; what they wrote arrives once you accept, which opens the DM.
 */
export function DmRequests() {
  const qc = useQueryClient();
  const open = usePersonDmNavigate();
  const { data: requests } = useQuery({
    queryKey: ["dm-requests"],
    queryFn: dmRequests,
    refetchInterval: 30_000,
  });
  const answer = useMutation({
    mutationFn: ({
      channelId,
      answer,
    }: {
      channelId: string;
      answer: "accept" | "decline" | "block";
    }) => dmRequestAnswer(channelId, answer),
    onSuccess: (opened) => {
      void qc.invalidateQueries({ queryKey: ["dm-requests"] });
      void qc.invalidateQueries({ queryKey: ["person-dms"] });
      void qc.invalidateQueries({ queryKey: ["blocked-people"] });
      if (opened) open(opened);
    },
  });
  if (!requests || requests.length === 0) return null;
  return (
    <div className="mb-2 space-y-1" data-testid="dm-requests">
      <ChatSectionLabel>Message requests</ChatSectionLabel>
      {requests.map((r) => (
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
              disabled={answer.isPending}
              onClick={() => answer.mutate({ channelId: r.channelId, answer: "accept" })}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ channelId: r.channelId, answer: "decline" })}
              className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken disabled:opacity-50"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ channelId: r.channelId, answer: "block" })}
              className="ml-auto rounded-md px-2.5 py-1 text-xs text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              Block
            </button>
          </div>
        </div>
      ))}
      {answer.error && (
        <div className="px-2 text-xs text-danger">
          {String(answer.error instanceof Error ? answer.error.message : answer.error)}
        </div>
      )}
    </div>
  );
}

/** Your DMs with other people; "invited" until they accept. */
export function usePeople(search: string) {
  const { data: people } = useQuery({
    queryKey: ["person-dms"],
    queryFn: personDms,
    refetchInterval: 15_000,
  });
  return useMemo(() => {
    const rows = people ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => personLabel(p).toLowerCase().includes(q) || p.account.includes(q));
  }, [people, search]);
}

/** One person you DM with. */
export function PersonRow({
  person,
  active,
  rowClass,
}: {
  person: ReturnType<typeof usePeople>[number];
  active: boolean;
  rowClass: string;
}) {
  const open = usePersonDmNavigate();
  return (
    <button
      onClick={() => open(person.channelId)}
      data-testid={`person-dm-row-${person.channelId}`}
      className={rowClass}
      aria-current={active ? "page" : undefined}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
        <User className="h-3.5 w-3.5 text-fg-muted" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{personLabel(person)}</span>
      {person.waiting && <span className="shrink-0 text-xs text-fg-subtle">invited</span>}
    </button>
  );
}

/**
 * Message a person by their PekoHub account ID (runtime ADR-095 D6). They
 * get a message request; the DM opens here at once, and what you write
 * reaches them when they accept.
 */
export function MessagePersonForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const open = usePersonDmNavigate();
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const start = useMutation({
    mutationFn: () =>
      personDmOpen(account.trim().replace(/^user:hub:/, ""), name.trim() || undefined),
    onSuccess: (channelId) => {
      void qc.invalidateQueries({ queryKey: ["person-dms"] });
      onClose();
      open(channelId);
    },
  });
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
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
      <div className="text-xs text-fg-subtle">
        They get a message request. What you write reaches them once they accept.
      </div>
      {start.error && (
        <div className="text-xs text-danger" data-testid="person-dm-error">
          {String(start.error instanceof Error ? start.error.message : start.error)}
        </div>
      )}
    </form>
  );
}
