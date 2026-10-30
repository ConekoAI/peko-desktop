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
  const base: ModelSpec = spec ?? {
    ...MODEL_SPEC_DEFAULT,
    tool_support: "function_calling",
    thinking: "optional",
  };
  return {
    ...base,
    image_input: inputs.image,
    audio_input: inputs.audio,
    video_input: inputs.video,
  };
}
