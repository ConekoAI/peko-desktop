// Add Model is an endpoint form (ADR-068): base URL, API format, model
// id, and a key or stored credential — no vendor presets.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mutateMock = vi.fn();
const modelsState: { data: unknown[] } = { data: [] };
const credentialsState: { data: unknown[] } = { data: [] };

vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsState.data, isLoading: false }),
  useAddModel: () => ({ mutate: mutateMock, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock("../hooks/useSettings", () => ({
  useGenericCredentialList: () => ({ data: credentialsState.data, isLoading: false }),
}));

import AddModelModal from "../components/modals/AddModelModal";

function renderModal(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AddModelModal open={open} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

const field = (label: RegExp) => screen.getByLabelText(label);
const submit = () => screen.getByTestId("add-model-submit");

function fillMimo() {
  fireEvent.change(field(/base url/i), {
    target: { value: "https://token-plan-cn.xiaomimimo.com/v1" },
  });
  fireEvent.change(field(/model id/i), { target: { value: "mimo-v2.6-flash" } });
  fireEvent.change(field(/api key/i), { target: { value: " sk-mimo " } });
}

beforeEach(() => {
  mutateMock.mockReset();
  modelsState.data = [];
  credentialsState.data = [];
});

describe("AddModelModal", () => {
  it("renders nothing when closed", () => {
    const { container } = renderModal(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no vendor presets, only the endpoint form", () => {
    renderModal();
    expect(screen.queryByText(/preset/i)).toBeNull();
    expect(field(/base url/i)).toBeInTheDocument();
    expect(field(/api format/i)).toBeInTheDocument();
  });

  it("offers the three API formats the runtime has adapters for", () => {
    renderModal();
    const options = Array.from((field(/api format/i) as HTMLSelectElement).options).map((o) => [
      o.value,
      o.textContent,
    ]);
    expect(options).toEqual([
      ["openai", "OpenAI-compatible (Chat Completions)"],
      ["anthropic", "Anthropic-compatible (Messages)"],
      ["responses", "OpenAI Responses"],
    ]);
  });

  it("adds an OpenAI-compatible endpoint with its key", () => {
    renderModal();
    expect(submit()).toBeDisabled();
    fillMimo();
    fireEvent.click(submit());
    expect(mutateMock.mock.calls[0][0]).toEqual({
      custom: true,
      apiFormat: "openai",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      model: ["mimo-v2.6-flash"],
      requiresKey: true,
      key: "sk-mimo",
    });
  });

  it("sends the Responses format and an optional name", () => {
    renderModal();
    fillMimo();
    fireEvent.change(field(/api format/i), { target: { value: "responses" } });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(field(/name in peko/i), { target: { value: "mimo-fast" } });
    fireEvent.click(submit());
    expect(mutateMock.mock.calls[0][0]).toMatchObject({ apiFormat: "responses", name: "mimo-fast" });
  });

  it("needs a key unless the endpoint is keyless", () => {
    renderModal();
    fireEvent.change(field(/base url/i), { target: { value: "http://localhost:11434/v1" } });
    fireEvent.change(field(/model id/i), { target: { value: "llama3" } });
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /no key needed/i }));
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    fireEvent.click(submit());
    expect(mutateMock.mock.calls[0][0]).toEqual({
      custom: true,
      apiFormat: "openai",
      baseUrl: "http://localhost:11434/v1",
      model: ["llama3"],
      requiresKey: false,
    });
  });

  it("can reuse a stored credential instead of a new key", () => {
    credentialsState.data = [
      { id: "cred_1", namespace: "provider", name: "mimo", kind: "api_key", hasKey: true },
    ];
    renderModal();
    fireEvent.change(field(/base url/i), { target: { value: "https://api.example.com/v1" } });
    fireEvent.change(field(/model id/i), { target: { value: "m-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(field(/stored credential/i), { target: { value: "cred_1" } });
    fireEvent.click(submit());
    expect(mutateMock.mock.calls[0][0]).toMatchObject({ credentialId: "cred_1" });
    expect(mutateMock.mock.calls[0][0]).not.toHaveProperty("key");
  });

  it("refuses a bad URL, a bad name, or a name already taken", () => {
    modelsState.data = [{ id: "mimo-v2.6-flash" }];
    renderModal();
    fillMimo();
    expect(screen.getByTestId("add-model-conflict")).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(field(/name in peko/i), { target: { value: "has space" } });
    expect(submit()).toBeDisabled();
    fireEvent.change(field(/name in peko/i), { target: { value: "mimo-2" } });
    expect(submit()).toBeEnabled();
    fireEvent.change(field(/base url/i), { target: { value: "not a url" } });
    expect(submit()).toBeDisabled();
  });

  it("Close calls onClose without adding", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
