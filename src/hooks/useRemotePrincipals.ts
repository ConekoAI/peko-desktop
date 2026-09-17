import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  pekohubListAccessiblePekos,
  remotePrincipalAdd,
  remotePrincipalList,
  remotePrincipalRemove,
  remotePrincipalResolve,
  type AccessiblePrincipal,
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

export type { RemotePrincipalSummary, RemotePrincipalResolveResult, AccessiblePrincipal };

/**
 * Translate a share URL into a `RemotePrincipalResolveResult` so the
 * modal can show a confirmation card before the user clicks "Add".
 * The query is enabled only when the URL parses to the right shape;
 * `parseShareUrl` is a tiny inline helper that mirrors the Rust
 * `parse_share_url` rules.
 *
 * Accepted shapes (pekohub ADR-005):
 *   - `/peko/{owner}/{name}`                — current canonical share link
 *   - `/p/{owner}/{name}`                   — legacy share link (still
 *                                             accepted on input; the hub
 *                                             keeps a redirect)
 *   - `/v1/public/pekos/{owner}/{name}`     — current API URL form
 *   - `/v1/public/principals/{owner}/{name}`— legacy API URL form
 * Each accepts an optional `?token=...` invite-token query.
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
  // /peko/{owner}/{name} — current canonical form
  const peko = path.match(/^\/peko\/([^/]+)\/([^/]+)$/);
  if (peko)
    return { hubUrl: url.origin, owner: peko[1], principalName: peko[2], inviteToken: token };
  // /p/{owner}/{name} — legacy share-link form
  const p = path.match(/^\/p\/([^/]+)\/([^/]+)$/);
  if (p) return { hubUrl: url.origin, owner: p[1], principalName: p[2], inviteToken: token };
  // /v1/public/pekos/{owner}/{name} — current API URL form
  const apiPeko = path.match(/^\/v1\/public\/pekos\/([^/]+)\/([^/]+)$/);
  if (apiPeko)
    return {
      hubUrl: url.origin,
      owner: apiPeko[1],
      principalName: apiPeko[2],
      inviteToken: token,
    };
  // /v1/public/principals/{owner}/{name} — legacy API URL form
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

// ─── Accessible pekos (pekohub ADR-005) ──────────────────────────
//
// The hub's `/v1/me/accessible-pekos` endpoint replaced
// `/v1/me/accessible-principals` (old path is 404) and narrowed in
// semantics: it now returns the caller's own pekos plus
// `private`-exposure entries they can reach — not "shared with me"
// in the old sense. Grouping copy should say "accessible" / "My
// private pekos", not "shared".

/**
 * List the pekos the signed-in user can reach on `hubUrl`
 * (owner-only + private exposure). The query is disabled until both
 * a hub URL and an access token are supplied — callers source those
 * from the PekoHub OAuth bundle (`usePekohubBundle` /
 * `loadOAuthBundle` in `useRuntimes.ts`) and the
 * `pekohub.base_url` setting.
 */
export function useAccessiblePrincipals(hubUrl?: string, accessToken?: string) {
  return useQuery({
    queryKey: ["accessible-principals", hubUrl ?? null],
    enabled: !!hubUrl && !!accessToken,
    queryFn: () => pekohubListAccessiblePekos(hubUrl!, accessToken!),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
