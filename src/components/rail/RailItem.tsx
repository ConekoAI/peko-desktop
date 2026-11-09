import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * One icon in the far-left app rail (Chats, each group, Settings), in the
 * style chat apps share: a rounded tile that squares off when active or
 * hovered, a pill on the rail's edge marking where you are, and a label
 * that floats beside it on hover.
 */
export function RailItem({
  label,
  active = false,
  unread = false,
  badge,
  onClick,
  children,
  variant = "tile",
  testId,
  ariaCurrent,
  buttonRef,
}: {
  label: string;
  active?: boolean;
  /** Something new inside: a short pill on the edge. */
  unread?: boolean;
  /** A count on the tile's corner. */
  badge?: number;
  onClick?: () => void;
  children: ReactNode;
  /** `tile` for places (Chats, groups); `action` for buttons (+, join). */
  variant?: "tile" | "action";
  testId?: string;
  ariaCurrent?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const tip = useRailTooltip(label);
  const tile =
    variant === "action"
      ? [
          "rounded-[22px] border border-dashed border-line-strong text-fg-muted",
          "group-hover/rail:rounded-xl group-hover/rail:border-solid group-hover/rail:border-brand group-hover/rail:bg-brand group-hover/rail:text-white",
        ].join(" ")
      : active
        ? "rounded-xl bg-brand text-white shadow-sm"
        : "rounded-[22px] bg-surface-sunken text-fg-soft group-hover/rail:rounded-xl group-hover/rail:bg-brand group-hover/rail:text-white";
  return (
    <div className="group/rail relative flex w-full justify-center" {...tip.anchorProps}>
      <span
        aria-hidden
        className={[
          "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-all duration-200",
          active ? "h-8" : unread ? "h-2 group-hover/rail:h-5" : "h-0 group-hover/rail:h-5",
        ].join(" ")}
      />
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={ariaCurrent ? "page" : undefined}
        data-testid={testId}
        className={[
          "relative flex h-11 w-11 items-center justify-center text-sm font-semibold transition-all duration-200",
          tile,
        ].join(" ")}
      >
        {children}
        {!!badge && badge > 0 && (
          <span className="count-badge absolute -bottom-1 -right-1 ring-[3px] ring-surface-rail">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      {tip.node}
    </div>
  );
}

/** A thin rule between the rail's sections. */
export function RailDivider() {
  return <div aria-hidden className="mx-auto my-1 h-px w-8 shrink-0 rounded-full bg-line-strong" />;
}

/**
 * The floating label beside a rail item. Rendered into the body so the
 * rail's scrolling group list never clips it.
 */
function useRailTooltip(label: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top + r.height / 2, left: r.right + 6 });
  }, []);
  const hide = useCallback(() => setPos(null), []);
  return {
    anchorProps: {
      ref,
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onClick: hide,
    },
    node:
      pos &&
      createPortal(
        <div
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-[60] -translate-y-1/2 animate-fade-in whitespace-nowrap rounded-lg border border-line bg-surface-card px-2.5 py-1.5 text-[13px] font-semibold text-fg shadow-pop"
        >
          {label}
        </div>,
        document.body,
      ),
  };
}

/**
 * A panel that opens beside a rail item (an invitation, the join form).
 * Fixed to the anchor and rendered into the body so the rail never clips
 * it; closes on Escape or a click outside.
 */
export function RailPopover({
  anchor,
  onClose,
  children,
  className = "w-72",
  testId,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - height - 8));
    setPos({ top, left: r.right + 12 });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      data-testid={testId}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      className={`popover fixed z-[60] p-3 ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
