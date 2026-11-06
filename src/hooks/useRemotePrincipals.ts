import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  hubWebOrigin,
  pekohubListAccessiblePekos,
  remotePrincipalAdd,
  remotePrincipalAdopt,
  remotePrincipalAdoptDms,
  remotePrincipalList,
  remotePrincipalRemove,
  remotePrincipalResolve,
  type AccessiblePrincipal,
  type RemotePrincipalResolveResult,
  type RemotePrincipalSummary,
} from "../lib/api";
import { usePrincipalStatus } from "./usePrincipalStatus";
import { pekoIdentity, type PekoIdentity } from "../lib/pekoIdentity";

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
 * A remote peko as the app shows it: its saved record, its live status
 * from the hub, and its face — the avatar its runtime announced and
 * the accent its owner sees (keyed by its id on that runtime). `record`
 * is undefined for a peko on this runtime or one no longer saved.
 */
export function useRemotePeko(runtimeId: string | undefined, name: string) {
  const { data: remotes } = useRemotePrincipals();
  const record =
    runtimeId && runtimeId !== "local"
      ? remotes?.find((r) => r.runtimeId === runtimeId && r.principalName === name)
      : undefined;
  const status = usePrincipalStatus(
    record ? record.runtimeId : "local",
    name,
    record?.owner,
    record?.hubUrl,
  );
  const profile = record ? status.data?.profile : undefined;
  const identity: PekoIdentity = pekoIdentity({
    name,
    localId: profile?.localId ?? undefined,
    avatar: profile?.avatar,
  });
  return {
    record,
    status,
    identity,
    description: profile?.description ?? record?.description ?? null,
  };
}

/**
 * Translate a share URL into a `RemotePrincipalResolveResult` so the
 * modal can show a confirmation card before the user clicks "Add".
 * The query is enabled only when the URL parses to the right shape;
 * `parseShareUrl` is a tiny inline helper that mirrors the Rust
 * `parse_share_url` rules.
 *
 * Accepted shapes:
 *   - `/@{owner}/{name}`                    — the peko's ID as its page
 *                                             (pekohub ADR-009)
 *   - `/peko/{owner}/{name}`, `/p/{owner}/{name}`
 *                                           — older share links (the hub
 *                                             redirects them)
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
  // /@{owner}/{name} — the peko's ID is its page; `@` may come encoded.
  const id = path.match(/^\/(?:@|%40)([^/]+)\/([^/]+)$/i);
  if (id)
    return {
      hubUrl: url.origin,
      owner: id[1].toLowerCase(),
      principalName: id[2],
      inviteToken: token,
    };
  const forms = [
    /^\/peko\/([^/]+)\/([^/]+)$/, // older canonical share link
    /^\/p\/([^/]+)\/([^/]+)$/, // older still
    /^\/v1\/public\/pekos\/([^/]+)\/([^/]+)$/, // API URL
    /^\/v1\/public\/principals\/([^/]+)\/([^/]+)$/, // retired API URL
  ];
  for (const form of forms) {
    const m = path.match(form);
    if (m) return { hubUrl: url.origin, owner: m[1], principalName: m[2], inviteToken: token };
  }
  return null;
}

/** A peko's ID as people write it (pekohub ADR-009): `@alice/ada`. */
const PEKO_ID = /^@([a-z0-9][a-z0-9_-]{0,127})\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/i;

/**
 * What someone typed into "add a peko", as a share link: a link stays as
 * it is; a peko's ID, `@alice/ada`, becomes its page on `hubUrl`'s website.
 */
export function shareLinkFromInput(input: string, hubUrl: string): string {
  const text = input.trim();
  const id = text.match(PEKO_ID);
  if (!id) return text;
  return `${hubWebOrigin(hubUrl)}/@${id[1].toLowerCase()}/${id[2]}`;
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
    // Your pekos on other computers come and go online as those
    // computers wake and sleep: read again on focus and every 30 s.
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Save one of your own pekos on another computer (from your account's
 * list) so it sits in Chats like a peko of this computer.
 */
export function useRemotePrincipalAdopt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hubUrl, peko }: { hubUrl: string; peko: AccessiblePrincipal }) =>
      remotePrincipalAdopt(hubUrl, peko),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["remote-principals"] });
    },
  });
}

/**
 * Which of `own` (your account's pekos) to save as remote pekos: those
 * with a Hub ID that live on another computer (not one of `here`, this
 * computer's pekos, by Hub ID or local id) and aren't saved under that
 * name as yours yet (one first saved from a DM becomes yours).
 */
export function ownPekosToAdopt(
  own: AccessiblePrincipal[],
  here: { hubId?: string | null; localId?: string }[],
  saved: RemotePrincipalSummary[],
): AccessiblePrincipal[] {
  const hereHub = new Set(here.map((p) => p.hubId).filter(Boolean));
  const hereLocal = new Set(here.map((p) => p.localId).filter(Boolean));
  return own.filter(
    (p) =>
      !!p.hubId &&
      !hereHub.has(p.hubId) &&
      !(p.localId && hereLocal.has(p.localId)) &&
      !saved.some(
        (r) => r.hubId === p.hubId && r.principalName === p.principalName && r.fromAccount,
      ),
  );
}

/**
 * Saved pekos of yours (`fromAccount`) that your account no longer
 * lists — deleted, made local-only, or given to someone else on their
 * computer — so they leave this computer's list too.
 */
export function ownPekosToForget(
  own: AccessiblePrincipal[],
  hubUrl: string,
  saved: RemotePrincipalSummary[],
): RemotePrincipalSummary[] {
  const listed = new Set(own.map((p) => p.hubId).filter(Boolean));
  const sameHub = (url: string) => url.replace(/\/+$/, "") === hubUrl.replace(/\/+$/, "");
  return saved.filter(
    (r) => r.fromAccount && !!r.hubId && sameHub(r.hubUrl) && !listed.has(r.hubId),
  );
}

/**
 * Keep the pekos you have DMs with on other computers in the list: the
 * runtime's DMs (opened here or followed from your other computers) are
 * saved as remote pekos, checked on focus and every minute while this
 * computer is signed in to `hubUrl`.
 */
export function useAdoptPekoDms(hubUrl: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["adopt-peko-dms", hubUrl ?? null],
    enabled: !!hubUrl,
    queryFn: async () => {
      const added = await remotePrincipalAdoptDms(hubUrl!);
      if (added > 0) await qc.invalidateQueries({ queryKey: ["remote-principals"] });
      return added;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
