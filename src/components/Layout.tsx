import { useState, useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import Sidebar from "./Sidebar";
import AppRail from "./AppRail";
import PrincipalSidebar from "./PrincipalSidebar";
import StatusBar from "./StatusBar";
import TitleBar from "./TitleBar";
import EngineStatusBadge from "./EngineStatusBadge";
import VersionMismatchBanner from "./VersionMismatchBanner";
import { useEngineStatus } from "../hooks/useEngine";
import { useEngineVersionMismatch } from "../hooks/useEngine";
import { getTheme, setTheme, applyTheme } from "../lib/theme";
import { Sun, Moon, Monitor } from "lucide-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  // Engine state drives the header badge. The supervisor is the
  // canonical owner of the engine (ADR-043) — the legacy DaemonStatus
  // hook is gone from the header surface.
  const { data: engine } = useEngineStatus();
  const { mismatch, dismiss } = useEngineVersionMismatch();
  const [theme, setThemeState] = useState<"light" | "dark" | "system">("system");
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
        {isChatRoute ? <PrincipalSidebar /> : <Sidebar />}

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
              <EngineStatusBadge state={engine} />
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

          {/* Status bar */}
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
