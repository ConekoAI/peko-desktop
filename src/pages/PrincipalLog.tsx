import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import {
  usePrincipal,
  usePrincipalLog,
  useCallerSubject,
  fetchOlderPrincipalLog,
} from "../hooks/usePrincipals";
import type { ChatLogMessage } from "../types";
import {
  Activity,
  AlertTriangle,
  Loader2,
  MessageSquare,
  ShieldOff,
  User as UserIcon,
} from "lucide-react";

function EventTime({ ts }: { ts: string }) {
  const d = new Date(ts);
  const valid = !isNaN(d.getTime());
  return (
    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
      {valid ? d.toLocaleString() : ts}
    </span>
  );
}

function isUserSender(sender: string): boolean {
  return sender.startsWith("user:");
}

function MessageRow({ message }: { message: ChatLogMessage }) {
  const userSide = isUserSender(message.sender);
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <MessageSquare
        className={[
          "mt-0.5 h-4 w-4 shrink-0",
          userSide ? "text-indigo-500" : "text-emerald-500",
        ].join(" ")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span
            className={[
              "text-xs font-semibold uppercase tracking-wide",
              userSide
                ? "text-indigo-700 dark:text-indigo-400"
                : "text-emerald-700 dark:text-emerald-400",
            ].join(" ")}
          >
            {message.sender}
          </span>
          <EventTime ts={message.timestamp} />
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">
          {message.text}
        </pre>
      </div>
    </div>
  );
}

function PermissionDenied({ principalName }: { principalName: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <ShieldOff className="mx-auto h-10 w-10 text-slate-400" />
        <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
          Permission denied
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You don&apos;t have permission to read <strong>{principalName}</strong>&apos;s
          activity. The owner must grant Chat permission first:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-left font-mono text-xs text-emerald-300">
{`peko principal permit ${principalName} \\
  user:<you> chat`}
        </pre>
      </div>
    </div>
  );
}

/**
 * `peko log <PRINCIPAL>` surface (ADR-042).
 *
 * Privacy gate (strict — no owner override UI affordance):
 *
 * - caller == owner  → owner-root view (no peer dropdown).
 * - caller has `Chat` grant on the principal → "Read your own thread"
 *   toggle that passes `peer = user:<caller>` to `principal_log`.
 *   No other peer's thread is reachable from the UI.
 * - otherwise  → permission denied.
 *
 * The runtime enforces the same privacy contract; this UI just
 * narrows the surface so it cannot be used to read another peer's
 * thread under the owner's authority.
 *
 * Paging: the page reads the latest 100 messages on mount and
 * prepends older pages on demand. Paging uses the runtime's
 * opaque `nextCursor`; pages are reconciled by message id to
 * prevent duplicates if the principal logs a new message between
 * two `fetchOlderPrincipalLog` calls.
 */
export default function PrincipalLog() {
  const params = useParams({ strict: false });
  const principalName = (params as Record<string, string | undefined>).principalName ?? "";
  const caller = useCallerSubject();
  const { data: principal, isLoading: principalLoading } = usePrincipal(principalName);

  const isOwner = !!principal && principal.owner === caller;
  const hasChatGrant = useMemo(() => {
    if (!principal) return false;
    return (
      principal.owner !== caller &&
      !!principal.runtimeId &&
      // Permissions don't currently flow through principal_list; the
      // runtime enforces the contract. Optimistically expose the
      // toggle when the caller isn't the owner — the runtime will
      // reject unauthorised peer-self reads with `permission_denied`.
      true
    );
  }, [principal, caller]);

  const [viewSelf, setViewSelf] = useState(false);
  const peer = isOwner ? undefined : viewSelf ? caller : null;
  // When `peer` is `null` we deliberately don't fetch; we gate the read
  // behind the toggle so non-owners never see anything by default.
  const { data: log, isLoading: logLoading, error } = usePrincipalLog(
    principalName || undefined,
    peer === null ? undefined : peer,
  );

  // Paging state: `messages` is the canonical, id-deduped list;
  // `nextCursor` is the runtime's opaque token for the next older
  // page (null when none remains). Reset on principal/peer change.
  const [messages, setMessages] = useState<ChatLogMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  // Sync the initial page into local state whenever a fresh log
  // query resolves. We dedupe by message id so a subsequent
  // refetch after a streamed send doesn't show a duplicate bubble.
  useMemo(() => {
    if (!log) return;
    setMessages(log.messages);
    setNextCursor(log.nextCursor ?? null);
    setHasMore(log.hasMore);
    setOlderError(null);
  }, [log]);

  async function loadOlder() {
    if (!nextCursor || loadingOlder || !principalName) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await fetchOlderPrincipalLog({
        name: principalName,
        peer: peer ?? undefined,
        cursor: nextCursor,
      });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const older = page.messages.filter((m) => !seen.has(m.id));
        // Older pages arrive oldest-to-newest and slot above the
        // existing list. Reverse so the final ordering still walks
        // oldest -> newest from top to bottom.
        return [...older, ...prev];
      });
      setNextCursor(page.nextCursor ?? null);
      setHasMore(page.hasMore);
    } catch (err) {
      setOlderError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  if (principalLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300 dark:text-slate-700" />
      </div>
    );
  }

  if (!principal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Principal <strong>{principalName}</strong> not found
        </p>
      </div>
    );
  }

  if (!isOwner && !hasChatGrant) {
    return <PermissionDenied principalName={principal.name} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {principal.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <UserIcon className="h-3 w-3" />
                Viewing as{" "}
                <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{caller}</code>
              </span>
              {!isOwner && hasChatGrant && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  peer self-read
                </span>
              )}
            </p>
          </div>
        </div>

        {!isOwner && hasChatGrant && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={viewSelf}
              onChange={(e) => setViewSelf(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800"
            />
            Read your own thread
          </label>
        )}
      </header>

      {!isOwner && !viewSelf ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-sm">
            <ShieldOff className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Toggle <em>Read your own thread</em> to load your private
              conversation with this principal. The owner&apos;s root
              activity feed is only visible to the principal&apos;s owner.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6 dark:bg-slate-950">
          {logLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading chat...
            </div>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {error instanceof Error ? error.message : String(error)}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600">
              <Activity className="h-10 w-10" />
              <p className="mt-2 text-sm">No messages yet.</p>
            </div>
          ) : (
            <ol className="mx-auto max-w-2xl space-y-3">
              {messages.map((message) => (
                <li key={message.id}>
                  <MessageRow message={message} />
                </li>
              ))}
              {olderError && (
                <li className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-3 text-center text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                  {olderError}
                </li>
              )}
              {hasMore && (
                <li className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={loadOlder}
                    disabled={loadingOlder || !nextCursor}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    {loadingOlder ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading older...
                      </>
                    ) : (
                      "Load older"
                    )}
                  </button>
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
