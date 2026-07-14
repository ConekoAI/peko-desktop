import { useState, useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import Sidebar from "./Sidebar";
import AppRail from "./AppRail";
import PrincipalSidebar from "./PrincipalSidebar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";
import EngineFailureCard from "./EngineFailureCard";
import VersionMismatchBanner from "./VersionMismatchBanner";
import CreatePrincipalModal from "./modals/CreatePrincipalModal";
import { useEngineStatus } from "../hooks/useEngine";
import { useEngineVersionMismatch } from "../hooks/useEngine";
import { getTheme, setTheme, applyTheme } from "../lib/theme";
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
  const location = useLocation();

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-white dark:bg-slate-950">
      {/* Custom title bar */}
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Far left: app rail (always visible) */}
        <AppRail />

        {/* Context sidebar: principal list on chat routes, tools elsewhere */}
        {isChatRoute ? (
          <PrincipalSidebar onCreateClick={() => setCreateOpen(true)} />
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
    </div>
  );
}