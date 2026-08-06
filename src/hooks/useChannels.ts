import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  channelGet,
  channelList,
  channelMembers,
  type ChannelDetail,
  type ChannelMembers,
  type ChannelSummary,
  type RuntimeId,
} from "../lib/api";

const DEFAULT_RUNTIME_ID = "local";

function effectiveRuntimeId(runtimeId?: RuntimeId): string {
  return runtimeId ?? DEFAULT_RUNTIME_ID;
}

// ─── Channel list ─────────────────────────────────────────────────
//
// The runtime's `channel_list` IPC is per-principal: it returns the
// channels where the named principal is a member. For the desktop
// sidebar we want a unified list across all local principals. So
// `useChannels` fans out: it issues one query per principal, then
// dedupes by `channelId` in the render. The query key includes the
// runtimeId so cross-runtime principals route correctly (PR #5).

export interface ChannelRow extends ChannelSummary {
  /**
   * The principals (on this runtime) that are members of this channel.
   * Useful for the sidebar's "active members" hint — derived from
   * the fan-out query, not a separate IPC.
   */
  memberPrincipals: string[];
}

export function useChannels(
  principalNames: string[],
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);

  // Per-principal sub-queries. `useQueries` would be cleaner but
  // TanStack Query v5's `useQueries` typing for heterogeneous
  // filters is awkward; N small queries + merge is fine for the
  // fan-out counts a desktop session has (≤ a few dozen principals).
  const subQueries = useMemo(
    () =>
      principalNames.map((name) => ({
        queryKey: ["channels", rid, name] as const,
        queryFn: () => channelList(name, rid),
        staleTime: 30_000,
      })),
    [principalNames.join("|"), rid],
  );

  const merged = useQuery({
    queryKey: ["channels", rid, principalNames.join("|")] as const,
    enabled: principalNames.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        subQueries.map((q) => q.queryFn()),
      );
      const dedupe = new Map<string, ChannelRow>();
      for (let i = 0; i < results.length; i++) {
        const name = principalNames[i];
        for (const row of results[i]) {
          const existing = dedupe.get(row.channelId);
          if (existing) {
            existing.memberPrincipals.push(name);
          } else {
            dedupe.set(row.channelId, {
              ...row,
              memberPrincipals: [name],
            });
          }
        }
      }
      return Array.from(dedupe.values()).sort((a, b) =>
        a.channelId.localeCompare(b.channelId),
      );
    },
    staleTime: 30_000,
  });

  return merged;
}

/**
 * List channels for a single principal — used by the per-principal
 * sidebar variant when only one principal is in scope. Thin wrapper
 * over `channelList` so the call site doesn't import the API module
 * directly.
 */
export function useChannelsForPrincipal(
  principalName: string | undefined,
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    queryKey: ["channels", rid, principalName] as const,
    enabled: !!principalName,
    queryFn: () => channelList(principalName!, rid),
    staleTime: 30_000,
  });
}

// ─── Single channel detail + members ──────────────────────────────

export function useChannel(
  channelId: string | undefined,
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery<ChannelDetail | null>({
    queryKey: ["channel", rid, channelId] as const,
    enabled: !!channelId,
    queryFn: () => channelGet(channelId!, rid),
    staleTime: 5_000,
  });
}

export function useChannelMembers(
  channelId: string | undefined,
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery<ChannelMembers>({
    queryKey: ["channel-members", rid, channelId] as const,
    enabled: !!channelId,
    queryFn: () => channelMembers(channelId!, rid),
    staleTime: 5_000,
  });
}