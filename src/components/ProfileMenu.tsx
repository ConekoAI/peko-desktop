import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Loader2, LogIn, LogOut, RefreshCw, Settings as SettingsIcon, User } from "lucide-react";
import {
  usePekohubBundle,
  usePekohubLogout,
  runOAuthFlow,
} from "../hooks/useRuntimes";
import { useSettings } from "../hooks/useSettings";

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
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const { data: bundle, isPending } = usePekohubBundle();
  const logout = usePekohubLogout();

  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const pekohubBaseUrl =
    settings?.find((s) => s.key === "pekohub.base_url")?.value ??
    "https://pekohub.org";
  const oauthScope =
    settings?.find((s) => s.key === "pekohub.oauth_scope")?.value ??
    "runtimes:read";

  const signedIn = bundle !== null && bundle !== undefined && !isPending;

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
    setOauthError(null);
    setSigningIn(true);
    try {
      const result = await runOAuthFlow({
        baseUrl: pekohubBaseUrl,
        scope: oauthScope,
      });
      if (result.added === 0) {
        setOauthError(
          "Signed in to PekoHub, but no runtimes were found for this account.",
        );
      }
    } catch (err) {
      setOauthError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Check your browser and try again.",
      );
    } finally {
      setSigningIn(false);
    }
  }

  function handleSignOut() {
    logout.mutate();
    setOpen(false);
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
              ? "PekoHub · signed in"
              : "Sign in to PekoHub"
        }
        className={[
          "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
          isPending
            ? "animate-pulse bg-slate-200 dark:bg-slate-800"
            : signedIn
              ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900"
              : "text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
        ].join(" ")}
      >
        {isPending ? null : signedIn ? (
          <Check className="h-5 w-5" />
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
            {signedIn ? "PekoHub · signed in" : "PekoHub · not signed in"}
          </div>

          <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />

          <button
            role="menuitem"
            onClick={() => {
              navigate({ to: "/settings" });
              handleMenuItemClose();
            }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span className="flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" />
              Settings
            </span>
            <span aria-hidden>→</span>
          </button>

          {!signedIn && (
            <button
              role="menuitem"
              data-testid="pekohub-signin"
              onClick={handleSignIn}
              disabled={signingIn}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {signingIn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              Sign in with PekoHub
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
                "Waiting for PekoHub to redirect you back… complete the sign-in in your browser to continue."}
              {oauthError && (
                <span className="block text-red-600 dark:text-red-400">
                  {oauthError}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}