// src/__tests__/ModelGalleryCard.test.tsx
//
// PR 4 / feature/model-first-config: render the gallery card with
// each spec field set and assert the right test-id badges appear.
// Reuses the established `vi.mock` + `QueryClientProvider` pattern
// from AddModelModal.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const updateMutate = vi.fn();
const removeMutate = vi.fn();
const testMutate = vi.fn();

vi.mock("../hooks/useModels", () => ({
  useUpdateModel: () => ({ mutate: updateMutate, isPending: false }),
  useRemoveModel: () => ({ mutate: removeMutate, isPending: false }),
  useTestModel: () => ({ mutate: testMutate, isPending: false }),
}));

import ModelGalleryCard from "../components/models/ModelGalleryCard";
import type { ModelSpec, ModelSummary } from "../types";

function renderCard(model: ModelSummary) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ModelGalleryCard model={model} />
    </QueryClientProvider>,
  );
}

const baseModel: ModelSummary = {
  id: "anthropic-claude-opus-4-7",
  displayName: "Claude Opus 4.7",
  apiFormat: "anthropic",
  baseUrl: "https://api.anthropic.com",
  modelId: "claude-opus-4-7",
  requiresKey: true,
  isLocal: false,
  enabled: true,
  headers: {},
};

const fullSpec: ModelSpec = {
  image_input: true,
  audio_input: false,
  tool_support: "full",
  streaming: true,
  thinking: "required",
  json_mode: true,
  pricing: { input_per_million: 3, output_per_million: 15 },
};

describe("ModelGalleryCard", () => {
  beforeEach(() => {
    updateMutate.mockReset();
    removeMutate.mockReset();
    testMutate.mockReset();
  });

  it("renders the card root with the model id test id", () => {
    renderCard({ ...baseModel, spec: fullSpec });
    expect(
      screen.getByTestId("model-card-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
  });

  it("renders no spec badges when spec is undefined (pre-PR-1 entry)", () => {
    renderCard({ ...baseModel });
    expect(
      screen.queryByTestId("model-card-spec-vision-anthropic-claude-opus-4-7"),
    ).toBeNull();
    expect(
      screen.queryByTestId("model-card-spec-tools-anthropic-claude-opus-4-7"),
    ).toBeNull();
    expect(
      screen.queryByTestId("model-card-specs-anthropic-claude-opus-4-7"),
    ).toBeNull();
  });

  it("renders no spec badges when spec is null (treated as default)", () => {
    renderCard({ ...baseModel, spec: null });
    expect(
      screen.queryByTestId("model-card-spec-vision-anthropic-claude-opus-4-7"),
    ).toBeNull();
  });

  it("renders vision badge when image_input is true", () => {
    renderCard({
      ...baseModel,
      spec: { ...fullSpec, image_input: true, audio_input: false },
    });
    expect(
      screen.getByTestId("model-card-spec-vision-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("model-card-spec-audio-anthropic-claude-opus-4-7"),
    ).toBeNull();
  });

  it("renders tools badge with 'Full tools' label when tool_support is 'full'", () => {
    renderCard({
      ...baseModel,
      spec: { ...fullSpec, tool_support: "full" },
    });
    const badge = screen.getByTestId(
      "model-card-spec-tools-anthropic-claude-opus-4-7",
    );
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("Full tools");
  });

  it("renders tools badge with 'Tools' label when tool_support is 'function_calling'", () => {
    renderCard({
      ...baseModel,
      spec: { ...fullSpec, tool_support: "function_calling" },
    });
    const badge = screen.getByTestId(
      "model-card-spec-tools-anthropic-claude-opus-4-7",
    );
    expect(badge.textContent).toBe("Tools");
  });

  it("renders thinking badge with mode-appropriate label", () => {
    renderCard({
      ...baseModel,
      spec: { ...fullSpec, thinking: "required" },
    });
    const badge = screen.getByTestId(
      "model-card-spec-thinking-anthropic-claude-opus-4-7",
    );
    expect(badge.textContent).toBe("Thinking (required)");
  });

  it("renders pricing badge with formatted input/output", () => {
    renderCard({
      ...baseModel,
      spec: {
        ...fullSpec,
        pricing: { input_per_million: 2.5, output_per_million: 10 },
      },
    });
    const badge = screen.getByTestId(
      "model-card-spec-pricing-anthropic-claude-opus-4-7",
    );
    expect(badge.textContent).toMatch(/\$2\.50 in/);
    expect(badge.textContent).toMatch(/\$10\.00 out/);
  });

  it("renders json badge when json_mode is true", () => {
    renderCard({
      ...baseModel,
      spec: { ...fullSpec, json_mode: true },
    });
    expect(
      screen.getByTestId("model-card-spec-json-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
  });

  it("renders audio badge when audio_input is true", () => {
    renderCard({
      ...baseModel,
      spec: { ...fullSpec, image_input: false, audio_input: true },
    });
    expect(
      screen.getByTestId("model-card-spec-audio-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
  });

  it("renders all spec badges for a frontier profile", () => {
    renderCard({ ...baseModel, spec: fullSpec });
    expect(
      screen.getByTestId("model-card-spec-vision-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("model-card-spec-tools-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("model-card-spec-thinking-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("model-card-spec-json-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("model-card-spec-pricing-anthropic-claude-opus-4-7"),
    ).toBeInTheDocument();
  });

  it("renders Disabled pill when model.enabled is false", () => {
    renderCard({ ...baseModel, enabled: false });
    expect(
      screen.getByTestId(
        "model-card-status-disabled-anthropic-claude-opus-4-7",
      ),
    ).toBeInTheDocument();
  });

  it("renders No credential pill when requires key but no credentialId", () => {
    renderCard({ ...baseModel, requiresKey: true, credentialId: undefined });
    expect(screen.getByText(/No credential/)).toBeInTheDocument();
  });
});
