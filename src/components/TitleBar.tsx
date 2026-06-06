import { useState, useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { Minus, Square, X, Maximize2 } from "lucide-react";

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));

    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    await getCurrentWindow().minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }, []);

  const handleClose = useCallback(async () => {
    await getCurrentWindow().close();
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // Only left mouse button
    if (e.button !== 0) return;
    // Ignore if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    const win = getCurrentWindow();
    if (e.detail === 2) {
      // Double click → toggle maximize
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } else {
      // Single click → start dragging
      await win.startDragging();
    }
  }, []);

  return (
    <div
      onMouseDown={handleMouseDown}
      className="flex h-9 shrink-0 select-none items-center justify-between border-b border-slate-200 bg-slate-100/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80"
    >
      {/* Left: app branding */}
      <div className="flex items-center gap-2 px-3">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-600">
          <span className="text-[10px] font-bold text-white">P</span>
        </div>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
          Peko Desktop
        </span>
        {appVersion && (
          <span className="text-[10px] text-slate-400 dark:text-slate-600">
            v{appVersion}
          </span>
        )}
      </div>

      {/* Center — empty, draggable */}
      <div className="flex-1" />

      {/* Right: window controls */}
      <div className="flex items-center">
        <button
          onClick={handleMinimize}
          className="flex h-9 w-9 items-center justify-center text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          title="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-9 w-9 items-center justify-center text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Square className="h-3 w-3" />
          ) : (
            <Maximize2 className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="flex h-9 w-9 items-center justify-center text-slate-500 transition-colors hover:bg-red-500 hover:text-white dark:text-slate-400 dark:hover:bg-red-500 dark:hover:text-white"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
