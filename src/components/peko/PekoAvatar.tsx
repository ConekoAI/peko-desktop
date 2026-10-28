import { accentStyle, type PekoIdentity } from "../../lib/pekoIdentity";

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-12 w-12 text-base",
} as const;

/**
 * A peko's face: its emoji or monogram if the owner chose one, else its
 * initials, on its accent colour. Decorative — the name beside it is the
 * accessible label.
 */
export default function PekoAvatar({
  peko,
  size = "md",
}: {
  peko: PekoIdentity;
  size?: keyof typeof SIZES;
}) {
  const emoji = peko.avatar && !/^[\p{L}\p{N}]{1,3}$/u.test(peko.avatar);
  return (
    <span
      aria-hidden="true"
      data-testid="peko-avatar"
      data-accent={peko.accent}
      style={accentStyle(peko.accent)}
      className={[
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
      ].join(" ")}
    >
      <span className={emoji ? "text-[1.35em] leading-none" : ""}>{peko.avatar ?? peko.initials}</span>
    </span>
  );
}
