import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const createMut = vi.fn();
const resetMut = vi.fn();

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipalCreate: () => ({
    mutate: createMut,
    isPending: false,
    error: null,
    reset: resetMut,
  }),
}));

const modelsSignal: { value: unknown } = { value: undefined };

vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    data: modelsSignal.value,
    isLoading: false,
    isError: false,
  }),
}));

import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreatePrincipalModal open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("CreatePrincipalModal model picker", () => {
  beforeEach(() => {
    createMut.mockReset();
    resetMut.mockReset();
    modelsSignal.value = [
      {
        id: "openai",
        displayName: "OpenAI",
        apiFormat: "openai_completions",
        modelId: "gpt-4o",
        baseUrl: "https://api.openai.com",
        requiresKey: true,
        isLocal: false,
        enabled: true,
        capabilities: ["tool_use", "vision"],
        headers: {},
      },
      {
        id: "anthropic",
        displayName: "Anthropic",
        apiFormat: "anthropic_messages",
        modelId: "claude-sonnet-4-6",
        baseUrl: "https://api.anthropic.com",
        requiresKey: true,
        isLocal: false,
        enabled: true,
        capabilities: ["tool_use"],
        headers: {},
      },
    ];
  });

  it("renders a model dropdown", () => {
    renderModal();
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
  });

  it("does not allow submission without a selected model", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(createMut).not.toHaveBeenCalled();
  });

  it("submits name, description, and modelId when a model is chosen", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Personal coding assistant" },
    });
    fireEvent.change(screen.getByLabelText(/model/i), {
      target: { value: "anthropic" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(createMut).toHaveBeenCalledTimes(1);
    expect(createMut).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alice",
        description: "Personal coding assistant",
        modelId: "anthropic",
      }),
      expect.any(Object),
    );
  });

  it("submits without description when empty", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText(/model/i), {
      target: { value: "openai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(createMut).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bob",
        description: undefined,
        modelId: "openai",
      }),
      expect.any(Object),
    );
  });

  it("shows a helper when no models are configured", () => {
    modelsSignal.value = [];
    renderModal();
    expect(screen.getByText(/No configured models yet/i)).toBeInTheDocument();
  });
});
