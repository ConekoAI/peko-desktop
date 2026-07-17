import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock all the data hooks the walkthrough consumes. Returning a
// mutable signal lets each test drive the visibility branch it
// cares about without restaging the full React Query cache.
const principalsSignal: { value: unknown } = { value: [] };
const modelsSignal: { value: unknown; loading: boolean } = {
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
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsSignal.value, isLoading: modelsSignal.loading }),
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
    modelsSignal.value = [];
    modelsSignal.loading = false;
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

  it("lists configured models in step 1", () => {
    modelsSignal.value = [
      { id: "openai", displayName: "OpenAI", apiFormat: "openai", modelId: "gpt-4o" },
      { id: "anthropic", displayName: "Anthropic", apiFormat: "anthropic", modelId: "claude-sonnet-4-6" },
    ];
    renderWalkthrough();
    expect(screen.getByText(/Pick a configured model/i)).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
  });

  it("pre-selects the first configured model", () => {
    modelsSignal.value = [
      { id: "openai", displayName: "OpenAI", apiFormat: "openai", modelId: "gpt-4o" },
      { id: "anthropic", displayName: "Anthropic", apiFormat: "anthropic", modelId: "claude-sonnet-4-6" },
    ];
    renderWalkthrough();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });

  it("shows an empty-state helper when no models are configured", () => {
    modelsSignal.value = [];
    renderWalkthrough();
    expect(screen.getByText(/No models configured yet/i)).toBeInTheDocument();
  });
});
