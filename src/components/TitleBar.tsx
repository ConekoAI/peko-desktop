import { useState, useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Maximize2 } from "lucide-react";

/**
 * macOS draws its own window buttons over the top-left of the page
 * (`titleBarStyle: Overlay`, `tauri.macos.conf.json`); elsewhere the
 * window has no decorations and this bar draws them.
 */
export const IS_MAC = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);

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
      className="flex h-9 shrink-0 select-none items-center justify-between border-b border-line bg-slate-100/80 backdrop-blur dark:bg-slate-900/80"
    >
      {/* Left: app branding. On macOS the window buttons sit here and
          the bar stays empty, like other Mac apps. */}
      {!IS_MAC && (
        <div className="flex items-center gap-2 px-3">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-brand">
            <span className="text-[10px] font-bold text-white">P</span>
          </div>
          <span className="text-xs font-semibold text-fg-muted">Peko</span>
        </div>
      )}

      {/* Center — empty, draggable */}
      <div className="flex-1" />

      {/* Right: window controls (macOS has its own) */}
      {!IS_MAC && (
        <div className="flex items-center">
          <button
            onClick={handleMinimize}
            className="flex h-9 w-9 items-center justify-center text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg-soft"
            title="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex h-9 w-9 items-center justify-center text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg-soft"
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
            className="flex h-9 w-9 items-center justify-center text-fg-muted transition-colors hover:bg-red-500 hover:text-white dark:hover:bg-red-500 dark:hover:text-white"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
