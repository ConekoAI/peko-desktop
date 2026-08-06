import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  channelCreate,
  channelGet,
  channelInvite,
  channelLeave,
  channelList,
  channelMembers,
  type ChannelDetail,
  type ChannelInviteResult,
  type ChannelLeaveResult,
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

// ─── Mutations (PR-3) ────────────────────────────────────────────────
//
// Each mutation invalidates the channel list + the affected
// channel-detail / members queries so the sidebar + view update
// without a manual refresh. Cross-runtime fan-out (TunnelChannelInvite)
// is a runtime-side side-effect; the IPC response only acknowledges
// the local channel.

/**
 * PR-3: create a new channel. Resolves with the runtime-minted
 * `channelId` so the caller can navigate to `/channels/<id>`
 * without a follow-up list refresh. Invalidates the channel list so
 * the sidebar shows the new row.
 */
export function useChannelCreate(runtimeId?: RuntimeId) {
  const qc = useQueryClient();
  const rid = effectiveRuntimeId(runtimeId);
  return useMutation({
    mutationFn: (vars: { creatorName: string; name: string }) =>
      channelCreate(vars.creatorName, vars.name, rid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", rid] });
    },
  });
}

/**
 * PR-3: add a principal to an existing channel. Invalidates the
 * channel list + the affected channel-detail / members queries so
 * the React side picks up the new member row without a manual
 * refresh. Cross-runtime fan-out (TunnelChannelInvite) happens on
 * the runtime side; the IPC response only acknowledges the local
 * invite.
 */
export function useChannelInvite(channelId: string | undefined, runtimeId?: RuntimeId) {
  const qc = useQueryClient();
  const rid = effectiveRuntimeId(runtimeId);
  return useMutation<ChannelInviteResult, Error, { inviterName: string; inviteeName: string }>({
    mutationFn: (vars) => {
      if (!channelId) {
        return Promise.reject(new Error("channelId is required for invite"));
      }
      return channelInvite(channelId, vars.inviterName, vars.inviteeName, rid);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", rid] });
      qc.invalidateQueries({ queryKey: ["channel", rid, channelId] });
      qc.invalidateQueries({ queryKey: ["channel-members", rid, channelId] });
      qc.invalidateQueries({ queryKey: ["channel-events", rid, channelId] });
    },
  });
}

/**
 * PR-3: remove a principal from an existing channel. Same
 * invalidation contract as `useChannelInvite`. Callers should
 * navigate away from the channel route when the leaver was the
 * last local member.
 */
export function useChannelLeave(channelId: string | undefined, runtimeId?: RuntimeId) {
  const qc = useQueryClient();
  const rid = effectiveRuntimeId(runtimeId);
  return useMutation<ChannelLeaveResult, Error, { principalName: string }>({
    mutationFn: (vars) => {
      if (!channelId) {
        return Promise.reject(new Error("channelId is required for leave"));
      }
      return channelLeave(channelId, vars.principalName, rid);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", rid] });
      qc.invalidateQueries({ queryKey: ["channel", rid, channelId] });
      qc.invalidateQueries({ queryKey: ["channel-members", rid, channelId] });
      qc.invalidateQueries({ queryKey: ["channel-events", rid, channelId] });
    },
  });
}