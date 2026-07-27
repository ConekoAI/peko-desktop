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
        apiFormat: "openai",
        modelId: "gpt-4o",
        baseUrl: "https://api.openai.com",
        requiresKey: true,
        isLocal: false,
        enabled: true,
        headers: {},
      },
      {
        id: "anthropic",
        displayName: "Anthropic",
        apiFormat: "anthropic",
        modelId: "claude-sonnet-4-6",
        baseUrl: "https://api.anthropic.com",
        requiresKey: true,
        isLocal: false,
        enabled: true,
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

describe("CreatePrincipalModal name validation (path-traversal defense)", () => {
  beforeEach(() => {
    createMut.mockReset();
    resetMut.mockReset();
    modelsSignal.value = [
      {
        id: "openai",
        displayName: "OpenAI",
        apiFormat: "openai",
        modelId: "gpt-4o",
        baseUrl: "https://api.openai.com",
        requiresKey: true,
        isLocal: false,
        enabled: true,
        headers: {},
      },
    ];
  });

  it.each([
    "..", // double-dot (path traversal)
    ".", // single dot
    "../escape", // embedded traversal
    "foo..bar", // embedded double-dot segment
    "-leading-hyphen",
    "trailing-hyphen-",
    "has/slash",
  ])(
    "disables Create button and surfaces hint when name is %s",
    (badName) => {
      renderModal();
      const nameInput = screen.getByLabelText(/name/i);
      fireEvent.change(nameInput, { target: { value: badName } });
      fireEvent.change(screen.getByLabelText(/model/i), {
        target: { value: "openai" },
      });
      const createBtn = screen.getByRole("button", { name: /create/i });
      expect(createBtn).toBeDisabled();
      expect(
        screen.getByText(/leading\/trailing hyphen|path separators|\.\./i),
      ).toBeInTheDocument();
      // And the mutation must not be invoked even if the disabled
      // attribute is bypassed (e.g. via direct click in older
      // testing-library versions that ignored `disabled`).
      fireEvent.click(createBtn);
      expect(createMut).not.toHaveBeenCalled();
    },
  );
});
