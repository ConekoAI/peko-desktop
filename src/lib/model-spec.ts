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
      label: "Vision",
      testId: "model-card-spec-vision",
    });
  }
  if (spec.audio_input) {
    badges.push({
      kind: "audio",
      label: "Audio",
      testId: "model-card-spec-audio",
    });
  }
  if (spec.video_input) {
    badges.push({
      kind: "video",
      label: "Video",
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
      label: "JSON",
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
    label: support === "full" ? "Full tools" : "Tools",
    testId: "model-card-spec-tools",
  };
}

function thinkingBadge(mode: ModelThinkingMode): SpecBadge | null {
  if (mode === "disabled") return null;
  const label =
    mode === "required"
      ? "Thinking (required)"
      : mode === "custom_budget"
        ? "Thinking (budget)"
        : "Thinking";
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
  const label = `${formatUsd(inP)} in / ${formatUsd(outP)} out`;
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
}

export function priceDraftOf(spec: ModelSpec | null | undefined): PriceDraft {
  const p = spec?.pricing;
  return {
    input: p?.input_per_million != null ? String(p.input_per_million) : "",
    output: p?.output_per_million != null ? String(p.output_per_million) : "",
  };
}

/**
 * The price a draft describes: `undefined` when both fields are empty,
 * `null` when a field is not a non-negative number.
 */
export function pricingFromDraft(draft: PriceDraft): ModelPricingHint | undefined | null {
  const read = (raw: string): number | undefined | null => {
    const t = raw.trim().replace(/^\$/, "");
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const input = read(draft.input);
  const output = read(draft.output);
  if (input === null || output === null) return null;
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input !== undefined && { input_per_million: input }),
    ...(output !== undefined && { output_per_million: output }),
  };
}
