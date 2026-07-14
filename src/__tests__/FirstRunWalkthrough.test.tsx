import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock all the data hooks the walkthrough consumes. Returning a
// mutable signal lets each test drive the visibility branch it
// cares about without restaging the full React Query cache.
const principalsSignal: { value: unknown } = { value: [] };
const providersSignal: { value: unknown; loading: boolean } = {
  value: [],
  loading: false,
};
const credentialsSignal: { value: Array<{ provider: string; hasKey: boolean }>; loading: boolean } = {
  value: [],
  loading: false,
};

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({ data: principalsSignal.value, isLoading: false }),
  usePrincipalCreate: () => ({
    mutate: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  }),
}));
vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({ data: providersSignal.value, isLoading: providersSignal.loading }),
}));
vi.mock("../hooks/useSettings", () => ({
  useCredential: () => ({ data: null }),
  useCredentialList: () => ({
    data: credentialsSignal.value,
    isLoading: credentialsSignal.loading,
  }),
  useSetCredential: () => ({ mutate: vi.fn(), error: null }),
  useTestCredential: () => ({
    mutate: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
  }),
}));

import FirstRunWalkthrough, { ONBOARDING_KEY, REPLAY_EVENT } from "../components/FirstRunWalkthrough";

function renderWalkthrough() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FirstRunWalkthrough />
    </QueryClientProvider>,
  );
}

describe("FirstRunWalkthrough visibility (T-105)", () => {
  beforeEach(() => {
    localStorage.clear();
    principalsSignal.value = [];
    providersSignal.value = [];
    providersSignal.loading = false;
    credentialsSignal.value = [];
    credentialsSignal.loading = false;
  });

  it("does not render when the onboarding flag is set", () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    renderWalkthrough();
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
  });

  it("does not render when principals already exist", () => {
    principalsSignal.value = [
      { name: "alice", exposure: "Private", status: "online", owner: "user:local", runtimeId: "local" },
    ];
    renderWalkthrough();
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
  });

  it("renders on a fresh profile with no principals", () => {
    renderWalkthrough();
    expect(screen.getByTestId("first-run-walkthrough")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Peko")).toBeInTheDocument();
  });

  it("dismissing sets the flag and removes the overlay", async () => {
    const { fireEvent } = await import("@testing-library/react");
    renderWalkthrough();
    const closeBtn = screen.getByRole("button", { name: /skip onboarding/i });
    fireEvent.click(closeBtn);
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe("1");
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
  });

  it("re-shows when the replay event fires", async () => {
    const { fireEvent } = await import("@testing-library/react");
    renderWalkthrough();
    const closeBtn = screen.getByRole("button", { name: /skip onboarding/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();

    window.dispatchEvent(new Event(REPLAY_EVENT));
    expect(await screen.findByTestId("first-run-walkthrough")).toBeInTheDocument();
  });

  it("skips past credential steps when a provider is already configured", () => {
    providersSignal.value = [
      { id: "openai", displayName: "OpenAI" },
      { id: "minimax", displayName: "MiniMax" },
    ];
    credentialsSignal.value = [{ provider: "minimax", hasKey: true }];
    renderWalkthrough();
    // Step 4 ("Create principal") should render immediately — the
    // user already has a configured provider, so pick / paste /
    // test are skipped.
    expect(screen.getByText(/identity you'll chat with/i)).toBeInTheDocument();
    expect(screen.getByText(/Provider ready: MiniMax/)).toBeInTheDocument();
    expect(screen.queryByText(/Pick the model provider/i)).toBeNull();
  });

  it("falls through to all four steps when no provider is configured", () => {
    providersSignal.value = [
      { id: "openai", displayName: "OpenAI" },
      { id: "minimax", displayName: "MiniMax" },
    ];
    credentialsSignal.value = [];
    renderWalkthrough();
    expect(screen.getByText(/Pick the model provider/i)).toBeInTheDocument();
  });
});