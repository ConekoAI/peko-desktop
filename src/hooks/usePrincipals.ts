import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  principalCreate,
  principalGet,
  principalList,
  principalLog,
  principalSend,
  principalSendStream,
  type PrincipalCreateRequest,
  type PrincipalSummary,
} from "../lib/api";

export type { PrincipalSummary };

// ─── Principal list / detail ─────────────────────────────────────

export function usePrincipals() {
  return useQuery({
    queryKey: ["principals", "local"],
    queryFn: principalList,
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
