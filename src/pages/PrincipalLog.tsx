import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import {
  usePrincipal,
  usePrincipalLog,
  useCallerSubject,
} from "../hooks/usePrincipals";
import type { HistoryEvent } from "../types";
import {
  Activity,
  AlertTriangle,
  Clock,
  Hash,
  Loader2,
  MessageSquare,
  ShieldOff,
  User as UserIcon,
  Wrench,
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

function EventRow({ event }: { event: HistoryEvent }) {
  switch (event.kind) {
    case "message":
      return (
        <div className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                {event.role}
              </span>
              <EventTime ts={event.timestamp} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">
              {event.content}
            </pre>
          </div>
        </div>
      );
    case "tool_call":
      return (
        <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                tool call · {event.toolName}
              </span>
              <EventTime ts={event.timestamp} />
            </div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-slate-600 dark:text-slate-400">
              {event.args}
            </pre>
          </div>
        </div>
      );
    case "tool_result":
      return (
        <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span
                className={[
                  "text-xs font-semibold",
                  event.error
                    ? "text-red-600 dark:text-red-400"
                    : "text-slate-700 dark:text-slate-300",
                ].join(" ")}
              >
                tool result {event.error ? "· error" : ""}
              </span>
              <EventTime ts={event.timestamp} />
            </div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-slate-600 dark:text-slate-400">
              {event.output}
            </pre>
          </div>
        </div>
      );
    case "thinking":
      return (
        <div className="flex gap-3 rounded-lg border border-dashed border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <Hash className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                thinking
              </span>
              <EventTime ts={event.timestamp} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-sm italic text-slate-600 dark:text-slate-400">
              {event.content}
            </pre>
          </div>
        </div>
      );
    case "compaction":
      return (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <Activity className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              context compacted
            </span>
          </div>
          <EventTime ts={event.timestamp} />
        </div>
      );
    case "session":
      return (
        <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
          <Clock className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div className="flex-1">
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
              session {event.sessionId.slice(0, 8)} started
            </span>
          </div>
          <EventTime ts={event.startedAt} />
        </div>
      );
    case "custom":
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          [{event.customType}] · <EventTime ts={event.timestamp} />
        </div>
      );
  }
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

  const events = log?.events ?? [];

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
              Loading activity...
            </div>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {error instanceof Error ? error.message : String(error)}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600">
              <Activity className="h-10 w-10" />
              <p className="mt-2 text-sm">No activity yet.</p>
            </div>
          ) : (
            <ol className="mx-auto max-w-2xl space-y-3">
              {events.map((event, idx) => (
                <li key={idx}>
                  <EventRow event={event} />
                </li>
              ))}
              {log?.truncated && (
                <li className="text-center text-xs text-slate-400 dark:text-slate-500">
                  ... truncated at {events.length} events
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
