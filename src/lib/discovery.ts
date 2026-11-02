/**
 * Finding people, pekos and seeds on a PekoHub (pekohub ADR-009).
 *
 * The hub lists no one: a person (`@alice`) or a public peko
 * (`@alice/ada`) is found only by its exact ID. Seeds, which you
 * download, are searched by text. One endpoint, `GET /v1/search`, reads
 * the query as an ID first and puts exact matches in `exact`. Read
 * through the backend (`hubGet`: the webview's content security policy
 * allows no outside hosts); it is anonymous-readable, so no token is sent.
 */

import { hubApiBase, hubGet, hubJson, hubWebOrigin } from "./api";

/** An exact match for an ID: a person, a public peko, or a seed. */
export type ExactHit =
  | { kind: "person"; id: string; handle: string; displayName: string; avatarUrl: string | null; url: string }
  | {
      kind: "peko";
      id: string;
      owner: string;
      name: string;
      displayName: string;
      description: string | null;
      avatar: string | null;
      status: string;
      url: string;
    }
  | {
      kind: "seed";
      id: string;
      owner: string;
      name: string;
      displayName: string | null;
      description: string | null;
      version: string;
      url: string;
    };

/** A seed matching the text. */
export interface SeedHit {
  namespace: string;
  name: string;
  version: string;
  description?: string;
}

export interface HubSearchResult {
  /** How the hub read the query: an ID's kind, or free text. */
  queryKind: "person" | "peko" | "seed" | "text";
  exact: ExactHit[];
  items: SeedHit[];
  total: number;
}

/**
 * The PekoHub to search: the app's `pekohub.base_url` setting (the
 * same hub sign-in and the peko list use), else the default hub.
 * Self-hosted hubs are supported; `parseShareUrl` accepts any host.
 */
export function resolveHubUrl(configured?: string | null): string {
  return hubApiBase(configured);
}

export async function hubSearch(hubUrl: string, q: string): Promise<HubSearchResult> {
  const res = await hubGet(hubUrl, "search", { query: { q, page: "1", perPage: "24" } });
  if (!res.ok) {
    throw new Error(`Search failed: HTTP ${res.status}`);
  }
  const body = (await hubJson(res, hubUrl)) as Partial<HubSearchResult>;
  // A hub from before ADR-009 sends seeds only.
  return {
    queryKind: body.queryKind ?? "text",
    exact: body.exact ?? [],
    items: body.items ?? [],
    total: body.total ?? 0,
  };
}

/**
 * A peko's share link: its ID as a page on the hub's website,
 * `https://pekohub.ai/@alice/ada` (pekohub ADR-009). Mirrors the hub's
 * own `shareUrl`, so both emit the same input to `parseDeepLink`.
 */
export function shareUrlFor(hubUrl: string, peko: { owner: string; name: string }): string {
  return `${hubWebOrigin(hubUrl)}/@${encodeURIComponent(peko.owner)}/${encodeURIComponent(peko.name)}`;
}

/**
 * The deep link the desktop itself accepts. The share URL is wrapped
 * so the OS hands it back to the desktop (not the browser) when the
 * user clicks the link. Emits only the current `peko://add-peko` form;
 * `parseDeepLink` still accepts the legacy `peko://add-principal` form
 * on receipt.
 */
export function deepLinkFor(hubUrl: string, peko: { owner: string; name: string }): string {
  return `peko://add-peko?url=${encodeURIComponent(shareUrlFor(hubUrl, peko))}`;
}
