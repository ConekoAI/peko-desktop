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

const catalogSignal: {
  value: Catalog | undefined;
  loading: boolean;
  isError: boolean;
} = {
  value: undefined,
  loading: false,
  isError: false,
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
    isError: catalogSignal.isError,
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
    catalogSignal.isError = false;
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

  it("renders only configured catalog rows (unconfigured entries are NOT shown — they belong in the Add Provider picker)", () => {
    // Three catalog entries; only `anthropic` has a stored key. The
    // list should render exactly one row — for `anthropic`. The
    // unconfigured `openai` and `ollama` entries are reachable
    // through the "Add Provider" picker, not this screen.
    catalogSignal.value = [
      { id: "openai", displayName: "OpenAI", apiType: "openai", defaultModel: "gpt-5", requiresKey: true, isLocal: false },
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-opus-4-7", requiresKey: true, isLocal: false },
      { id: "ollama", displayName: "Ollama", apiType: "openai", defaultModel: "llama-3.1", requiresKey: false, isLocal: true },
    ];
    credentialsSignal.value = [{ provider: "anthropic", hasKey: true }];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("provider-row-anthropic")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-row-openai")).toBeNull();
    expect(screen.queryByTestId("provider-row-ollama")).toBeNull();
    // "Key set" indicator only on the configured row.
    expect(screen.getAllByText(/Key set/i).length).toBeGreaterThanOrEqual(1);
  });

  it("configured local providers render a row but hide the API key input", () => {
    // Ollama is local and doesn't take a key. When it's already
    // configured (vault has `hasKey` flag) it shows as a row in the
    // list, but the row never renders the password input.
    catalogSignal.value = [
      { id: "ollama", displayName: "Ollama", apiType: "openai", defaultModel: "llama-3.1", requiresKey: false, isLocal: true },
    ];
    credentialsSignal.value = [{ provider: "ollama", hasKey: true }];
    renderTab();
    switchToCredentialsTab();
    expect(screen.getByTestId("provider-row-ollama")).toBeInTheDocument();
    expect(screen.queryByTestId("api-key-input-ollama")).toBeNull();
  });

  it("updating an existing key calls useSetCredential.mutate", () => {
    // Only configured rows render. Updating a key on an existing
    // row flows through `useSetCredential.mutate`. (Adding the first
    // key for an unconfigured provider goes through the Add Provider
    // modal — that's a different code path.)
    catalogSignal.value = [
      { id: "anthropic", displayName: "Anthropic", apiType: "anthropic", defaultModel: "claude-opus-4-7", requiresKey: true, isLocal: false },
    ];
    credentialsSignal.value = [{ provider: "anthropic", hasKey: true }];
    renderTab();
    switchToCredentialsTab();
    const input = screen.getByTestId("api-key-input-anthropic");
    fireEvent.change(input, { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByTestId("save-key-anthropic"));
    expect(setMut).toHaveBeenCalledTimes(1);
    const [args] = setMut.mock.calls[0] as [{ provider: string; apiKey: string }];
    expect(args).toEqual({ provider: "anthropic", apiKey: "sk-test-key" });
  });

  it("the credential rows panel scrolls internally when many providers are configured (no off-screen overflow)", () => {
    // Six configured providers — for a user with a heavy catalog,
    // this would otherwise push the orphan banner and tab bar off
    // the bottom of the screen. Cap the height and let the panel
    // scroll inside itself.
    catalogSignal.value = Array.from({ length: 6 }).map((_, i) => ({
      id: `p${i}`,
      displayName: `Provider ${i}`,
      apiType: "openai",
      defaultModel: "m",
      requiresKey: true,
      isLocal: false,
    }));
    credentialsSignal.value = Array.from({ length: 6 }).map((_, i) => ({
      provider: `p${i}`,
      hasKey: true,
    }));
    renderTab();
    switchToCredentialsTab();
    const rows = screen.getByTestId("credentials-rows");
    expect(rows.className).toContain("overflow-y-auto");
    expect(rows.className).toContain("max-h-");
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

  it("does NOT mark vault keys as orphans when the catalog fetch errored (peko-desktop#44 regression)", () => {
    // Bug shape: when `provider_list` fails (daemon IPC error / restart),
    // `useProviders()` returns `data = undefined` and React Query flags
    // `isError`. The previous code computed `orphanIds` against an
    // empty catalog, so every real vault key (e.g. `minimax`) was
    // surfaced as an orphan with the "Clean up with peko credential
    // delete" copy — a destructive prompt against a working key.
    catalogSignal.value = undefined;
    catalogSignal.isError = true;
    credentialsSignal.value = [{ provider: "minimax", hasKey: true }];
    renderTab();
    switchToCredentialsTab();
    expect(screen.queryByTestId("credentials-orphans")).toBeNull();
    expect(screen.queryByTestId("orphan-row-minimax")).toBeNull();
    expect(screen.getByTestId("credentials-catalog-unavailable")).toBeInTheDocument();
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