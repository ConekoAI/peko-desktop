import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderInfo, CredentialDetail, RotationBinding } from "../types";

// Mutable signals for the hooks the tab consumes.
const catalogSignal: {
  value: ProviderInfo[] | undefined;
  loading: boolean;
  isError: boolean;
} = {
  value: undefined,
  loading: false,
  isError: false,
};
const credentialsSignal: {
  value: CredentialDetail[] | undefined;
  loading: boolean;
} = {
  value: undefined,
  loading: false,
};
const bindingSignal: {
  value: RotationBinding | undefined;
  loading: boolean;
} = {
  value: undefined,
  loading: false,
};

const updateProviderMut = vi.fn();
const removeProviderMut = vi.fn();
const setDefaultProviderMut = vi.fn();
const addProviderMut = vi.fn();
const refetchTemplates = vi.fn();

const setGenericCredentialMut = vi.fn();
const deleteCredentialByIdMut = vi.fn();
const testCredentialByIdMut = vi.fn();
const credentialMaterialSignal: { value: string | undefined; loading: boolean } = {
  value: undefined,
  loading: false,
};

const setBindingMut = vi.fn();
const deleteBindingMut = vi.fn();
const testBindingRotationMut = vi.fn();

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: [] }),
  useSetSetting: () => ({ mutate: vi.fn() }),
  useCredential: (provider: string) => ({
    data: provider
      ? (credentialsSignal.value ?? []).find((c) => c.namespace === `provider:${provider}`) ?? null
      : null,
  }),
  useDeleteCredential: () => ({ mutate: vi.fn(), isPending: false }),
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
  useTestCredentialById: () => ({
    mutate: testCredentialByIdMut,
    isPending: false,
    data: undefined,
    variables: undefined,
  }),
  useCredentialMaterial: () => ({
    data: credentialMaterialSignal.value,
    isLoading: credentialMaterialSignal.loading,
  }),
}));

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({
    data: catalogSignal.value,
    isLoading: catalogSignal.loading,
    isError: catalogSignal.isError,
  }),
  useUpdateProvider: () => ({
    mutate: updateProviderMut,
    isPending: false,
    error: null,
  }),
  useRemoveProvider: () => ({
    mutate: removeProviderMut,
    isPending: false,
  }),
  useSetDefaultProvider: () => ({
    mutate: setDefaultProviderMut,
    isPending: false,
  }),
  useAddProvider: () => ({
    mutate: addProviderMut,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useProviderTemplates: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: refetchTemplates,
  }),
}));

vi.mock("../hooks/useBindings", () => ({
  useBinding: () => ({
    data: bindingSignal.value,
    isLoading: bindingSignal.loading,
  }),
  useSetBinding: () => ({
    mutate: setBindingMut,
    isPending: false,
  }),
  useDeleteBinding: () => ({
    mutate: deleteBindingMut,
    isPending: false,
  }),
  useTestBindingRotation: () => ({
    mutate: testBindingRotationMut,
    isPending: false,
    data: undefined,
  }),
}));

vi.mock("../components/modals/AddProviderModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-provider-modal">Add a Provider</div> : null,
}));

vi.mock("../components/modals/EditProviderModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-provider-modal">Edit Provider</div> : null,
}));

import Settings from "../pages/Settings";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>,
  );
}

function switchToCredentialsTab() {
  const buttons = screen.getAllByRole("button");
  const credentialsBtn = buttons.find((b) => /credentials/i.test(b.textContent ?? ""));
  if (credentialsBtn) fireEvent.click(credentialsBtn);
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

describe("CredentialsTab (RP6 accordion redesign)", () => {
  beforeEach(() => {
    updateProviderMut.mockReset();
    removeProviderMut.mockReset();
    setDefaultProviderMut.mockReset();
    addProviderMut.mockReset();
    refetchTemplates.mockReset();
    setGenericCredentialMut.mockReset();
    deleteCredentialByIdMut.mockReset();
    testCredentialByIdMut.mockReset();
    testBindingRotationMut.mockReset();
    setBindingMut.mockReset();
    deleteBindingMut.mockReset();

    catalogSignal.value = undefined;
    catalogSignal.loading = false;
    catalogSignal.isError = false;
    credentialsSignal.value = undefined;
    credentialsSignal.loading = false;
    bindingSignal.value = undefined;
    bindingSignal.loading = false;
    credentialMaterialSignal.value = undefined;
    credentialMaterialSignal.loading = false;
  });

  it("renders the empty state when there are no providers", () => {
    catalogSignal.value = [];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("credentials-empty-state")).toBeInTheDocument();
  });

  it("renders ALL catalog providers, not only configured ones", () => {
    catalogSignal.value = [
      providerFixture({ id: "openai", displayName: "OpenAI" }),
      providerFixture({ id: "anthropic", displayName: "Anthropic", apiType: "anthropic" }),
    ];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("credentials-rows")).toBeInTheDocument();
    expect(screen.getByTestId("provider-row-openai")).toBeInTheDocument();
    expect(screen.getByTestId("provider-row-anthropic")).toBeInTheDocument();
  });

  it("toggles enabled via useUpdateProvider", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    const checkbox = screen.getByRole("checkbox", { name: /enabled/i });
    fireEvent.click(checkbox);
    expect(updateProviderMut).toHaveBeenCalledWith({ id: "openai", enabled: false });
  });

  it("sets a provider as default via useSetDefaultProvider", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    const star = screen.getByTitle("Set as default");
    fireEvent.click(star);
    expect(setDefaultProviderMut).toHaveBeenCalledWith({ provider: "openai" });
  });

  it("removes a provider via useRemoveProvider after confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTitle("Remove"));
    expect(removeProviderMut).toHaveBeenCalledWith("openai");
  });

  it("opens the Edit Provider modal", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTitle("Edit"));
    expect(screen.getByTestId("edit-provider-modal")).toBeInTheDocument();
  });

  it("expands a provider to show credentials, add-key form, and binding panel", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);
    expect(screen.getByRole("heading", { name: /Keys/i })).toBeInTheDocument();
    expect(screen.getByTestId("add-credential-form")).toBeInTheDocument();
    expect(screen.getByTestId("rotation-binding-panel")).toBeInTheDocument();
  });

  it("lists stored credentials in the expanded body", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [
      {
        id: "cred-1",
        namespace: "provider:openai",
        name: "primary",
        kind: "api_key",
        hasKey: true,
        lastTestedAt: "2026-07-16T00:00:00Z",
        lastTestedOk: true,
      },
    ];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);
    const row = screen.getByTestId("credential-row-cred-1");
    expect(within(row).getByText("primary")).toBeInTheDocument();
    expect(within(row).getByText("api_key")).toBeInTheDocument();
  });

  it("deletes a credential via useDeleteCredentialById", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [
      { id: "cred-1", namespace: "provider:openai", name: "primary", kind: "api_key", hasKey: true },
    ];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);
    const row = screen.getByTestId("credential-row-cred-1");
    fireEvent.click(within(row).getByText("Delete"));
    expect(deleteCredentialByIdMut).toHaveBeenCalledWith("cred-1");
  });

  it("tests a credential via useTestCredentialById", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [
      { id: "cred-1", namespace: "provider:openai", name: "primary", kind: "api_key", hasKey: true },
    ];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);
    const row = screen.getByTestId("credential-row-cred-1");
    fireEvent.click(within(row).getByText("Test"));
    expect(testCredentialByIdMut).toHaveBeenCalledWith("cred-1");
  });

  it("adds a credential via useSetGenericCredential", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);

    const form = screen.getByTestId("add-credential-form");
    const inputs = form.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "work" } });
    fireEvent.change(inputs[1], { target: { value: "sk-secret" } });
    fireEvent.click(form.querySelector("button[type=submit]")!);

    expect(setGenericCredentialMut).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "provider:openai",
        name: "work",
        kind: "api_key",
        material: "sk-secret",
      }),
      expect.any(Object),
    );
  });

  it("saves a rotation binding via useSetBinding", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);

    const panel = screen.getByTestId("rotation-binding-panel");
    const input = within(panel).getByPlaceholderText(/Credential ids/i);
    fireEvent.change(input, { target: { value: "cred-1, cred-2" } });
    fireEvent.click(within(panel).getByText("Save binding"));

    expect(setBindingMut).toHaveBeenCalledWith({
      key: "provider:openai:default",
      strategy: "round_robin",
      order: ["cred-1", "cred-2"],
    });
  });

  it("deletes an existing rotation binding via useDeleteBinding", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    bindingSignal.value = {
      key: "provider:openai:default",
      strategy: "round_robin",
      order: ["cred-1"],
    };
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);

    const panel = screen.getByTestId("rotation-binding-panel");
    fireEvent.click(within(panel).getByText("Delete"));
    expect(deleteBindingMut).toHaveBeenCalledWith("provider:openai:default");
  });

  it("tests a rotation binding via useTestBindingRotation", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("provider-row-openai").querySelector("button")!);

    const panel = screen.getByTestId("rotation-binding-panel");
    fireEvent.click(within(panel).getByText("Test rotation"));
    expect(testBindingRotationMut).toHaveBeenCalledWith("provider:openai:default");
  });

  it("renders orphaned vault keys when no matching catalog provider exists", () => {
    catalogSignal.value = [providerFixture({ id: "openai" })];
    credentialsSignal.value = [
      { id: "cred-1", namespace: "provider:openai", name: "ok", kind: "api_key", hasKey: true },
      { id: "cred-2", namespace: "provider:miniax", name: "typo", kind: "api_key", hasKey: true },
    ];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("credentials-orphans")).toBeInTheDocument();
    expect(screen.getByTestId("orphan-row-miniax")).toBeInTheDocument();
    expect(screen.queryByTestId("orphan-row-openai")).toBeNull();
  });

  it("does NOT flag orphans while the catalog fetch is in error", () => {
    catalogSignal.value = undefined;
    catalogSignal.isError = true;
    credentialsSignal.value = [
      { id: "cred-1", namespace: "provider:miniax", name: "typo", kind: "api_key", hasKey: true },
    ];
    renderTab();
    switchToCredentialsTab();
    expect(screen.queryByTestId("credentials-orphans")).toBeNull();
    expect(screen.getByTestId("credentials-catalog-unavailable")).toBeInTheDocument();
  });

  it("opens the Add Provider modal from the header button", () => {
    catalogSignal.value = [];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("open-add-provider-modal"));
    expect(screen.getByTestId("add-provider-modal")).toBeInTheDocument();
  });
});
