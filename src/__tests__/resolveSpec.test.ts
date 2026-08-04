// src/__tests__/resolveSpec.test.ts
//
// Direct unit tests for the spec fallback helper (PR 4 /
// feature/model-first-config). The helper is the single source of
// truth for "what does a model with no spec render like?" — every
// UI surface (gallery card, picker preview, walkthrough) routes
// through it so a single null check handles pre-PR-1 catalog
// entries everywhere.

import { describe, it, expect } from "vitest";

import {
  MODEL_SPEC_DEFAULT,
  resolveSpec,
  type ModelSpec,
} from "../types";
import { specBadgeList } from "../lib/model-spec";

describe("resolveSpec", () => {
  it("returns MODEL_SPEC_DEFAULT when spec is undefined", () => {
    expect(resolveSpec({})).toEqual(MODEL_SPEC_DEFAULT);
  });

  it("returns MODEL_SPEC_DEFAULT when spec is null", () => {
    expect(resolveSpec({ spec: null })).toEqual(MODEL_SPEC_DEFAULT);
  });

  it("returns the row's spec when present", () => {
    const spec: ModelSpec = {
      image_input: true,
      audio_input: false,
      tool_support: "function_calling",
      streaming: true,
      thinking: "optional",
      json_mode: true,
      pricing: { input_per_million: 2.5, output_per_million: 10 },
    };
    expect(resolveSpec({ spec })).toEqual(spec);
  });

  it("MODEL_SPEC_DEFAULT matches the runtime's text-only baseline", () => {
    expect(MODEL_SPEC_DEFAULT).toEqual({
      image_input: false,
      audio_input: false,
      tool_support: "none",
      streaming: true,
      thinking: "disabled",
      json_mode: false,
    });
  });
});

describe("specBadgeList", () => {
  it("emits no badges for the text-only default", () => {
    expect(specBadgeList(MODEL_SPEC_DEFAULT)).toEqual([]);
  });

  it("emits vision badge only when image_input is true", () => {
    const spec: ModelSpec = {
      ...MODEL_SPEC_DEFAULT,
      image_input: true,
    };
    const badges = specBadgeList(spec);
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe("vision");
    expect(badges[0].testId).toBe("model-card-spec-vision");
  });

  it("distinguishes tools / full tools / thinking modes / pricing formats", () => {
    const spec: ModelSpec = {
      image_input: true,
      audio_input: true,
      tool_support: "full",
      streaming: true,
      thinking: "required",
      json_mode: true,
      pricing: { input_per_million: 2.5, output_per_million: 10 },
    };
    const badges = specBadgeList(spec);
    const kinds = badges.map((b) => b.kind);
    expect(kinds).toContain("vision");
    expect(kinds).toContain("audio");
    expect(kinds).toContain("tools");
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("json");
    expect(kinds).toContain("pricing");

    const toolsBadge = badges.find((b) => b.kind === "tools")!;
    expect(toolsBadge.label).toBe("Full tools");

    const thinkingBadge = badges.find((b) => b.kind === "thinking")!;
    expect(thinkingBadge.label).toBe("Thinking (required)");

    const pricingBadge = badges.find((b) => b.kind === "pricing")!;
    expect(pricingBadge.label).toMatch(/\$2\.50 in/);
    expect(pricingBadge.label).toMatch(/\$10\.00 out/);
  });

  it("skips the pricing badge when pricing is undefined", () => {
    const spec: ModelSpec = {
      ...MODEL_SPEC_DEFAULT,
      image_input: true,
    };
    expect(specBadgeList(spec).find((b) => b.kind === "pricing")).toBeUndefined();
  });

  it("skips tools badge when tool_support is 'none'", () => {
    const spec: ModelSpec = {
      ...MODEL_SPEC_DEFAULT,
      tool_support: "none",
    };
    expect(specBadgeList(spec).find((b) => b.kind === "tools")).toBeUndefined();
  });

  it("skips thinking badge when thinking is 'disabled'", () => {
    const spec: ModelSpec = {
      ...MODEL_SPEC_DEFAULT,
      thinking: "disabled",
    };
    expect(specBadgeList(spec).find((b) => b.kind === "thinking")).toBeUndefined();
  });
});
