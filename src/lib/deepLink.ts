import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onOpenUrl, getCurrent as getCurrentDeepLinks } from "@tauri-apps/plugin-deep-link";

import { remotePrincipalAdd } from "./api";
import { parseShareUrl } from "../hooks/useRemotePrincipals";

/**
 * PR #6: deep-link handler for share URLs from chat apps / browsers.
 *
 * Two URL shapes are accepted:
 *
 * 1. `peko://add-principal?url=<encoded share URL>`
 *    The explicit "share with peko-desktop" link form, generated
 *    by the SPA when the user clicks "Add to my desktop" on a
 *    discover card (PR #8). The inner URL is always a pekohub
 *    share URL (canonical or legacy API form).
 *
 * 2. `https://<hub>/p/<owner>/<name>?token=<optional>`
 *    The canonical pekohub share link itself. When the OS hands
 *    this to the desktop (because the user has peko-desktop
 *    installed and the link was clicked from another app), the
 *    desktop treats it as an add request directly.
 *
 * Both paths converge on `addByDeepLink(url)` which (a) parses the
 * URL through the same `parseShareUrl` rule the modal uses, (b)
 * calls `remotePrincipalAdd` so the HubRemoteClient is registered
 * in AppState, and (c) emits `deep-link-handled` so the React
 * layer can navigate to the new principal's chat.
 */

/**
 * Parsed result of a deep-link URL. `null` means the URL didn't
 * match either expected shape — the caller surfaces a visible
 * "unsupported link" error to the user.
 */
export type DeepLinkIntent =
  | { kind: "add-principal"; shareUrl: string }
  | { kind: "pekohub-share"; shareUrl: string };

/**
 * Parse a raw URL into a `DeepLinkIntent`. Pure function — no
 * side effects, no network. Used both by the live deep-link
 * handler and by unit tests.
 */
export function parseDeepLink(raw: string): DeepLinkIntent | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // Shape 1: `peko://add-principal?url=...`
  if (url.protocol === "peko:") {
    if (url.hostname !== "add-principal") return null;
    const inner = url.searchParams.get("url");
    if (!inner) return null;
    return { kind: "add-principal", shareUrl: inner };
  }

  // Shape 2: `https://<hub>/p/<owner>/<name>` (canonical) or
  // `https://<hub>/v1/public/principals/<owner>/<name>` (legacy).
  // `parseShareUrl` already encodes both shapes plus the optional
  // `?token=...` query — we only need to check that the URL has
  // one of those path shapes.
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (parseShareUrl(raw)) {
      return { kind: "pekohub-share", shareUrl: raw };
    }
  }

  return null;
}

/**
 * Wire the deep-link handler to the OS. Returns an `unlisten`
 * function that disconnects every active listener (the
 * `deep-link-received` event from the Rust side, the
 * `onOpenUrl` callback for live URLs, and drains any cold-start
 * URLs).
 *
 * Calls `remotePrincipalAdd` for every accepted intent. Errors
 * are surfaced as a `deep-link-error` event so the React layer
 * can show an inline toast; we never silently drop a URL.
 */
export async function installDeepLinkHandler(): Promise<UnlistenFn> {
  // (1) Hot path: Rust side forwards every URL the OS hands us as
  // a `deep-link-received` string event. We re-parse + route here.
  const unlistenRust = await listen<string>("deep-link-received", (event) => {
    void handleRawUrl(event.payload);
  });

  // (2) Cold path: if the app was launched BY a deep link (rather
  // than already running), `getCurrent()` returns the URLs the OS
  // passed on launch. Drain them once at startup.
  let initialUnlisten: (() => void) | undefined;
  try {
    const initial = await getCurrentDeepLinks();
    if (initial && initial.length > 0) {
      for (const url of initial) {
        void handleRawUrl(url);
      }
    }
  } catch {
    // Plugin not available in dev / non-desktop builds; ignore.
  }

  // (3) Live path: URLs arriving while the app is running.
  // `onOpenUrl` is the plugin's primary callback for the live case.
  let unlistenPlugin: UnlistenFn | undefined;
  try {
    unlistenPlugin = await onOpenUrl((urls) => {
      for (const url of urls) {
        void handleRawUrl(url);
      }
    });
  } catch {
    // Same fallback as above — dev / non-desktop.
  }

  return async () => {
    unlistenRust();
    if (unlistenPlugin) await unlistenPlugin();
    if (initialUnlisten) initialUnlisten();
  };
}

async function handleRawUrl(raw: string): Promise<void> {
  const intent = parseDeepLink(raw);
  if (!intent) {
    await emit("deep-link-error", `Unsupported link: ${raw}`);
    return;
  }
  try {
    await remotePrincipalAdd(intent.shareUrl);
    await emit("deep-link-handled", intent);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await emit("deep-link-error", `Failed to add remote principal: ${message}`);
  }
}