// Edit model replaces a model's API key: the new key is stored beside
// the old one (same name) and the model points at it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ModelSummary } from "../types";

const updateMock = vi.fn();
const setKeyMock = vi.fn();

vi.mock("../hooks/useModels", () => ({
  useUpdateModel: () => ({ mutate: updateMock, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock("../hooks/useSettings", () => ({
  useGenericCredentialList: () => ({
    data: [{ id: "cred-old", namespace: "provider", name: "mimo", kind: "api_key", hasKey: true }],
  }),
  useSetGenericCredential: () => ({
    mutateAsync: setKeyMock,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

import EditModelModal from "../components/modals/EditModelModal";

const model: ModelSummary = {
  id: "mimo",
  displayName: "MiMo",
  apiFormat: "openai",
  baseUrl: "https://example.com/v1",
  modelId: "mimo-v2",
  headers: {},
  credentialId: "cred-old",
  requiresKey: true,
  isLocal: false,
  enabled: true,
};

beforeEach(() => {
  updateMock.mockReset();
  setKeyMock.mockReset();
});

describe("EditModelModal", () => {
  it("keeps the current key when the new-key field is empty", () => {
    render(<EditModelModal open model={model} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(setKeyMock).not.toHaveBeenCalled();
    expect(updateMock.mock.calls[0][0]).toMatchObject({ id: "mimo", credentialId: "cred-old" });
  });

  it("stores a replacement key under the old key's name and points the model at it", async () => {
    setKeyMock.mockResolvedValue("cred-new");
    render(<EditModelModal open model={model} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/replace api key/i), { target: { value: " sk-new " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(setKeyMock).toHaveBeenCalledWith({
      namespace: "provider",
      name: "mimo",
      kind: "api_key",
      material: "sk-new",
    });
    expect(updateMock.mock.calls[0][0]).toMatchObject({ credentialId: "cred-new" });
  });

  it("does not update the model when storing the key fails", async () => {
    setKeyMock.mockRejectedValue(new Error("vault locked"));
    render(<EditModelModal open model={model} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/replace api key/i), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(setKeyMock).toHaveBeenCalled());
    expect(updateMock).not.toHaveBeenCalled();
  });
});
