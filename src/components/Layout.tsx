import Sidebar from "./Sidebar";
import StatusBar from "./StatusBar";
import { useDaemonStatus } from "../hooks/useDaemon";
import { getTheme, setTheme, applyTheme } from "../lib/theme";
import { Sun, Moon, Monitor } from "lucide-react";
import { useState, useEffect } from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { data: daemon } = useDaemonStatus();
  const [theme, setThemeState] = useState<"light" | "dark" | "system">("system");

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

  return (
    <div className="flex h-screen w-screen flex-col bg-white dark:bg-slate-950">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                Peko Desktop
              </h1>
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  daemon?.running
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                    : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
                ].join(" ")}
              >
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    daemon?.running ? "bg-emerald-500" : "bg-red-500",
                  ].join(" ")}
                />
                {daemon?.running ? "Running" : "Stopped"}
              </span>
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
          <main className="flex-1 overflow-auto p-6">{children}</main>

          {/* Status bar */}
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
