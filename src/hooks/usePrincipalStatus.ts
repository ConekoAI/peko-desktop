import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { principalGet, type RuntimeId } from "../lib/api";

/**
 * PR #9: live status polling. The decorative `STATUS_OPTIONS`
 * dropdown in `PrincipalProfileModal` is gone — the runtime's
 * heartbeat (local) or the hub's `lastSeenAt` (remote) is the
 * authoritative source.
 *
 * Polling cadence mirrors the source:
 *   - Local: 10s. The runtime's principal-status IPC is local
 *     Unix datagram; 10s polling is essentially free.
 *   - Remote: 30s. Hub polls peers on a 30s heartbeat (see
 *     `backend/src/plugins/audit.ts`). Faster polling would just
 *     read the same cached value.
 *
 * `enabled: false` when the runtimeId is missing (initial mount
 * race) so React Query doesn't fire an IPC call with `undefined`
 * arguments — `principalGet` requires a name.
 */

export type PrincipalStatusValue = "online" | "offline" | "busy" | "error" | "unknown";

export interface PrincipalStatus {
  status: PrincipalStatusValue;
  /** ISO string when known; `null` if the source didn't return one. */
  lastSeenAt: string | null;
  /** Local | remote | unknown — useful for the UI to choose a label. */
  source: "local" | "remote" | "unknown";
}

const LOCAL_POLL_MS = 10_000;
const REMOTE_POLL_MS = 30_000;

export function usePrincipalStatus(
  runtimeId: RuntimeId,
  principalName: string,
  ownerForRemote?: string,
  hubUrlForRemote?: string,
): UseQueryResult<PrincipalStatus, Error> {
  const isRemote = !!runtimeId && runtimeId !== "local" && !!hubUrlForRemote && !!ownerForRemote;
  const enabled =
    !!principalName && (!!runtimeId || runtimeId === undefined) && (!isRemote || (!!ownerForRemote && !!hubUrlForRemote));

  return useQuery<PrincipalStatus, Error>({
    queryKey: [
      "principal-status",
      runtimeId ?? "local",
      principalName,
      ownerForRemote ?? null,
      hubUrlForRemote ?? null,
    ],
    queryFn: async (): Promise<PrincipalStatus> => {
      if (isRemote && hubUrlForRemote && ownerForRemote) {
        return fetchRemoteStatus(hubUrlForRemote, ownerForRemote, principalName);
      }
      return fetchLocalStatus(principalName, runtimeId);
    },
    refetchInterval: (query) => {
      // Pause polling when the window/tab is hidden — saves IPC
      // round-trips. The hook will resume when the tab returns.
      if (typeof document !== "undefined" && document.hidden) return false;
      return query.state.error ? 60_000 : isRemote ? REMOTE_POLL_MS : LOCAL_POLL_MS;
    },
    refetchOnWindowFocus: true,
    enabled,
    staleTime: isRemote ? REMOTE_POLL_MS / 2 : LOCAL_POLL_MS / 2,
  });
}

async function fetchLocalStatus(name: string, runtimeId: RuntimeId): Promise<PrincipalStatus> {
  try {
    const p = await principalGet(name, runtimeId);
    if (!p) {
      return { status: "unknown", lastSeenAt: null, source: "local" };
    }
    return {
      status: normalizeStatus(p.status),
      lastSeenAt: null, // local IPC summary does not carry lastSeenAt today
      source: "local",
    };
  } catch {
    return { status: "unknown", lastSeenAt: null, source: "local" };
  }
}

async function fetchRemoteStatus(
  hubUrl: string,
  owner: string,
  principalName: string,
): Promise<PrincipalStatus> {
  // Mirror of pekohub's `PublicProfile` shape. Kept inline because
  // the runtime / desktop shared package doesn't export this type
  // yet; the only field we actually need is `status`.
  const base = hubUrl.replace(/\/$/, "");
  const url = `${base}/v1/public/principals/${encodeURIComponent(owner)}/${encodeURIComponent(principalName)}`;
  try {
    const res = await fetch(url, {
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) {
      // Remote principal was deregistered or is no longer public.
      // Surface as `offline` so the UI doesn't render a stale
      // "online" pill.
      return { status: "offline", lastSeenAt: null, source: "remote" };
    }
    if (!res.ok) {
      return { status: "unknown", lastSeenAt: null, source: "remote" };
    }
    const body = (await res.json()) as { status?: string };
    return {
      status: normalizeStatus(body.status),
      lastSeenAt: null,
      source: "remote",
    };
  } catch {
    // Network errors land here; "unknown" so the UI can render a
    // neutral pill instead of pretending the principal is online.
    return { status: "unknown", lastSeenAt: null, source: "remote" };
  }
}

function normalizeStatus(raw: string | undefined | null): PrincipalStatusValue {
  switch ((raw ?? "").toLowerCase()) {
    case "online":
    case "offline":
    case "busy":
    case "error":
      return raw!.toLowerCase() as PrincipalStatusValue;
    default:
      return "unknown";
  }
}

/**
 * Pure helper for tests + render decisions. Maps a status value
 * to a small badge descriptor so the same color/icon logic can
 * run in the sidebar, the profile modal, and tests without
 * duplicating the switch.
 */
export function statusBadge(value: PrincipalStatusValue): {
  label: string;
  color: string;
  icon: "circle" | "dot" | "off" | "alert";
} {
  switch (value) {
    case "online":
      return { label: "Online", color: "text-emerald-500", icon: "circle" };
    case "busy":
      return { label: "Busy", color: "text-amber-500", icon: "dot" };
    case "offline":
      return { label: "Offline", color: "text-slate-400", icon: "off" };
    case "error":
      return { label: "Error", color: "text-red-500", icon: "alert" };
    case "unknown":
    default:
      return { label: "Unknown", color: "text-slate-400", icon: "dot" };
  }
}