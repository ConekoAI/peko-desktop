import { useEffect, type RefObject } from "react";

/**
 * P1.5 modal a11y hook. Closes the modal when the user presses
 * Escape and traps Tab focus inside the container while it's open.
 *
 *  - Escape: calls `onClose()`.
 *  - Tab / Shift+Tab: cycles focus among focusable descendants so
 *    keyboard users can't tab out into the page chrome behind the
 *    modal.
 *  - Focus is moved into the container on open (the first
 *    focusable descendant wins) and restored to the previously
 *    focused element on close, so the screen-reader / keyboard
 *    flow returns to wherever the user was.
 *
 * Convention mirrors — every modal in the app (channel create /
 * invite / leave / confirm) mounts the hook against its outer
 * `<div className="fixed inset-0 ...">` container. Keeping this in
 * one place avoids the per-modal boilerplate that P1.5 was
 * originally going to copy three times.
 */
export function useModalA11y(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember the previously focused element so we can restore it
    // when the modal closes. Restoring matters because modals are
    // typically opened from a header button — sending focus back to
    // that button means keyboard users don't lose their place.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(", ");

    function getFocusable(): HTMLElement[] {
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    }

    // Move initial focus into the modal. Prefer the first focusable
    // element so screen-reader users land on the modal title region
    // (the modal already declares its own aria role via the modal
    // heading). If nothing is focusable, focus the container itself
    // so screen readers still announce the modal.
    const initialFocus = getFocusable()[0] ?? container;
    initialFocus.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing focusable inside — keep focus on the container.
        e.preventDefault();
        container?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !container?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container?.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Restore focus to whatever was focused before the modal
      // opened. Falls back gracefully if that element is gone (e.g.
      // unmounted).
      previouslyFocused?.focus?.();
    };
    // `containerRef.current` is a stable ref so we don't need to
    // include it in deps. `onClose` is intentionally captured at
    // mount — modals are short-lived and stale-closure bugs here
    // are far less likely than stale-closure bugs from re-creating
    // the listener every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}