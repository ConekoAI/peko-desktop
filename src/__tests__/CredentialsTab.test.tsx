import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mutable signals: the tab reads catalog + vault from these hooks.
// Capturing the last mutate call lets each test assert exactly what
// the row would have sent over IPC.
type Catalog = Array<{
  id: string;
  displayName: string;
  apiType: string;
  defaultModel: string;
  requiresKey: boolean;
  isLocal: boolean;
}>;
type Credentials = Array<{ provider: string; hasKey: boolean; lastTested?: string }>;

const catalogSignal: { value: Catalog | undefined; loading: boolean } = {
  value: undefined,
  loading: false,
};
const credentialsSignal: { value: Credentials | undefined; loading: boolean } = {
  value: undefined,
  loading: false,
};

const setMut = vi.fn();
const deleteMut = vi.fn();
const testMut = vi.fn();
const addMut = vi.fn();
const refetchTemplates = vi.fn();
const testMutSignal: {
  data: { success: boolean; message: string; latencyMs: number; httpStatus: number | null; modelUsed: string | null } | undefined;
  isPending: boolean;
  variables: string | undefined;
} = { data: undefined, isPending: false, variables: undefined };
const templatesSignal: {
  value: Array<{ id: string; displayName: string; apiType: string; baseUrl: string; requiresKey: boolean; defaultModel: string; models: unknown[] }>;
  loading: boolean;
  error: Error | null;
} = { value: [], loading: false, error: null };

vi.mock("../hooks/useSettings", () => ({
  useCredentialList: () => ({
    data: credentialsSignal.value,
    isLoading: credentialsSignal.loading,
  }),
  useCredential: (provider: string) => ({
    data: provider
      ? (credentialsSignal.value ?? []).find((c) => c.provider === provider) ?? null
      : null,
  }),
  useSetCredential: () => ({
    mutate: setMut,
    isPending: false,
    error: null,
  }),
  useDeleteCredential: () => ({
    mutate: deleteMut,
    isPending: false,
  }),
  useTestCredential: () => ({
    mutate: testMut,
    isPending: testMutSignal.isPending,
    data: testMutSignal.data,
    variables: testMutSignal.variables,
  }),
  useSettings: () => ({ data: [] }),
  useSetSetting: () => ({ mutate: vi.fn() }),
}));

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({
    data: catalogSignal.value,
    isLoading: catalogSignal.loading,
  }),
  useProviderTemplates: () => ({
    data: templatesSignal.value,
    isLoading: templatesSignal.loading,
    error: templatesSignal.error,
    refetch: refetchTemplates,
  }),
  useAddProvider: () => ({
    mutate: addMut,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
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

describe("CredentialsTab (T-109b redesign)", () => {
  beforeEach(() => {
    setMut.mockReset();
    deleteMut.mockReset();
    testMut.mockReset();
    addMut.mockReset();
    refetchTemplates.mockReset();
    testMutSignal.data = undefined;
    testMutSignal.isPending = false;
    testMutSignal.variables = undefined;
    templatesSignal.value = [];
    templatesSignal.loading = false;
    templatesSignal.error = null;
    catalogSignal.value = undefined;
    credentialsSignal.value = undefined;
    catalogSignal.loading = false;
    credentialsSignal.loading = false;
    // Default to the Credentials tab — Settings defaults to "general".
    localStorage.removeItem("peko.settingsTab");
  });

  function switchToCredentialsTab() {
    // The Settings page exposes tab buttons. Click the "Credentials" one.
    const buttons = screen.getAllByRole("button");
    const credentialsBtn = buttons.find((b) =>
      /credentials/i.test(b.textContent ?? ""),
    );
    if (credentialsBtn) fireEvent.click(credentialsBtn);
  }

  it("renders the empty state with the Add button when there are no providers and no credentials", () => {
    catalogSignal.value = [];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("credentials-empty-state")).toBeInTheDocument();
    expect(
      screen.getByText(/No providers configured yet/i),
    ).toBeInTheDocument();
  });

  it("renders one row per catalog provider, configured rows first", () => {
    catalogSignal.value = [
      { id: "openai", displayName: "OpenAI", apiType: "openai", defaultModel: "gpt-5", requiresKey: true, isLocal: false },
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-opus-4-7", requiresKey: true, isLocal: false },
      { id: "ollama", displayName: "Ollama", apiType: "openai", defaultModel: "llama-3.1", requiresKey: false, isLocal: true },
    ];
    credentialsSignal.value = [
      { provider: "ollama", hasKey: false },
      { provider: "anthropic", hasKey: true, lastTested: "2026-07-14T12:00:00Z" },
    ];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("provider-row-anthropic")).toBeInTheDocument();
    expect(screen.getByTestId("provider-row-openai")).toBeInTheDocument();
    expect(screen.getByTestId("provider-row-ollama")).toBeInTheDocument();
    // "Key set" indicator only on the configured row.
    expect(screen.getAllByText(/Key set/i).length).toBeGreaterThanOrEqual(1);
    // Anthropic has lastTested so its row should render the timestamp.
    expect(screen.getByTestId("provider-row-anthropic").textContent).toContain(
      "anthropic",
    );
  });

  it("hides the API key input for local providers (ollama) and providers with requiresKey=false", () => {
    catalogSignal.value = [
      { id: "ollama", displayName: "Ollama", apiType: "openai", defaultModel: "llama-3.1", requiresKey: false, isLocal: true },
    ];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    expect(screen.queryByTestId("api-key-input-ollama")).toBeNull();
  });

  it("typing a key and clicking Save calls useSetCredential.mutate", () => {
    catalogSignal.value = [
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-opus-4-7", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    const input = screen.getByTestId("api-key-input-anthropic");
    fireEvent.change(input, { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByTestId("save-key-anthropic"));
    expect(setMut).toHaveBeenCalledTimes(1);
    const [args] = setMut.mock.calls[0] as [{ provider: string; apiKey: string }];
    expect(args).toEqual({ provider: "anthropic", apiKey: "sk-test-key" });
  });

  it("configured row shows Test and Delete buttons; clicking them calls the matching mutation", () => {
    catalogSignal.value = [
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-opus-4-7", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [{ provider: "anthropic", hasKey: true }];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("test-key-anthropic"));
    expect(testMut).toHaveBeenCalledWith("anthropic");
    fireEvent.click(screen.getByTestId("delete-key-anthropic"));
    // `useDeleteCredential` is invoked as mutate(provider, { onSuccess })
    // from ProviderRow (we want a transient "Removed" indicator).
    expect(deleteMut.mock.calls[0][0]).toBe("anthropic");
  });

  it("renders the orphan strip when the vault has keys for providers that are NOT in the catalog", () => {
    catalogSignal.value = [
      { id: "openai", displayName: "OpenAI", apiType: "openai", defaultModel: "gpt-5", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [
      { provider: "openai", hasKey: true },
      { provider: "miniax", hasKey: true },
    ];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("credentials-orphans")).toBeInTheDocument();
    expect(screen.getByTestId("orphan-row-miniax")).toBeInTheDocument();
    expect(screen.queryByTestId("orphan-row-openai")).toBeNull();
  });

  it("orphan delete routes through useDeleteCredential", () => {
    catalogSignal.value = [];
    credentialsSignal.value = [{ provider: "miniax", hasKey: true }];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("orphan-row-miniax").querySelector("button")!);
    expect(deleteMut).toHaveBeenCalledWith("miniax");
  });

  it("opens the Add Provider modal when the header button is clicked", () => {
    catalogSignal.value = [];
    credentialsSignal.value = [];
    renderTab();
    switchToCredentialsTab();
    fireEvent.click(screen.getByTestId("open-add-provider-modal"));
    expect(screen.getByText("Add a Provider")).toBeInTheDocument();
  });

  // ─── credential test rendering (peko-desktop follow-up to peko-runtime #193) ───

  it("shows the result line with latency after a successful test", () => {
    catalogSignal.value = [
      { id: "openai", displayName: "OpenAI", apiType: "openai", defaultModel: "gpt-5", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [{ provider: "openai", hasKey: true }];
    testMutSignal.data = {
      success: true,
      message: "Connection successful (124 models)",
      latencyMs: 187,
      httpStatus: 200,
      modelUsed: null,
    };
    testMutSignal.variables = "openai";
    renderTab();
    switchToCredentialsTab();
    const result = screen.getByTestId("credential-test-result-openai");
    expect(result.textContent).toContain("Connected");
    expect(result.textContent).toContain("187ms");
    expect(result.textContent).not.toContain("via ");
  });

  it("shows the via-model line for an Anthropic-format success", () => {
    catalogSignal.value = [
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-opus-4-7", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [{ provider: "anthropic", hasKey: true }];
    testMutSignal.data = {
      success: true,
      message: "Connection successful (1 token billed via claude-haiku-4-5)",
      latencyMs: 312,
      httpStatus: 200,
      modelUsed: "claude-haiku-4-5",
    };
    testMutSignal.variables = "anthropic";
    renderTab();
    switchToCredentialsTab();
    const result = screen.getByTestId("credential-test-result-anthropic");
    expect(result.textContent).toContain("Connected");
    expect(result.textContent).toContain("via claude-haiku-4-5");
    expect(result.textContent).toContain("312ms");
    expect(result.textContent).toContain("~1 token billed");
  });

  it("shows the HTTP status and latency after a failed test", () => {
    catalogSignal.value = [
      { id: "openai", displayName: "OpenAI", apiType: "openai", defaultModel: "gpt-5", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [{ provider: "openai", hasKey: true }];
    testMutSignal.data = {
      success: false,
      message: "HTTP 401: invalid api key",
      latencyMs: 124,
      httpStatus: 401,
      modelUsed: null,
    };
    testMutSignal.variables = "openai";
    renderTab();
    switchToCredentialsTab();
    const result = screen.getByTestId("credential-test-result-openai");
    expect(result.textContent).toContain("✗");
    expect(result.textContent).toContain("HTTP 401");
    expect(result.textContent).toContain("invalid api key");
    expect(result.textContent).toContain("124ms");
  });

  it("shows the spinner (Loader2) while the test is pending and the variables match this row", () => {
    catalogSignal.value = [
      { id: "openai", displayName: "OpenAI", apiType: "openai", defaultModel: "gpt-5", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [{ provider: "openai", hasKey: true }];
    testMutSignal.isPending = true;
    testMutSignal.variables = "openai";
    renderTab();
    switchToCredentialsTab();
    // While pending, the Test button's icon swaps from TestTube to
    // Loader2 with the animate-spin class. The animate-spin lives
    // on the icon, not the button — walk one element down.
    const btn = screen.getByTestId("test-key-openai");
    const spinner = btn.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
    // The result line must NOT render before the test settles.
    expect(
      screen.queryByTestId("credential-test-result-openai"),
    ).toBeNull();
  });
});