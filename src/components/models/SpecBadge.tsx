// src/components/models/SpecBadge.tsx
//
// Compact capability chip used in the model gallery card and the
// model pickers (PR 4 / feature/model-first-config). The pill
// styling mirrors the existing apiType / Key / Local chips in
// AddModelModal — `rounded-md border ... text-[10px]` — so the
// visual language of the catalog stays consistent.

import type { SpecBadgeKind } from "../../lib/model-spec";

interface SpecBadgeProps {
  kind: SpecBadgeKind;
  label: string;
  testId: string;
}

const COLOR_TIERS: Record<SpecBadgeKind, string> = {
  vision:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300",
  audio:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300",
  video:
    "border-warn/25 bg-warn-soft text-warn",
  tools:
    "border-peko-500/25 bg-brand-soft text-brand-text",
  thinking:
    "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-300",
  json:
    "border-ok/25 bg-ok-soft text-ok",
  pricing:
    "border-line bg-surface-raised text-fg-soft",
};

export default function SpecBadge({ kind, label, testId }: SpecBadgeProps) {
  return (
    <span
      data-testid={testId}
      className={[
        "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        COLOR_TIERS[kind],
      ].join(" ")}
    >
      {label}
    </span>
  );
}
