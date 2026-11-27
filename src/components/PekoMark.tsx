/**
 * The Peko mark (a sprout: a small leaf in front of a large one), drawn with
 * no tile behind it, as the app icon and PekoHub draw it. Light: lime behind
 * teal. Dark: teal behind white.
 */
export default function PekoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="14.67 17.29 65.02 72.56"
      className={className}
      aria-hidden
    >
      <path
        className="fill-[#b7dd6b] stroke-[#b7dd6b] dark:fill-[#4eb8af] dark:stroke-[#4eb8af]"
        transform="translate(50 88) rotate(-110)"
        d="M0 0 Q22.2 46 74 0 Q22.2 -46 0 0 Z"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        className="fill-[#008880] stroke-[#008880] dark:fill-white dark:stroke-white"
        transform="translate(50 88) rotate(-58)"
        d="M0 0 Q15 32 50 0 Q15 -32 0 0 Z"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
