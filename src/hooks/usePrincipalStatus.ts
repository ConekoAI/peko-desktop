import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  pekohubListAccessiblePekos,
  principalGet,
  remotePrincipalProfile,
  type AccessiblePrincipal,
  type RuntimeId,
} from "../lib/api";
import { loadOAuthBundle } from "./useRuntimes";

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
  /**
   * A remote peko's public face, read from the same hub record as its
   * status: the avatar its runtime announced, its description, and its
   * id on that runtime (so its accent matches what its owner sees).
   * Absent for local pekos and for hubs that don't send them.
   */
  profile?: { avatar: string | null; description: string | null; localId: string | null };
}

const LOCAL_POLL_MS = 10_000;
const REMOTE_POLL_MS = 30_000;

export function usePrincipalStatus(
  runtimeId: RuntimeId,
  principalName: string,
  ownerForRemote?: string,
  hubUrlForRemote?: string,
): UseQueryResult<PrincipalStatus, Error> {
  const qc = useQueryClient();
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
        return fetchRemoteStatus(qc, hubUrlForRemote, ownerForRemote, principalName);
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

/** How long one read of your account's pekos serves every row. */
const OWN_PEKOS_STALE_MS = 15_000;

/**
 * The account's own pekos on `hubUrl`, shared with the sidebar's list
 * (same query key), or null when this computer isn't signed in there.
 */
export async function ownPekosOnHub(
  qc: QueryClient,
  hubUrl: string,
): Promise<AccessiblePrincipal[] | null> {
  const bundle = await loadOAuthBundle().catch(() => null);
  if (!bundle?.access_token) return null;
  return qc.fetchQuery({
    queryKey: ["accessible-principals", hubUrl],
    queryFn: () => pekohubListAccessiblePekos(hubUrl, bundle.access_token),
    staleTime: OWN_PEKOS_STALE_MS,
  });
}

async function fetchRemoteStatus(
  qc: QueryClient,
  hubUrl: string,
  owner: string,
  principalName: string,
): Promise<PrincipalStatus> {
  // One of your own pekos on another computer: your account lists it
  // with its status and face, private ones included (they have no
  // public page).
  const own = await ownPekosOnHub(qc, hubUrl).catch(() => null);
  const mine = own?.find((p) => p.owner === owner && p.principalName === principalName);
  if (mine) {
    return {
      status: normalizeStatus(mine.status),
      lastSeenAt: null,
      source: "remote",
      profile: {
        avatar: mine.avatar,
        description: mine.description,
        localId: mine.localId,
      },
    };
  }
  // Anyone else's: the hub's public peko record (pekohub ADR-005), read
  // by the backend: the webview's content security policy allows no
  // outside hosts.
  try {
    const live = await remotePrincipalProfile(hubUrl, owner, principalName);
    if (!live) {
      // Deregistered or no longer public: `offline`, so the UI doesn't
      // keep a stale "online" dot.
      return { status: "offline", lastSeenAt: null, source: "remote" };
    }
    return {
      status: normalizeStatus(live.status),
      lastSeenAt: null,
      source: "remote",
      profile: {
        avatar: live.avatar ?? null,
        description: live.description ?? null,
        localId: live.localId ?? null,
      },
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