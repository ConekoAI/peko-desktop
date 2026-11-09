import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { blockedPeople, setPersonBlocked } from "../lib/api";

/**
 * The people you blocked (runtime ADR-095 D6): their message requests,
 * messages, and history requests are refused on this computer, and the
 * list reaches your other computers. Unblock one here.
 */
export default function BlockedPeople({ className }: { className?: string }) {
  const qc = useQueryClient();
  const { data: people, isLoading } = useQuery({
    queryKey: ["blocked-people"],
    queryFn: blockedPeople,
  });
  const unblock = useMutation({
    mutationFn: (account: string) => setPersonBlocked(account, false),
    onSuccess: (now) => qc.setQueryData(["blocked-people"], now),
  });

  return (
    <div className={className} data-testid="blocked-people">
      <h3 className="h-section">Blocked people</h3>
      <p className="field-hint mt-0.5">
        They can&apos;t message you or ask to. Blocking is done from a message request.
      </p>
      {isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (people ?? []).length === 0 ? (
        <div className="mt-3 text-xs text-fg-subtle" data-testid="blocked-people-empty">
          You haven&apos;t blocked anyone.
        </div>
      ) : (
        <ul className="rows mt-3">
          {people!.map(({ account, name }) => (
            <li
              key={account}
              className="flex items-center gap-2 px-3 py-2.5"
              data-testid={`blocked-${account}`}
            >
              <div className="min-w-0 flex-1">
                {name && <div className="truncate text-sm text-fg">{name}</div>}
                <code className="block truncate text-xs text-fg-subtle">{account}</code>
              </div>
              <button
                type="button"
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(account)}
                className="btn-secondary btn-xs shrink-0"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
      {unblock.error && (
        <div className="mt-2 text-xs text-danger">
          {String(unblock.error instanceof Error ? unblock.error.message : unblock.error)}
        </div>
      )}
    </div>
  );
}
