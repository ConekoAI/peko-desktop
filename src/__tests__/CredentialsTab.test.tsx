import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CredentialDetail, ModelSummary } from "../types";

// Mutable signals for the hooks the tab consumes.
const credentialsSignal: {
  value: CredentialDetail[] | undefined;
  loading: boolean;
} = {
  value: undefined,
  loading: false,
};

const modelsSignal: {
  value: ModelSummary[] | undefined;
  loading: boolean;
  isError: boolean;
} = {
  value: undefined,
  loading: false,
  isError: false,
};

const setGenericCredentialMut = vi.fn();
const deleteCredentialByIdMut = vi.fn();
const credentialMaterialSignal: { value: string | undefined; loading: boolean } = {
  value: undefined,
  loading: false,
};

const updateModelMut = vi.fn();
const removeModelMut = vi.fn();
const testModelMut = vi.fn();

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: [] }),
  useSetSetting: () => ({ mutate: vi.fn() }),
  useGenericCredentialList: () => ({
    data: credentialsSignal.value,
    isLoading: credentialsSignal.loading,
  }),
  useSetGenericCredential: () => ({
    mutate: setGenericCredentialMut,
    isPending: false,
  }),
  useDeleteCredentialById: () => ({
    mutate: deleteCredentialByIdMut,
    isPending: false,
  }),
  useCredentialMaterial: () => ({
    data: credentialMaterialSignal.value,
    isLoading: credentialMaterialSignal.loading,
  }),
}));

vi.mock("../hooks/useModels", () => ({
  useModels: () => ({
    data: modelsSignal.value,
    isLoading: modelsSignal.loading,
    isError: modelsSignal.isError,
  }),
  useModelTemplates: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAddModel: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useUpdateModel: () => ({
    mutate: updateModelMut,
    isPending: false,
    error: null,
  }),
  useRemoveModel: () => ({
    mutate: removeModelMut,
    isPending: false,
  }),
  useTestModel: () => ({
    mutate: testModelMut,
    isPending: false,
    data: undefined,
  }),
  useReloadModels: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../hooks/useRuntimes", () => ({
  useRuntimes: () => ({ data: [], isLoading: false }),
  useAddRuntime: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveRuntime: () => ({ mutate: vi.fn(), isPending: false }),
  useReconnectRuntime: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameRuntime: () => ({ mutate: vi.fn(), isPending: false }),
  useOAuthConnect: () => ({ mutate: vi.fn(), isPending: false }),
  startOAuthConnect: () => Promise.resolve("https://pekohub.org/auth"),
}));

vi.mock("../components/modals/AddModelModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-model-modal">Add a Model</div> : null,
}));

vi.mock("../components/modals/EditModelModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-model-modal">Edit Model</div> : null,
}));

import Settings from "../pages/Settings";

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>,
  );
}

function switchTab(label: RegExp) {
  const buttons = screen.getAllByRole("button");
  const tabBtn = buttons.find((b) => label.test(b.textContent ?? ""));
  if (tabBtn) fireEvent.click(tabBtn);
}

function modelFixture(overrides?: Partial<ModelSummary>): ModelSummary {
  return {
    id: "openai",
    displayName: "OpenAI",
    apiFormat: "openai",
    baseUrl: "https://api.openai.com",
    modelId: "gpt-4o",
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    headers: {},
    requiresKey: true,
    isLocal: false,
    enabled: true,
    ...overrides,
  };
}

describe("Settings → Credentials & Models tabs", () => {
  beforeEach(() => {
    setGenericCredentialMut.mockReset();
    deleteCredentialByIdMut.mockReset();
    updateModelMut.mockReset();
    removeModelMut.mockReset();
    testModelMut.mockReset();
    testModelMut.mockImplementation(
      (_id: string, options?: { onSuccess?: (result: unknown) => void }) => {
        options?.onSuccess?.({
          id: _id,
          ok: true,
          message: "ok",
          latencyMs: 120,
          httpStatus: 200,
          modelUsed: "gpt-4o",
          testedAt: new Date().toISOString(),
        });
      },
    );

    credentialsSignal.value = undefined;
    credentialsSignal.loading = false;
    modelsSignal.value = undefined;
    modelsSignal.loading = false;
    modelsSignal.isError = false;
    credentialMaterialSignal.value = undefined;
    credentialMaterialSignal.loading = false;
  });

  describe("Credentials tab", () => {
    it("renders the empty state when there are no credentials", () => {
      credentialsSignal.value = [];
      renderSettings();
      switchTab(/credentials/i);
      expect(screen.getByTestId("credentials-empty-state")).toBeInTheDocument();
    });

    it("renders generic credential rows", () => {
      credentialsSignal.value = [
        {
          id: "cred-1",
          namespace: "llm",
          name: "openai",
          kind: "api_key",
          hasKey: true,
          lastTestedAt: "2026-07-16T00:00:00Z",
          lastTestedOk: true,
        },
        {
          id: "cred-2",
          namespace: "llm",
          name: "anthropic",
          kind: "api_key",
          hasKey: true,
        },
      ];
      renderSettings();
      switchTab(/credentials/i);
      expect(screen.getByTestId("credentials-rows")).toBeInTheDocument();
      expect(screen.getByTestId("credential-row-cred-1")).toBeInTheDocument();
      expect(screen.getByTestId("credential-row-cred-2")).toBeInTheDocument();
    });

    it("adds a generic credential via useSetGenericCredential", () => {
      credentialsSignal.value = [];
      renderSettings();
      switchTab(/credentials/i);

      const form = screen.getByTestId("add-credential-form");
      const inputs = form.querySelectorAll("input");
      // namespace, name, material
      fireEvent.change(inputs[0], { target: { value: "llm" } });
      fireEvent.change(inputs[1], { target: { value: "openai" } });
      fireEvent.change(inputs[2], { target: { value: "sk-secret" } });
      fireEvent.click(form.querySelector("button[type=submit]")!);

      expect(setGenericCredentialMut).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: "llm",
          name: "openai",
          material: "sk-secret",
        }),
        expect.any(Object),
      );
    });

    it("deletes a credential via useDeleteCredentialById", () => {
      credentialsSignal.value = [
        { id: "cred-1", namespace: "llm", name: "openai", kind: "api_key", hasKey: true },
      ];
      renderSettings();
      switchTab(/credentials/i);
      const row = screen.getByTestId("credential-row-cred-1");
      fireEvent.click(within(row).getByText("Delete"));
      expect(deleteCredentialByIdMut).toHaveBeenCalledWith("cred-1");
    });

    });

  describe("Models tab", () => {
    it("renders the empty state when there are no models", () => {
      modelsSignal.value = [];
      renderSettings();
      switchTab(/models/i);
      expect(screen.getByTestId("models-empty-state")).toBeInTheDocument();
    });

    it("renders configured model rows", () => {
      modelsSignal.value = [
        modelFixture({ id: "openai", displayName: "OpenAI" }),
        modelFixture({
          id: "anthropic",
          displayName: "Anthropic",
          apiFormat: "anthropic",
          modelId: "claude-sonnet-4-6",
          enabled: false,
        }),
      ];
      renderSettings();
      switchTab(/models/i);
      expect(screen.getByTestId("models-rows")).toBeInTheDocument();
      expect(screen.getByTestId("model-row-openai")).toBeInTheDocument();
      expect(screen.getByTestId("model-row-anthropic")).toBeInTheDocument();
    });

    it("toggles enabled via useUpdateModel", () => {
      modelsSignal.value = [modelFixture({ id: "openai" })];
      renderSettings();
      switchTab(/models/i);
      const checkbox = screen.getByRole("checkbox", { name: /enabled/i });
      fireEvent.click(checkbox);
      expect(updateModelMut).toHaveBeenCalledWith({ id: "openai", enabled: false });
    });

    it("tests a model via useTestModel and shows success feedback", () => {
      modelsSignal.value = [modelFixture({ id: "openai" })];
      renderSettings();
      switchTab(/models/i);
      const row = screen.getByTestId("model-row-openai");
      const testBtn = within(row).getByTitle("Test model");
      fireEvent.click(testBtn);
      expect(testModelMut).toHaveBeenCalledWith("openai", expect.any(Object));
      expect(screen.getByText(/Test passed · gpt-4o/)).toBeInTheDocument();
    });

    it("removes a model via useRemoveModel after inline confirmation", () => {
      modelsSignal.value = [modelFixture({ id: "openai" })];
      renderSettings();
      switchTab(/models/i);
      const row = screen.getByTestId("model-row-openai");
      fireEvent.click(within(row).getByTitle("Remove"));
      expect(screen.getByText("Confirm")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Confirm"));
      expect(removeModelMut).toHaveBeenCalledWith(
        "openai",
        expect.any(Object),
      );
    });

    it("cancels model removal without calling useRemoveModel", () => {
      modelsSignal.value = [modelFixture({ id: "openai" })];
      renderSettings();
      switchTab(/models/i);
      const row = screen.getByTestId("model-row-openai");
      fireEvent.click(within(row).getByTitle("Remove"));
      fireEvent.click(screen.getByText("Cancel"));
      expect(removeModelMut).not.toHaveBeenCalled();
    });

    it("opens the Add Model modal from the header button", () => {
      modelsSignal.value = [];
      renderSettings();
      switchTab(/models/i);
      fireEvent.click(screen.getByTestId("open-add-model-modal"));
      expect(screen.getByTestId("add-model-modal")).toBeInTheDocument();
    });

    it("opens the Edit Model modal", () => {
      modelsSignal.value = [modelFixture({ id: "openai" })];
      renderSettings();
      switchTab(/models/i);
      fireEvent.click(screen.getByTitle("Edit"));
      expect(screen.getByTestId("edit-model-modal")).toBeInTheDocument();
    });

    it("shows the catalog-unavailable banner on error", () => {
      modelsSignal.value = undefined;
      modelsSignal.isError = true;
      renderSettings();
      switchTab(/models/i);
      expect(screen.getByTestId("models-catalog-unavailable")).toBeInTheDocument();
    });
  });
});
