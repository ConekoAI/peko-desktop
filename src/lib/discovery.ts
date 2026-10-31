/**
 * PR #8: discovery client for peko-desktop. Reads the public PekoHub
 * `/v1/discovery/search` endpoint through the backend (`hubGet`: the
 * webview's content security policy allows no outside hosts).
 * PekoHub is anonymous-readable for this endpoint, so no token is sent.
 */

import { DEFAULT_HUB_URL, hubGet, hubJson } from "./api";

export interface DiscoveryHit {
  id: string;
  publicName: string;
  description: string | null;
  /** The owner's display name: a label, not an address. */
  ownerName: string;
  /** The owner's handle on the hub; share links are built from it. */
  ownerNamespace?: string | null;
  /** The peko's avatar (an emoji or short monogram), from hubs that send it. */
  avatar?: string | null;
  category: string | null;
  tags: string[];
  status: "online" | "offline" | "busy" | "error";
  publishedAt: string | null;
  featured: boolean;
}

export interface DiscoveryResult {
  hits: DiscoveryHit[];
  total: number;
  page: number;
}


/**
 * The PekoHub to search: the app's `pekohub.base_url` setting (the
 * same hub sign-in and the peko list use), else the default hub.
 * Self-hosted hubs are supported; `parseShareUrl` accepts any host.
 */
export function resolveHubUrl(configured?: string | null): string {
  return configured?.trim() || DEFAULT_HUB_URL;
}

export async function discoverySearch(
  hubUrl: string,
  opts?: { q?: string; category?: string; sort?: string },
): Promise<DiscoveryResult> {
  const query: Record<string, string> = {};
  if (opts?.q) query.q = opts.q;
  if (opts?.category) query.category = opts.category;
  if (opts?.sort) query.sort = opts.sort;
  query.page = "1";
  query.per_page = "24";

  const res = await hubGet(hubUrl, "discovery_search", { query });
  if (!res.ok) {
    throw new Error(`Discovery search failed: HTTP ${res.status}`);
  }
  return hubJson(res, hubUrl);
}

/**
 * Build the canonical share URL for a hit — same shape pekohub's
 * SPA uses (`/peko/{owner}/{name}` per pekohub ADR-005; the legacy
 * `/p/...` form is dead on emission but still accepted on input).
 * Mirrors `shareUrlFor` in `pekohub/frontend/src/lib/api.ts` so both
 * apps emit identical deep-link inputs to peko-desktop's
 * `parseDeepLink` (PR #6).
 */
export function shareUrlFor(
  hubUrl: string,
  hit: { ownerName: string; ownerNamespace?: string | null; publicName: string },
): string {
  const base = hubUrl.replace(/\/$/, "");
  // The hub resolves `/peko/:owner` against the handle; the display
  // name only matches it by chance (older hubs send no handle).
  const owner = hit.ownerNamespace ?? hit.ownerName;
  return `${base}/peko/${encodeURIComponent(owner)}/${encodeURIComponent(hit.publicName)}`;
}

/**
 * Build the deep-link URL the desktop itself accepts. The share
 * URL is wrapped so the OS hands it back to the desktop (not the
 * browser) when the user clicks the link. Emits only the current
 * `peko://add-peko` form; `parseDeepLink` still accepts the legacy
 * `peko://add-principal` form on receipt.
 */
export function deepLinkFor(
  hubUrl: string,
  hit: { ownerName: string; ownerNamespace?: string | null; publicName: string },
): string {
  return `peko://add-peko?url=${encodeURIComponent(shareUrlFor(hubUrl, hit))}`;
}