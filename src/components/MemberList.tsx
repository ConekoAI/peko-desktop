import { useChannelMembers } from "../hooks/useChannels";
import { Bot, Loader2 } from "lucide-react";
import RuntimeBadge from "./RuntimeBadge";

/**
 * PR-1 read-only member list for a single channel. Renders the
 * principals currently in the channel, grouped into "Local" (on
 * this runtime) and "Remote" (on a peer runtime). The runtime
 * grouping is best-effort: the IPC returns a flat `Vec<PrincipalId>`
 * — we label each as "Local" until PR #3 lands the cross-runtime
 * invite envelope and we can attribute principals to their host
 * runtime.
 *
 * For PR-1 every member appears under "Local". The section split
 * exists so PR-3 can flip on the runtime attribution without
 * touching the row component.
 */
export default function MemberList({
  channelId,
  runtimeId,
}: {
  channelId: string;
  runtimeId?: string;
}) {
  const { data, isLoading } = useChannelMembers(channelId, runtimeId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading members…
      </div>
    );
  }

  const local = data?.members ?? [];

  if (local.length === 0) {
    return (
      <div className="p-4 text-xs text-slate-400 dark:text-slate-600">
        No members yet.
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Local
      </div>
      <ul className="space-y-1">
        {local.map((did) => (
          <li
            key={did}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            data-testid={`channel-member-${did}`}
          >
            <Bot className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
            <span className="min-w-0 flex-1 truncate font-medium">{did}</span>
            <RuntimeBadge runtimeId="local" />
          </li>
        ))}
      </ul>
    </div>
  );
}