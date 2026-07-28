import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  principalCreate,
  principalGet,
  principalList,
  principalLog,
  principalRemove,
  principalSend,
  principalSendControl,
  principalSendStream,
  principalUpdate,
  type ChatStreamMsg,
  type PrincipalCreateRequest,
  type PrincipalSendControlArgs,
  type PrincipalSummary,
  type PrincipalUpdateRequest,
  type RuntimeId,
} from "../lib/api";

export type { PrincipalSummary };

const DEFAULT_RUNTIME_ID = "local";

/** PR #3: tiny helper that normalizes `RuntimeId` to `"local"`. */
function effectiveRuntimeId(runtimeId?: RuntimeId): string {
  return runtimeId ?? DEFAULT_RUNTIME_ID;
}

// ─── Principal list / detail ─────────────────────────────────────

export function usePrincipals(runtimeId?: RuntimeId) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    // PR #3: query key now varies by runtimeId so the React Query
    // cache routes correctly across local + remote principals.
    queryKey: ["principals", rid],
    queryFn: () => principalList(rid),
    // The runtime list call is ~5 ms via CLI, but the desktop path goes
    // through Tauri -> IPC ensure_daemon probe -> daemon roundtrip, so
    // each fetch is tens-to-hundreds of milliseconds. Keep the list fresh
    // enough without re-running that path on every mount or window focus.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function usePrincipal(name: string | undefined, runtimeId?: RuntimeId) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    queryKey: ["principals", rid, name],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      return principalGet(name, rid);
    },
    enabled: !!name,
  });
}

// ─── Principal create (T-105) ───────────────────────────────────

/**
 * Create a new Principal on the local runtime. Invalidates the
 * `["principals"]` query so the sidebar / Chat principal picker
 * pick up the new entry without a manual refresh. Errors (name
 * validation, AlreadyExists, daemon unreachable) propagate to the
 * caller; the modal/walkthrough surfaces them inline.
 */
export function usePrincipalCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PrincipalCreateRequest) => principalCreate(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["principals"] });
    },
  });
}

/**
 * Update an existing Principal's mutable config. Invalidates both
 * the principal list and the detail query so all surfaces reflect
 * the change immediately.
 */
export function usePrincipalUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PrincipalUpdateRequest) => principalUpdate(req),
    onSuccess: (_data, vars) => {
      const rid = effectiveRuntimeId(vars.runtimeId);
      qc.invalidateQueries({ queryKey: ["principals"] });
      qc.invalidateQueries({ queryKey: ["principals", rid, vars.name] });
    },
  });
}

/**
 * Remove a Principal and its on-disk workspace. Invalidates the
 * principal list; callers should navigate away from any route that
 * references the removed principal.
 */
export function usePrincipalRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; runtimeId?: RuntimeId }) =>
      principalRemove(vars.name, vars.runtimeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["principals"] });
    },
  });
}

// ─── Caller identity (for the ADR-042 privacy gate) ─────────────

/**
 * Best-effort caller identity for the desktop.
 *
 * The desktop reads the active runtime's "local user" from the runtime
 * via `principal_list` (the `owner` field on each principal that the
 * local user owns). For a multi-user install the caller is the
 * `user:<hub-user-id>` Subject that was used to log into PekoHub; for
 * a single-user install the runtime exposes a single local DID. This
 * hook returns the Subject string the privacy-gate UI passes to
 * `principal_log` when the caller is not the principal's owner.
 */
export function useCallerSubject(): string {
  // Caller identity is always local — the dot keystore / vault key
  // identity is the desktop user's own. Remote principals live in
  // pekohub's identity space; their `owner` field comes back as a
  // pekohub user id, not this desktop's identity.
  const { data: principals } = usePrincipals();
  if (!principals || principals.length === 0) return "user:local";
  // Pick any owned principal — every owned principal shares an owner.
  const owned = principals.find((p) => p.owner && p.owner !== "");
  return owned?.owner || "user:local";
}

// ─── Principal send (chat) ──────────────────────────────────────

export interface PrincipalSendOptions {
  onEvent?: (msg: ChatStreamMsg) => void;
}

/**
 * Monotonically increasing `requestId` source for streaming sends.
 *
 * Caps at `2^62 - 1` then wraps to 1 so the desktop's namespace
 * stays disjoint from the runtime's successor ids, which the
 * `PrincipalSendControl` handler salts with `2^63` for collision
 * avoidance. Without the cap a long-lived desktop session could
 * drift into the runtime's namespace after ~292 years of continuous
 * use — the cap also documents the invariant so future readers don't
 * "fix" the wrap by switching the modulo.
 */
let nextRequestIdCounter = 1;
const REQUEST_ID_CAP = (1n << 62n) - 1n;
function nextRequestId(): number {
  const cur = nextRequestIdCounter++;
  if (BigInt(cur) >= REQUEST_ID_CAP) {
    nextRequestIdCounter = 2;
    return 1;
  }
  return cur;
}

/**
 * Send a message to a principal. Returns the supervisor's final
 * response as a string.
 *
 * If `onEvent` is provided, the supervisor's streaming events
 * (chunk deltas and agentic-iteration boundary markers) are pushed
 * through the callback as the response unfolds. The `Channel` wire
 * type is required by Tauri's IPC layer for streaming.
 *
 * The hook also exposes `sendControl({mode: "steer" | "interrupt"})`
 * so the chat input can redirect an in-flight stream instead of
 * blocking on it. The active streaming `requestId` is tracked in a
 * ref so the caller can pass it as `targetRequestId` without a
 * React re-render.
 */
export function usePrincipalSend() {
  const activeRequestIdRef = useRef<number | null>(null);
  const mutation = useMutation({
    mutationFn: async (vars: {
      name: string;
      message: string;
      onEvent?: (msg: ChatStreamMsg) => void;
      runtimeId?: RuntimeId;
    }): Promise<string> => {
      const rid = effectiveRuntimeId(vars.runtimeId);
      if (!vars.onEvent) {
        // Non-streaming path: no correlation id is needed for
        // follow-up control since there's no in-flight run to
        // target.
        activeRequestIdRef.current = null;
        return principalSend(vars.name, vars.message, rid);
      }
      // JS owns the request_id lifecycle — mint BEFORE the call so
      // `sendControl` can target the right run during streaming.
      // Mirrors the runtime-side cap so the two namespaces stay
      // disjoint from the runtime's successor-id space (2^63+).
      const requestId = nextRequestId();
      activeRequestIdRef.current = requestId;
      try {
        const result = await principalSendStream(
          vars.name,
          vars.message,
          requestId,
          vars.onEvent,
          rid,
        );
        return result.content;
      } finally {
        // Clear once settled — a follow-up steer would target a run
        // that's already drained and the runtime would reject it as
        // `unknown_run`.
        if (activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null;
        }
      }
    },
  });

  /**
   * Send a control packet (interrupt / steer) targeting the
   * currently-active streaming run, if any. Returns `null` if no
   * stream is active — the caller should silently no-op in that
   * case (button click races with stream completion). Throws on
   * transport failures so the caller can surface them inline.
   */
  const sendControl = useCallback(
    async (
      args: Omit<PrincipalSendControlArgs, "targetRequestId"> & {
        runtimeId?: RuntimeId;
      },
    ) => {
      const id = activeRequestIdRef.current;
      if (id == null) return null;
      const rid = effectiveRuntimeId(args.runtimeId);
      return principalSendControl(
        { ...args, targetRequestId: id },
        rid,
      );
    },
    [],
  );

  return {
    ...mutation,
    sendControl,
    activeRequestIdRef,
  };
}

// ─── Principal log (peko log, ADR-042) ──────────────────────────

/**
 * Read a peer's conversation thread with a Principal. Pass `peer =
 * undefined` for the principal's owner-root view (default
 * `peko log <PRINCIPAL>`); pass `peer = "user:<self>"` for peer
 * self-read. The runtime enforces the privacy contract.
 *
 * Returns the latest `limit` (default 100) messages plus paging
 * state. Callers that need older messages should use
 * `fetchOlderPrincipalLog` to walk pages without overlap or gaps.
 */
export function usePrincipalLog(
  name: string | undefined,
  peer: string | undefined,
  runtimeId?: RuntimeId,
) {
  const rid = effectiveRuntimeId(runtimeId);
  return useQuery({
    queryKey: ["principal-log", rid, name, peer ?? "owner"],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      return principalLog({ name, peer, limit: 100, runtimeId: rid });
    },
    enabled: !!name,
  });
}

/**
 * Manually fetch the next older page of chat-log messages for a
 * principal / peer pair. Returns the raw page envelope so callers
 * can reconcile (e.g. by message id) against their in-memory
 * history. Throws on daemon errors; the caller should treat the
 * thrown error as "stop paging".
 */
export async function fetchOlderPrincipalLog(params: {
  name: string;
  peer?: string;
  limit?: number;
  cursor: string;
  runtimeId?: RuntimeId;
}) {
  return principalLog({
    name: params.name,
    peer: params.peer,
    limit: params.limit ?? 100,
    cursor: params.cursor,
    runtimeId: params.runtimeId,
  });
}
