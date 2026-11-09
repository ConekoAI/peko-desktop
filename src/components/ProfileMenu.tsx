import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LogIn, LogOut, RefreshCw, Unplug, User } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  afterPekohubSignIn,
  usePekohubBundle,
  usePekohubLogout,
  runOAuthFlow,
} from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";
import { configuredHubUrl, hubAccount, runtimeHubDisconnect } from "../lib/api";
import ConfirmModal from "./modals/ConfirmModal";
import { PEKOHUB_SIGN_IN_EVENT } from "../lib/pekohubSignIn";

/** The disconnect confirmation on screen, if any. */
type DisconnectStep = { kind: "confirm" } | { kind: "unsent"; count: number };

/**
 * Chrome-level profile menu — top of the AppRail, accessible from any
 * route. Owns the PekoHub OAuth sign-in / signed-in / sign-in-flight /
 * sign-out lifecycle, replacing the buried Settings → Connected
 * Runtimes → "Sign in with PekoHub" button (and the now-removed
 * Registry → Log In modal).
 *
 * States:
 *   - loading:  usePekohubBundle.isPending (avatar skeleton)
 *   - signed-out:   no bundle stored (User icon)
 *   - signing-in:   runOAuthFlow in flight (spinner)
 *   - signed-in:    bundle stored (indigo checkmark)
 *
 * Reuses (no new auth code):
 *   - usePekohubBundle / usePekohubLogout / runOAuthFlow from useRuntimes.ts
 *   - Pekohub base URL / OAuth scope from useSettings() (same keys
 *     Settings.tsx read — the Add Remote modal still needs them)
 *   - start_oauth_callback_listener Tauri command is already called
 *     by runOAuthFlow.
 */
export default function ProfileMenu() {
  const { data: settings } = useSettings();
  const { data: bundle, isPending } = usePekohubBundle();
  const logout = usePekohubLogout();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<DisconnectStep | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // The latest sign-in attempt. Pressing Sign in again while one waits
  // (its browser page never loaded, say) starts a new one; the old one
  // ends without a word, and only the latest attempt sets the state.
  const attempt = useRef(0);

  const pekohubBaseUrl =
    configuredHubUrl(settings);
  const oauthScope =
    settings?.find((s) => s.key === "pekohub.oauth_scope")?.value ??
    "runtimes:read";

  const signedIn = bundle !== null && bundle !== undefined && !isPending;
  // Who is signed in, with their picture, for the rail button.
  const { data: account } = useQuery({
    queryKey: ["hub-account", pekohubBaseUrl],
    queryFn: () => hubAccount(pekohubBaseUrl),
    enabled: signedIn,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const accountName = account ? (account.displayName ?? `@${account.handle}`) : null;

  // Elsewhere in the app (a fresh computer's empty chat page) asks to
  // sign in: open the menu and start, so this menu stays the one owner
  // of the sign-in state.
  useEffect(() => {
    function handleRequest() {
      setOpen(true);
      void handleSignIn();
    }
    window.addEventListener(PEKOHUB_SIGN_IN_EVENT, handleRequest);
    return () => window.removeEventListener(PEKOHUB_SIGN_IN_EVENT, handleRequest);
  });

  // Outside-click + Escape close the dropdown.
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function handleSignIn() {
    const mine = ++attempt.current;
    setOauthError(null);
    setSigningIn(true);
    try {
      const result = await runOAuthFlow({
        baseUrl: pekohubBaseUrl,
        scope: oauthScope,
      });
      if (mine !== attempt.current) return;
      // The token is stored now: show it (the cached "not signed in"
      // would otherwise stand until something refetched it).
      await afterPekohubSignIn(queryClient);
      if (!result.registered) {
        setOauthError(
          `Signed in, but this computer couldn't connect to PekoHub: ${result.error ?? "unknown error"}`,
        );
      }
    } catch (err) {
      if (mine !== attempt.current) return;
      setOauthError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Check your browser and try again.",
      );
    } finally {
      if (mine === attempt.current) setSigningIn(false);
    }
  }

  function handleSignOut() {
    logout.mutate(pekohubBaseUrl);
    setOpen(false);
  }

  /**
   * Disconnect this computer (runtime ADR-091 D5), then sign out. A first
   * try changes nothing while messages are undelivered; the second
   * confirmation names them and goes on anyway.
   */
  async function handleDisconnect(discardUnsent: boolean) {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const result = await runtimeHubDisconnect(pekohubBaseUrl, discardUnsent);
      if (!result.done && result.unsent) {
        setDisconnect({ kind: "unsent", count: result.unsent });
        return;
      }
      setDisconnect(null);
      // The local user is no longer linked to the account.
      void queryClient.invalidateQueries({ queryKey: ["local-user-account"] });
      logout.mutate(pekohubBaseUrl);
    } catch (err) {
      setDisconnect(null);
      setDisconnectError(err instanceof Error ? err.message : String(err));
      setOpen(true);
    } finally {
      setDisconnecting(false);
    }
  }

  function handleMenuItemClose() {
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-label="PekoHub account menu"
        title={
          isPending
            ? "Loading PekoHub status…"
            : signedIn
              ? account
                ? `PekoHub · signed in as @${account.handle}`
                : "PekoHub · signed in"
              : "Sign in to PekoHub"
        }
        className={[
          "flex h-11 w-11 items-center justify-center overflow-hidden transition-all duration-200",
          isPending
            ? "animate-pulse rounded-full bg-surface-sunken"
            : signedIn
              ? "rounded-full bg-peko-800 text-peko-100 ring-2 ring-transparent hover:ring-peko-400/60"
              : "rounded-[22px] bg-surface-sunken text-fg-soft hover:rounded-xl hover:bg-brand hover:text-white",
        ].join(" ")}
      >
        {isPending ? null : signedIn ? (
          account?.avatar ? (
            <img
              src={account.avatar}
              alt=""
              data-testid="pekohub-avatar"
              className="h-full w-full object-cover"
            />
          ) : accountName ? (
            <span className="text-sm font-semibold" data-testid="pekohub-initial">
              {accountName.replace(/^@/, "").charAt(0).toUpperCase()}
            </span>
          ) : (
            <Check className="h-5 w-5" />
          )
        ) : signingIn ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <User className="h-5 w-5" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="popover absolute bottom-0 left-full z-50 ml-3 w-64"
        >
          <div className="px-2.5 pb-1.5 pt-2 text-xs font-medium text-fg-muted">
            {signedIn
              ? account
                ? `PekoHub · @${account.handle}`
                : "PekoHub · signed in"
              : "PekoHub · not signed in"}
          </div>

          <div className="my-1 h-px bg-line" />

          {!signedIn && (
            <button
              role="menuitem"
              data-testid="pekohub-signin"
              onClick={handleSignIn}
              className="menu-item"
            >
              {signingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {signingIn ? "Start sign-in again" : "Sign in with PekoHub"}
            </button>
          )}

          {signedIn && (
            <button
              role="menuitem"
              data-testid="pekohub-signout"
              onClick={handleSignOut}
              disabled={logout.isPending}
              className="menu-item hover:bg-danger-soft hover:text-danger"
            >
              {logout.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Sign out
            </button>
          )}

          {signedIn && (
            <button
              role="menuitem"
              data-testid="pekohub-disconnect"
              onClick={() => {
                setDisconnect({ kind: "confirm" });
                setOpen(false);
              }}
              disabled={disconnecting}
              className="menu-item hover:bg-danger-soft hover:text-danger"
            >
              {disconnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Unplug className="h-4 w-4" />
              )}
              Disconnect this computer…
            </button>
          )}

          {signedIn && (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                role="menuitem"
                onClick={() => {
                  handleSignIn();
                  handleMenuItemClose();
                }}
                disabled={signingIn}
                className="menu-item"
              >
                {signingIn ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Re-link PekoHub account
              </button>
            </>
          )}

          {(signingIn || oauthError) && (
            <div className="note-info mx-1 mb-1 mt-2 block text-xs">
              {signingIn &&
                "Waiting for PekoHub to redirect you back… complete the sign-in in your browser to continue. If the page didn't open, start again."}
              {oauthError && (
                <span className="block text-danger">
                  {oauthError}
                </span>
              )}
            </div>
          )}

          {disconnectError && (
            <div
              data-testid="pekohub-disconnect-error"
              className="note-danger mx-1 mb-1 mt-2 block text-xs"
            >
              This computer couldn't disconnect: {disconnectError}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={disconnect?.kind === "confirm"}
        title="Disconnect this computer?"
        message="Your pekos on this computer go local-only, so nobody can reach them through PekoHub, and you're signed out. This computer's copies of your chats with pekos on other computers are deleted; those computers keep them, and they come back when you sign in again."
        confirmText={disconnecting ? "Disconnecting…" : "Disconnect"}
        variant="danger"
        onConfirm={() => void handleDisconnect(false)}
        onCancel={() => setDisconnect(null)}
      />
      <ConfirmModal
        open={disconnect?.kind === "unsent"}
        title="Some messages haven't been delivered"
        message={`${disconnect?.kind === "unsent" ? disconnect.count : 0} message(s) to pekos on other computers haven't reached them yet, because those computers are offline. Disconnecting now loses them. Wait until they're delivered, or disconnect anyway.`}
        confirmText={disconnecting ? "Disconnecting…" : "Disconnect anyway"}
        cancelText="Wait"
        variant="danger"
        onConfirm={() => void handleDisconnect(true)}
        onCancel={() => setDisconnect(null)}
      />
    </div>
  );
}