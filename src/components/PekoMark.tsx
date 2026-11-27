/**
 * The Peko mark (a sprout: a small leaf in front of a large one), drawn with
 * no tile behind it: a lime back leaf, and a front leaf teal in the light
 * theme and white in the dark one, as the app icon and PekoHub draw it.
 */
export default function PekoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="14.67 17.29 65.02 72.56"
      className={`text-[#008880] dark:text-white ${className ?? ""}`}
      aria-hidden
    >
      <path
        transform="translate(50 88) rotate(-110)"
        d="M0 0 Q22.2 46 74 0 Q22.2 -46 0 0 Z"
        fill="#b7dd6b"
        stroke="#b7dd6b"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        transform="translate(50 88) rotate(-58)"
        d="M0 0 Q15 32 50 0 Q15 -32 0 0 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
