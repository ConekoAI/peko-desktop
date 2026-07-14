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
});