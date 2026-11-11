// src/lib/model-spec.ts
//
// Helpers for rendering ModelSpec capability badges on the desktop
// (PR 4 / feature/model-first-config). The runtime emits the spec
// as snake_case nested objects; this module resolves the effective
// spec (with the text-only default fallback) and produces a
// canonical ordered list of badges for the gallery card and the
// pickers.

import {
  MODEL_SPEC_DEFAULT,
  type ModelPricingHint,
  type ModelSpec,
  type ModelThinkingMode,
  type ModelToolSupport,
} from "../types";
import { t } from "../i18n";

// Re-export the canonical helper so consumers can import from a
// single place.
export { MODEL_SPEC_DEFAULT, resolveSpec } from "../types";

export type SpecBadgeKind =
  | "vision"
  | "audio"
  | "video"
  | "tools"
  | "thinking"
  | "json"
  | "pricing";

export interface SpecBadge {
  kind: SpecBadgeKind;
  label: string;
  testId: string;
}

/**
 * Ordered list of badges to render for a given spec. The order is
 * stable across surfaces (gallery card, picker preview, walkthrough)
 * so the layout is predictable.
 */
export function specBadgeList(spec: ModelSpec): SpecBadge[] {
  const badges: SpecBadge[] = [];
  if (spec.image_input) {
    badges.push({
      kind: "vision",
      label: t("models.badge.vision"),
      testId: "model-card-spec-vision",
    });
  }
  if (spec.audio_input) {
    badges.push({
      kind: "audio",
      label: t("models.badge.audio"),
      testId: "model-card-spec-audio",
    });
  }
  if (spec.video_input) {
    badges.push({
      kind: "video",
      label: t("models.badge.video"),
      testId: "model-card-spec-video",
    });
  }
  const tools = toolsBadge(spec.tool_support);
  if (tools) badges.push(tools);
  const thinking = thinkingBadge(spec.thinking);
  if (thinking) badges.push(thinking);
  if (spec.json_mode) {
    badges.push({
      kind: "json",
      label: t("models.badge.json"),
      testId: "model-card-spec-json",
    });
  }
  const pricing = pricingBadge(spec.pricing);
  if (pricing) badges.push(pricing);
  return badges;
}

function toolsBadge(support: ModelToolSupport): SpecBadge | null {
  if (support === "none") return null;
  return {
    kind: "tools",
    label: support === "full" ? t("models.badge.fullTools") : t("models.badge.tools"),
    testId: "model-card-spec-tools",
  };
}

function thinkingBadge(mode: ModelThinkingMode): SpecBadge | null {
  if (mode === "disabled") return null;
  const label =
    mode === "required"
      ? t("models.badge.thinkingRequired")
      : mode === "custom_budget"
        ? t("models.badge.thinkingBudget")
        : t("models.badge.thinking");
  return {
    kind: "thinking",
    label,
    testId: "model-card-spec-thinking",
  };
}

function pricingBadge(pricing: ModelPricingHint | undefined): SpecBadge | null {
  if (!pricing) return null;
  const inP = pricing.input_per_million;
  const outP = pricing.output_per_million;
  if (inP == null && outP == null) return null;
  const label = t("models.badge.pricing", { input: formatUsd(inP), output: formatUsd(outP) });
  return {
    kind: "pricing",
    label,
    testId: "model-card-spec-pricing",
  };
}

function formatUsd(value: number | undefined): string {
  if (value == null) return "—";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

// Default-reference helper for tests that want to assert the
// text-only fallback. Exposed here so the test file doesn't have to
// import from `src/types/index.ts` directly.
export const DEFAULT_SPEC = MODEL_SPEC_DEFAULT;

/** Which media a model takes besides text (runtime ADR-088). */
export interface ModelInputs {
  image: boolean;
  audio: boolean;
  video: boolean;
}

export const NO_MEDIA: ModelInputs = { image: false, audio: false, video: false };

export function inputsOf(spec: ModelSpec | null | undefined): ModelInputs {
  return {
    image: !!spec?.image_input,
    audio: !!spec?.audio_input,
    video: !!spec?.video_input,
  };
}

/**
 * `spec` with its media inputs replaced. A model with no descriptor
 * gets one that keeps tools and thinking available: the engine refuses
 * tools to a model whose descriptor says it has none, and a peko needs
 * its tools.
 */
export function withInputs(spec: ModelSpec | null | undefined, inputs: ModelInputs): ModelSpec {
  return {
    ...baseSpec(spec),
    image_input: inputs.image,
    audio_input: inputs.audio,
    video_input: inputs.video,
  };
}

/**
 * `spec` with its price replaced (`undefined` removes it). A model with
 * no descriptor gets one that keeps tools and thinking on.
 */
export function withPricing(
  spec: ModelSpec | null | undefined,
  pricing: ModelPricingHint | undefined,
): ModelSpec {
  const next: ModelSpec = { ...baseSpec(spec) };
  if (pricing) next.pricing = pricing;
  else delete next.pricing;
  return next;
}

/** A descriptor to edit: the model's own, or one that keeps tools on. */
function baseSpec(spec: ModelSpec | null | undefined): ModelSpec {
  return (
    spec ?? {
      ...MODEL_SPEC_DEFAULT,
      tool_support: "function_calling",
      thinking: "optional",
    }
  );
}

/** Text fields for a price, as typed. */
export interface PriceDraft {
  input: string;
  output: string;
  /** Input read from the prompt cache; empty = the input price. */
  cacheRead: string;
  /** Input written to the prompt cache; empty = the input price. */
  cacheWrite: string;
}

/** A draft with every field empty. */
export const EMPTY_PRICE_DRAFT: PriceDraft = { input: "", output: "", cacheRead: "", cacheWrite: "" };

const PRICE_FIELDS = {
  input: "input_per_million",
  output: "output_per_million",
  cacheRead: "cache_read_per_million",
  cacheWrite: "cache_write_per_million",
} as const satisfies Record<keyof PriceDraft, keyof ModelPricingHint>;

const PRICE_KEYS = Object.keys(PRICE_FIELDS) as (keyof PriceDraft)[];

export function priceDraftOf(spec: ModelSpec | null | undefined): PriceDraft {
  const p = spec?.pricing;
  const draft = {} as PriceDraft;
  for (const key of PRICE_KEYS) {
    const v = p?.[PRICE_FIELDS[key]];
    draft[key] = v != null ? String(v) : "";
  }
  return draft;
}

/** Whether two drafts describe a different price, ignoring stray whitespace. */
export function priceDraftChanged(before: PriceDraft, after: PriceDraft): boolean {
  return PRICE_KEYS.some((key) => before[key].trim() !== after[key].trim());
}

/**
 * The price a draft describes: `undefined` when every field is empty,
 * `null` when a field is not a non-negative number.
 */
export function pricingFromDraft(draft: PriceDraft): ModelPricingHint | undefined | null {
  const read = (raw: string): number | undefined | null => {
    const t = raw.trim().replace(/^\$/, "");
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const pricing: ModelPricingHint = {};
  for (const key of PRICE_KEYS) {
    const n = read(draft[key]);
    if (n === null) return null;
    if (n !== undefined) pricing[PRICE_FIELDS[key]] = n;
  }
  return Object.keys(pricing).length === 0 ? undefined : pricing;
}
