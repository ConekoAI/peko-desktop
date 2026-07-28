/**
 * PR #8: discovery client for peko-desktop. Hits the public
 * PekoHub `/v1/discovery/search` endpoint over HTTPS using the
 * browser's `fetch`. PekoHub is anonymous-readable for this
 * endpoint, so no JWT is sent.
 *
 * Why not live in `api.ts`? `api.ts` is the Tauri IPC surface and
 * only knows how to talk to the local peko daemon. Discovery lives
 * over the public internet to a hub URL the user may not even be
 * signed in to yet, so it has its own thin module.
 */

export interface DiscoveryHit {
  id: string;
  publicName: string;
  description: string | null;
  ownerName: string;
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

const DEFAULT_HUB = "https://pekohub.org";

/**
 * Resolve which PekoHub base URL to query. The user can override
 * via localStorage (set by the Settings → Runtimes pane) — falls
 * back to the canonical hub when unset. Self-hosted hubs are
 * supported; `parseShareUrl` accepts any host (PR #4).
 */
export function resolveHubUrl(): string {
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem("pekohub.url");
    if (override) return override;
  }
  return DEFAULT_HUB;
}

export async function discoverySearch(
  hubUrl: string,
  opts?: { q?: string; category?: string; sort?: string },
): Promise<DiscoveryResult> {
  const params = new URLSearchParams();
  if (opts?.q) params.set("q", opts.q);
  if (opts?.category) params.set("category", opts.category);
  if (opts?.sort) params.set("sort", opts.sort);
  params.set("page", "1");
  params.set("per_page", "24");

  const url = `${hubUrl.replace(/\/$/, "")}/v1/discovery/search?${params}`;
  const res = await fetch(url, {
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Discovery search failed: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Build the canonical share URL for a hit — same shape pekohub's
 * SPA uses. Mirrors `shareUrlFor` in
 * `pekohub/frontend/src/lib/api.ts` so both apps emit identical
 * deep-link inputs to peko-desktop's `parseDeepLink` (PR #6).
 */
export function shareUrlFor(hubUrl: string, hit: { ownerName: string; publicName: string }): string {
  const base = hubUrl.replace(/\/$/, "");
  return `${base}/p/${encodeURIComponent(hit.ownerName)}/${encodeURIComponent(hit.publicName)}`;
}

/**
 * Build the deep-link URL the desktop itself accepts. The share
 * URL is wrapped so the OS hands it back to the desktop (not the
 * browser) when the user clicks the link.
 */
export function deepLinkFor(hubUrl: string, hit: { ownerName: string; publicName: string }): string {
  return `peko://add-principal?url=${encodeURIComponent(shareUrlFor(hubUrl, hit))}`;
}