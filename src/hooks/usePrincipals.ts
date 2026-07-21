import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  principalCreate,
  principalGet,
  principalList,
  principalLog,
  principalRemove,
  principalSend,
  principalSendStream,
  principalUpdate,
  type PrincipalCreateRequest,
  type PrincipalSummary,
  type PrincipalUpdateRequest,
} from "../lib/api";

export type { PrincipalSummary };

// ─── Principal list / detail ─────────────────────────────────────

export function usePrincipals() {
  return useQuery({
    queryKey: ["principals", "local"],
    queryFn: principalList,
    // The runtime list call is ~5 ms via CLI, but the desktop path goes
    // through Tauri -> IPC ensure_daemon probe -> daemon roundtrip, so
    // each fetch is tens-to-hundreds of milliseconds. Keep the list fresh
    // enough without re-running that path on every mount or window focus.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function usePrincipal(name: string | undefined) {
  return useQuery({
    queryKey: ["principals", "local", name],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      return principalGet(name);
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
      qc.invalidateQueries({ queryKey: ["principals"] });
      qc.invalidateQueries({ queryKey: ["principals", "local", vars.name] });
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
    mutationFn: (name: string) => principalRemove(name),
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
  const { data: principals } = usePrincipals();
  if (!principals || principals.length === 0) return "user:local";
  // Pick any owned principal — every owned principal shares an owner.
  const owned = principals.find((p) => p.owner && p.owner !== "");
  return owned?.owner || "user:local";
}

// ─── Principal send (chat) ──────────────────────────────────────

export interface PrincipalSendOptions {
  onChunk?: (delta: string) => void;
}

/**
 * Send a message to a principal. Returns the supervisor's final
 * response as a string.
 *
 * If `onChunk` is provided, the supervisor's streaming deltas are
 * pushed through the callback as the response unfolds. The `Channel`
 * wire type is required by Tauri's IPC layer for streaming.
 */
export function usePrincipalSend() {
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      message: string;
      onChunk?: (delta: string) => void;
    }): Promise<string> => {
      if (!vars.onChunk) {
        return principalSend(vars.name, vars.message);
      }
      return principalSendStream(vars.name, vars.message, vars.onChunk);
    },
  });
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
) {
  return useQuery({
    queryKey: ["principal-log", name, peer ?? "owner"],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      return principalLog({ name, peer, limit: 100 });
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
}) {
  return principalLog({
    name: params.name,
    peer: params.peer,
    limit: params.limit ?? 100,
    cursor: params.cursor,
  });
}
