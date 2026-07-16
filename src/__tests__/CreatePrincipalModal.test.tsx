import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ProviderInfo } from "../types";

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

const providersSignal: { value: ProviderInfo[] | undefined } = { value: undefined };

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({
    data: providersSignal.value,
    isLoading: false,
    isError: false,
  }),
}));

import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";

function renderModal() {
  return render(<CreatePrincipalModal open onClose={vi.fn()} />);
}

function providerFixture(overrides?: Partial<ProviderInfo>): ProviderInfo {
  return {
    id: "openai",
    displayName: "OpenAI",
    apiType: "openai",
    defaultModel: "gpt-4o",
    requiresKey: true,
    isLocal: false,
    baseUrl: "https://api.openai.com",
    enabled: true,
    models: [],
    headers: {},
    ...overrides,
  };
}

describe("CreatePrincipalModal model picker (RP7)", () => {
  beforeEach(() => {
    createMut.mockReset();
    resetMut.mockReset();
    providersSignal.value = [
      providerFixture({
        id: "openai",
        displayName: "OpenAI",
        models: [
          { id: "gpt-4o", displayName: "GPT-4o" },
          { id: "gpt-4o-mini" },
        ],
      }),
      providerFixture({
        id: "local",
        displayName: "Local",
        apiType: "ollama",
        models: [],
      }),
    ];
  });

  it("does not show a model dropdown until a provider is selected", () => {
    renderModal();
    expect(screen.queryByLabelText(/model/i)).toBeNull();
  });

  it("shows a model dropdown for the selected provider", () => {
    renderModal();
    fireEvent.click(screen.getByText("OpenAI"));
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
  });

  it("omits the model dropdown when the selected provider has no models", () => {
    renderModal();
    fireEvent.click(screen.getByText("Local"));
    expect(screen.queryByLabelText(/model/i)).toBeNull();
  });

  it("clears the selected model when the provider changes", () => {
    renderModal();
    fireEvent.click(screen.getByText("OpenAI"));
    fireEvent.change(screen.getByLabelText(/model/i), {
      target: { value: "gpt-4o-mini" },
    });

    fireEvent.click(screen.getByText("Local"));
    expect(screen.queryByLabelText(/model/i)).toBeNull();

    fireEvent.click(screen.getByText("OpenAI"));
    expect((screen.getByLabelText(/model/i) as HTMLSelectElement).value).toBe("");
  });

  it("submits preferredProviderId and preferredModelId when a model is chosen", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("alice"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByText("OpenAI"));
    fireEvent.change(screen.getByLabelText(/model/i), {
      target: { value: "gpt-4o-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(createMut).toHaveBeenCalledTimes(1);
    expect(createMut).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alice",
        preferredProviderId: "openai",
        preferredModelId: "gpt-4o-mini",
      }),
      expect.any(Object),
    );
  });

  it("submits without preferredModelId when the provider default is kept", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("alice"), {
      target: { value: "bob" },
    });
    fireEvent.click(screen.getByText("OpenAI"));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(createMut).toHaveBeenCalledTimes(1);
    expect(createMut).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bob",
        preferredProviderId: "openai",
        preferredModelId: undefined,
      }),
      expect.any(Object),
    );
  });

  it("submits without provider or model when none are selected", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("alice"), {
      target: { value: "carol" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(createMut).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "carol",
        preferredProviderId: undefined,
        preferredModelId: undefined,
      }),
      expect.any(Object),
    );
  });
});
