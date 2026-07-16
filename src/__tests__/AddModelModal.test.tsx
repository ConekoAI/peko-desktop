import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mutable signals: the modal reads templates via `useModelTemplates`
// and invokes `useAddModel().mutate` on submit. Capturing the last
// mutate call lets each test assert exactly what the modal would have
// sent over IPC.
const templatesSignal: {
  value: Array<{
    id: string;
    displayName: string;
    apiType: string;
    baseUrl: string;
    requiresKey: boolean;
    defaultModel: string;
    models: Array<{
      id: string;
      displayName?: string;
      contextLength?: number;
      maxOutputTokens?: number;
    }>;
  }>;
  loading: boolean;
} = { value: [], loading: false };

const mutateMock = vi.fn();

vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: [], isLoading: false }),
  useModelTemplates: () => ({
    data: templatesSignal.value,
    isLoading: templatesSignal.loading,
  }),
  useAddModel: () => ({
    mutate: mutateMock,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("../hooks/useSettings", () => ({
  useGenericCredentialList: () => ({
    data: [],
    isLoading: false,
  }),
}));

import AddModelModal from "../components/modals/AddModelModal";
import type { ModelAddArgs } from "../types";

function renderModal(
  props: Partial<{
    open: boolean;
    onClose: () => void;
    onSuccess: (id: string) => void;
  }> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AddModelModal open={props.open ?? true} onClose={onClose} onSuccess={onSuccess} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onSuccess };
}

function setInput(testid: string, value: string) {
  const input = screen.getByTestId(testid);
  fireEvent.change(input, { target: { value } });
}

function clickCheckbox(label: RegExp) {
  fireEvent.click(screen.getByRole("checkbox", { name: label }));
}

describe("AddModelModal", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    templatesSignal.value = [
      {
        id: "anthropic",
        displayName: "Anthropic",
        apiType: "anthropic",
        baseUrl: "https://api.anthropic.com",
        requiresKey: true,
        defaultModel: "claude-opus-4-7",
        models: [
          { id: "claude-opus-4-7", contextLength: 200_000, maxOutputTokens: 8_192 },
          { id: "claude-sonnet-4-6", contextLength: 200_000, maxOutputTokens: 8_192 },
        ],
      },
      {
        id: "openai",
        displayName: "OpenAI",
        apiType: "openai",
        baseUrl: "https://api.openai.com/v1",
        requiresKey: true,
        defaultModel: "gpt-5",
        models: [{ id: "gpt-5", contextLength: 400_000 }],
      },
      {
        id: "ollama",
        displayName: "Ollama (local)",
        apiType: "openai",
        baseUrl: "http://localhost:11434/v1",
        requiresKey: false,
        defaultModel: "llama-3.1",
        models: [{ id: "llama-3.1" }],
      },
    ];
    templatesSignal.loading = false;
  });

  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByText("Add a Model")).toBeNull();
  });

  it("renders the preset list with api type + key badges", () => {
    renderModal();
    expect(screen.getByText("Add a Model")).toBeInTheDocument();
    expect(screen.getByTestId("add-model-template-anthropic")).toBeInTheDocument();
    expect(screen.getByTestId("add-model-template-openai")).toBeInTheDocument();
    expect(screen.getByTestId("add-model-template-ollama")).toBeInTheDocument();
  });

  it("Add is disabled with no template selected", () => {
    renderModal();
    expect(screen.getByTestId("add-model-submit")).toBeDisabled();
  });

  it("selecting a preset + entering key + clicking Add calls mutate with the template contract", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-template-anthropic"));
    setInput("add-model-api-key", "sk-test-key");
    const submit = screen.getByTestId("add-model-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [args] = mutateMock.mock.calls[0] as [ModelAddArgs];
    expect(args.template).toBe("anthropic");
    expect(args.custom).toBe(false);
    expect(args.key).toBe("sk-test-key");
    expect(args.model).toEqual(["claude-opus-4-7"]);
    expect(args.name).toBeUndefined();
  });

  it("name override flow through to mutate", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-template-anthropic"));
    setInput("add-model-name-override", "my-anthropic");
    setInput("add-model-api-key", "sk-test-key");
    fireEvent.click(screen.getByTestId("add-model-submit"));
    const [args] = mutateMock.mock.calls[0] as [ModelAddArgs];
    expect(args.template).toBe("anthropic");
    expect(args.name).toBe("my-anthropic");
  });

  it("ollama preset (no key) hides the apiKey input and submits without a key", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-template-ollama"));
    expect(screen.queryByTestId("add-model-api-key")).toBeNull();
    const submit = screen.getByTestId("add-model-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    const [args] = mutateMock.mock.calls[0] as [ModelAddArgs];
    expect(args.template).toBe("ollama");
    expect(args.key).toBeUndefined();
  });

  it("switching to custom mode hides the template list and shows the form", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-mode-custom"));
    expect(screen.queryByTestId("add-model-template-list")).toBeNull();
    expect(screen.getByTestId("add-model-custom-id")).toBeInTheDocument();
    expect(screen.getByTestId("add-model-custom-base-url")).toBeInTheDocument();
    expect(screen.getByTestId("add-model-custom-model-id")).toBeInTheDocument();
    // Submit disabled until required fields are filled.
    expect(screen.getByTestId("add-model-submit")).toBeDisabled();
  });

  it("custom submission sends the full payload via mutate", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-mode-custom"));
    setInput("add-model-custom-id", "my-llama");
    setInput("add-model-custom-display-name", "My Llama");
    setInput("add-model-custom-base-url", "https://api.example.com/v1");
    setInput("add-model-custom-model-id", "llama-3.1-70b");
    clickCheckbox(/requires api key/i); // uncheck so no key is required
    const submit = screen.getByTestId("add-model-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    const [args] = mutateMock.mock.calls[0] as [ModelAddArgs];
    expect(args.custom).toBe(true);
    expect(args.name).toBe("my-llama");
    expect(args.displayName).toBe("My Llama");
    expect(args.apiFormat).toBe("openai_completions");
    expect(args.baseUrl).toBe("https://api.example.com/v1");
    expect(args.model).toEqual(["llama-3.1-70b"]);
    expect(args.requiresKey).toBe(false);
    expect(args.key).toBeUndefined();
  });

  it("custom + requiresKey + apiKey routes the key through mutate", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-mode-custom"));
    setInput("add-model-custom-id", "my-llama");
    setInput("add-model-custom-base-url", "https://api.example.com/v1");
    setInput("add-model-custom-model-id", "llama-3.1-70b");
    setInput("add-model-custom-api-key", "sk-llama-123");
    fireEvent.click(screen.getByTestId("add-model-submit"));
    const [args] = mutateMock.mock.calls[0] as [ModelAddArgs];
    expect(args.key).toBe("sk-llama-123");
  });

  it("custom form invalid id characters keep the submit disabled", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-mode-custom"));
    setInput("add-model-custom-id", "bad name with spaces");
    setInput("add-model-custom-base-url", "https://api.example.com/v1");
    setInput("add-model-custom-model-id", "llama-3.1-70b");
    expect(screen.getByTestId("add-model-submit")).toBeDisabled();
  });

  it("close button invokes onClose and does not call mutate", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByTestId("add-model-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("template name override with illegal characters keeps submit disabled", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("add-model-template-anthropic"));
    setInput("add-model-name-override", "bad name");
    setInput("add-model-api-key", "sk-test-key");
    expect(screen.getByTestId("add-model-submit")).toBeDisabled();
  });

  it("reopening resets the template selection", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <AddModelModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId("add-model-template-anthropic"));
    setInput("add-model-api-key", "sk-test-key");
    expect(screen.getByTestId("add-model-submit")).not.toBeDisabled();
    // Close + reopen: should reset back to "no selection".
    rerender(
      <QueryClientProvider client={qc}>
        <AddModelModal open={false} onClose={vi.fn()} onSuccess={vi.fn()} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={qc}>
        <AddModelModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("add-model-submit")).toBeDisabled();
  });
});
