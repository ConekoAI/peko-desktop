import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  remotePrincipalAdd,
  remotePrincipalList,
  remotePrincipalRemove,
  remotePrincipalResolve,
  type RemotePrincipalResolveResult,
  type RemotePrincipalSummary,
} from "../lib/api";

/**
 * PR #4: list the desktop's remote-principal table. The query key
 * is stable across mounts so React Query can dedupe the IPC round-
 * trip when the sidebar mounts alongside the chat.
 */
export function useRemotePrincipals() {
  return useQuery({
    queryKey: ["remote-principals"],
    queryFn: () => remotePrincipalList(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export type { RemotePrincipalSummary, RemotePrincipalResolveResult };

/**
 * Translate a share URL into a `RemotePrincipalResolveResult` so the
 * modal can show a confirmation card before the user clicks "Add".
 * The query is enabled only when the URL parses to the right shape;
 * `parseShareUrl` is a tiny inline helper that mirrors the Rust
 * `parse_share_url` rules.
 */
export function parseShareUrl(raw: string):
  | { hubUrl: string; owner: string; principalName: string; inviteToken?: string }
  | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.replace(/\/$/, "");
  const token = url.searchParams.get("token") ?? undefined;
  // /p/{owner}/{name}
  const p = path.match(/^\/p\/([^/]+)\/([^/]+)$/);
  if (p) return { hubUrl: url.origin, owner: p[1], principalName: p[2], inviteToken: token };
  // /v1/public/principals/{owner}/{name}
  const a = path.match(/^\/v1\/public\/principals\/([^/]+)\/([^/]+)$/);
  if (a)
    return {
      hubUrl: url.origin,
      owner: a[1],
      principalName: a[2],
      inviteToken: token,
    };
  return null;
}

/**
 * Resolver used by the modal's "Check" step. We don't auto-call
 * the hub on every keystroke — the form only invokes the IPC
 * resolver when the user explicitly clicks the check button.
 */
export function useRemotePrincipalResolve() {
  return useMutation({
    mutationFn: (shareUrl: string) => remotePrincipalResolve(shareUrl),
  });
}

/**
 * Add a remote principal to the desktop's table. The run-time
 * re-resolves the principal against the hub (so the persisted row
 * reflects the latest canonical fields) and then writes the JSON
 * file. Invalidates the cache so the sidebar updates.
 */
export function useRemotePrincipalAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareUrl: string) => remotePrincipalAdd(shareUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-principals"] });
    },
  });
}

/**
 * Remove a remote principal. Invalidates the cache; the sidebar
 * row disappears on the next render.
 */
export function useRemotePrincipalRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      hubUrl: string;
      owner: string;
      principalName: string;
    }) => remotePrincipalRemove(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-principals"] });
    },
  });
}
