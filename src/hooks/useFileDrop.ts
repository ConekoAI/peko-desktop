import { useEffect, useState } from "react";

/**
 * Files dragged onto the window. `onDrop` receives their paths;
 * `dragging` is true while files hover over the window. Inactive when
 * `enabled` is false, and outside the desktop app (tests, a browser).
 */
export function useFileDrop(enabled: boolean, onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setDragging(true);
          } else if (payload.type === "drop") {
            setDragging(false);
            if (payload.paths.length > 0) onDrop(payload.paths);
          } else {
            setDragging(false);
          }
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // Not running inside the desktop app.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
    // `onDrop` is read at drop time; re-subscribing on every render
    // would drop events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return dragging;
}
