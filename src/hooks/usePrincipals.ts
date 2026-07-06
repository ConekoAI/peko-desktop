import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke, Channel } from "@tauri-apps/api/core";

import { principalLog } from "../lib/api";

// ─── Principal list / detail ─────────────────────────────────────

export interface PrincipalSummary {
  name: string;
  exposure: string;
  status: string;
  description?: string;
  owner: string;
  runtimeId: string;
}

export function usePrincipals() {
  return useQuery({
    queryKey: ["principals", "local"],
    queryFn: () => invoke<PrincipalSummary[]>("principal_list"),
  });
}

export function usePrincipal(name: string | undefined) {
  return useQuery({
    queryKey: ["principals", "local", name],
    queryFn: () => {
      if (!name) throw new Error("principal name required");
      // Principal detail is a subset of the list today; fetch the list
      // and filter. A dedicated `principal_show` IPC variant will be
      // added in a follow-up PR.
      return invoke<PrincipalSummary[]>("principal_list").then((all) =>
        all.find((p) => p.name === name) ?? null,
      );
    },
    enabled: !!name,
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
        return invoke<string>("principal_send", {
          name: vars.name,
          message: vars.message,
        });
      }
      const channel = new Channel<string>();
      channel.onmessage = vars.onChunk;
      return invoke<string>("principal_send_stream", {
        app: undefined,
        name: vars.name,
        message: vars.message,
        onChunk: channel,
      });
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