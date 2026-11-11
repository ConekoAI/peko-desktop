import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LogIn, LogOut, RefreshCw, Unplug, User } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
          t("hub.menu.connectFailed", { error: result.error ?? t("hub.menu.unknownError") }),
        );
      }
    } catch (err) {
      if (mine !== attempt.current) return;
      setOauthError(
        err instanceof Error
          ? err.message
          : t("hub.menu.signInFailed"),
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
        aria-label={t("hub.menu.label")}
        title={
          isPending
            ? t("hub.menu.loading")
            : signedIn
              ? account
                ? t("hub.menu.signedInAs", { handle: account.handle })
                : t("hub.menu.signedIn")
              : t("hub.menu.signIn")
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
                ? t("hub.menu.headerHandle", { handle: account.handle })
                : t("hub.menu.signedIn")
              : t("hub.menu.notSignedIn")}
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
              {signingIn ? t("hub.menu.signInAgain") : t("hub.menu.signInWith")}
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
              {t("hub.menu.signOut")}
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
              {t("hub.menu.disconnect")}
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
                {t("hub.menu.relink")}
              </button>
            </>
          )}

          {(signingIn || oauthError) && (
            <div className="note-info mx-1 mb-1 mt-2 block text-xs">
              {signingIn &&
                t("hub.menu.waiting")}
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
              {t("hub.menu.disconnectFailed", { error: disconnectError })}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={disconnect?.kind === "confirm"}
        title={t("hub.disconnect.title")}
        message={t("hub.disconnect.message")}
        confirmText={disconnecting ? t("hub.disconnect.confirming") : t("hub.disconnect.confirm")}
        variant="danger"
        onConfirm={() => void handleDisconnect(false)}
        onCancel={() => setDisconnect(null)}
      />
      <ConfirmModal
        open={disconnect?.kind === "unsent"}
        title={t("hub.disconnect.unsentTitle")}
        message={t("hub.disconnect.unsentMessage", {
          count: disconnect?.kind === "unsent" ? disconnect.count : 0,
        })}
        confirmText={disconnecting ? t("hub.disconnect.confirming") : t("hub.disconnect.anyway")}
        cancelText={t("hub.disconnect.wait")}
        variant="danger"
        onConfirm={() => void handleDisconnect(true)}
        onCancel={() => setDisconnect(null)}
      />
    </div>
  );
}