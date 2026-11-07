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
          "flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl transition-all",
          isPending
            ? "animate-pulse bg-slate-200 dark:bg-slate-800"
            : signedIn
              ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900"
              : "text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
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
          className="absolute bottom-0 left-full z-50 ml-2 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {signedIn
              ? account
                ? `PekoHub · @${account.handle}`
                : "PekoHub · signed in"
              : "PekoHub · not signed in"}
          </div>

          <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />

          {!signedIn && (
            <button
              role="menuitem"
              data-testid="pekohub-signin"
              onClick={handleSignIn}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
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
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-red-950/30 dark:hover:text-red-400"
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
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-red-950/30 dark:hover:text-red-400"
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
              <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
              <button
                role="menuitem"
                onClick={() => {
                  handleSignIn();
                  handleMenuItemClose();
                }}
                disabled={signingIn}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
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
            <div className="mx-3 mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
              {signingIn &&
                "Waiting for PekoHub to redirect you back… complete the sign-in in your browser to continue. If the page didn't open, start again."}
              {oauthError && (
                <span className="block text-red-600 dark:text-red-400">
                  {oauthError}
                </span>
              )}
            </div>
          )}

          {disconnectError && (
            <div
              data-testid="pekohub-disconnect-error"
              className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
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