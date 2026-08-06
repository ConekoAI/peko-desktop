import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import Sidebar from "./Sidebar";
import AppRail from "./AppRail";
import PrincipalSidebar from "./PrincipalSidebar";
import ChannelSidebar from "./ChannelSidebar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";
import EngineFailureCard from "./EngineFailureCard";
import VersionMismatchBanner from "./VersionMismatchBanner";
import FirstRunWalkthrough from "./FirstRunWalkthrough";
import CreatePrincipalModal from "./modals/CreatePrincipalModal";
import AddRemotePrincipalModal from "./modals/AddRemotePrincipalModal";
import { useEngineStatus } from "../hooks/useEngine";
import { useEngineVersionMismatch } from "../hooks/useEngine";
import { getTheme, setTheme, applyTheme } from "../lib/theme";
import { installDeepLinkHandler } from "../lib/deepLink";
import { useQueryClient } from "@tanstack/react-query";
import { Sun, Moon, Monitor } from "lucide-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  // Engine state is invisible on the happy path (ADR-043 §adoption).
  // We still poll `useEngineStatus` so the failure card can surface
  // when the engine is in `Failed` (and so the layout reacts to the
  // CLI-daemon-died scenario for borrowed engines). The badge in
  // the header is gone — version/about links live in Settings → About.
  const { data: engine } = useEngineStatus();
  const { mismatch, dismiss } = useEngineVersionMismatch();
  const [theme, setThemeState] = useState<"light" | "dark" | "system">("system");
  // T-105: hoisted CreatePrincipalModal state so the sidebar's
  // empty-state CTA can open it. Chat.tsx and Dashboard.tsx keep
  // their own local instances (each already wired before the hoist);
  // only one modal is open at a time so the duplication is harmless.
  const [createOpen, setCreateOpen] = useState(false);
  // PR #4: layout-level AddRemotePrincipalModal so the sidebar's
  // "Connect" button can open it. Modal mutates the
  // remote-principals JSON table on the desktop; the sidebar
  // re-renders through React Query's invalidation hook.
  const [connectOpen, setConnectOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // PR #6: ephemeral toast surface for deep-link errors. Cleared
  // after 5s so a one-off mistyped URL doesn't leave a banner up
  // forever.
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  useEffect(() => {
    setThemeState(getTheme());
    applyTheme();
  }, []);

  // PR #6: install deep-link handler at layout mount. The unlisten
  // runs at unmount so navigation away from the layout doesn't
  // leak listeners. Also subscribe to the success/error events so
  // a fresh deep-link auto-navigates to the new principal's chat
  // and surfaces failures as a transient toast.
  useEffect(() => {
    let unlistenHandled: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const unlisten = await installDeepLinkHandler();
        if (cancelled) {
          unlisten();
          return;
        }
        // The `installDeepLinkHandler` already wired the live path;
        // here we add the success/error event subscriptions.
        const { listen } = await import("@tauri-apps/api/event");
        unlistenHandled = await listen<{
          kind: string;
          shareUrl: string;
        }>("deep-link-handled", () => {
          // Invalidate the remote-principal query so the sidebar
          // picks up the new row immediately, then navigate to
          // the chat. The principal_name is not in the event
          // payload (just the shareUrl); we re-parse it here so
          // the router can target the right page.
          void qc.invalidateQueries({ queryKey: ["remote-principals"] });
        });
        unlistenError = await listen<string>("deep-link-error", (event) => {
          setDeepLinkError(event.payload);
          window.setTimeout(() => setDeepLinkError(null), 5_000);
        });
      } catch (e) {
        // Plugin not registered (dev / non-desktop). Silently
        // ignore — the user will see the modal's manual paste
        // path as a fallback.
        if (!cancelled) {
          console.warn("[peko-desktop] deep-link install failed:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      unlistenHandled?.();
      unlistenError?.();
    };
  }, [qc, navigate]);

  useEffect(() => {
    setThemeState(getTheme());
    applyTheme();
  }, []);

  function cycleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setThemeState(next);
    setTheme(next);
  }

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const engineFailed = engine?.kind === "failed";

  const isChatRoute =
    location.pathname === "/" || location.pathname === "/chat" || location.pathname.startsWith("/chat/");

  const isChannelsRoute =
    location.pathname === "/channels" ||
    location.pathname.startsWith("/channels/");

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-white dark:bg-slate-950">
      {/* Custom title bar */}
      <TitleBar />

      {/* PR #6: deep-link error toast. Sits at z-50 above the
          title bar so a failed share-link import gets seen even
          on first-run flows. Auto-clears via the 5s timeout in
          the listener. */}
      {deepLinkError && (
        <div className="fixed right-4 top-12 z-50 max-w-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-lg dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {deepLinkError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Far left: app rail (always visible) */}
        <AppRail />

        {/* Context sidebar: principal list on chat routes,
            channel list on channels routes, tools elsewhere.
            Order matches `AppRail` icon order (Direct Messages,
            Channels, Tools). */}
        {isChatRoute ? (
          <PrincipalSidebar
            onCreateClick={() => setCreateOpen(true)}
            onConnectClick={() => setConnectOpen(true)}
          />
        ) : isChannelsRoute ? (
          <ChannelSidebar />
        ) : (
          <Sidebar />
        )}

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-3">
              {!isChatRoute && (
                <h1 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  Peko
                </h1>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={cycleTheme}
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title={`Theme: ${theme}`}
              >
                <ThemeIcon className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Content */}
          <main className={["flex-1 overflow-hidden", isChatRoute ? "" : "overflow-auto p-6"].join(" ")}>
            {/* Engine failure card. Only renders on Failed. On every
                other state (Stopped, Starting, Restarting, Running)
                the engine is invisible in the chrome — the user only
                needs to think about it when something needs action. */}
            {engineFailed && engine && (
              <div className="px-6 pb-3 pt-4">
                <EngineFailureCard
                  message={engine.message}
                />
              </div>
            )}

            {/* Version mismatch is full-width, above the page content
                so it stays visible even on chat routes where there's
                no padding scroll area. */}
            {mismatch && (
              <div className="px-6 pb-3 pt-4">
                <VersionMismatchBanner
                  actual={mismatch.actual}
                  expected={mismatch.expected}
                  onDismiss={dismiss}
                />
              </div>
            )}
            {children}
          </main>

          {/* Status bar — renders only on Failed (matches the
              layout-level failure card) so the happy path has no
              engine chrome at all. */}
          {engineFailed && <StatusBar />}
        </div>
      </div>

      {/* T-105: layout-level CreatePrincipalModal so the sidebar's
          empty-state CTA can open it. Chat and Dashboard keep their
          own local instances; only one is open at a time. */}
      <CreatePrincipalModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <AddRemotePrincipalModal open={connectOpen} onClose={() => setConnectOpen(false)} />

      {/* T-105: first-run walkthrough. Auto-appears when there are
          zero principals and the dismiss flag is unset. Renders its
          own `fixed inset-0 z-50` overlay when active, so it sits
          above everything else in the layout. */}
      <FirstRunWalkthrough />
    </div>
  );
}