import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock all the data hooks the walkthrough consumes. Returning a
// mutable signal lets each test drive the visibility branch it
// cares about without restaging the full React Query cache.
const principalsSignal: { value: unknown } = { value: [] };
const modelsSignal: { value: unknown; loading: boolean } = {
  value: [],
  loading: false,
};
const settingsSignal: { value: unknown } = { value: [] };
const pekohubBundleSignal: { value: unknown; loading: boolean } = {
  value: null,
  loading: false,
};

const runOAuthFlowMock = vi.fn();

// PR #10: the production `usePrincipalCreate.mutate({...}, {onSuccess})`
// is what advances step 2 → step 3. The default `mutate: vi.fn()` would
// swallow onSuccess entirely, leaving the test stuck on step 2. We
// mirror the production shape: invoke onSuccess synchronously so step
// advancement is observable in tests.
const principalCreateMutateMock = vi.fn((_req: unknown, opts?: { onSuccess?: () => void }) => {
  if (opts?.onSuccess) opts.onSuccess();
});

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({ data: principalsSignal.value, isLoading: false }),
  usePrincipalCreate: () => ({
    mutate: principalCreateMutateMock,
    isPending: false,
    reset: vi.fn(),
  }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsSignal.value, isLoading: modelsSignal.loading }),
}));
vi.mock("../hooks/useRuntimes", () => ({
  usePekohubBundle: () => ({
    data: pekohubBundleSignal.value,
    isPending: pekohubBundleSignal.loading,
  }),
  runOAuthFlow: (...args: unknown[]) => runOAuthFlowMock(...args),
}));
vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: settingsSignal.value }),
}));

// PR #10: step 4's Browse action calls useNavigate; mock it so the
// test renders without a <RouterProvider>. The browse action is
// covered separately in the integration tests; here we just need
// the call site to not throw.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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
    settingsSignal.value = [];
    pekohubBundleSignal.value = null;
    pekohubBundleSignal.loading = false;
    runOAuthFlowMock.mockReset();
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

  it("dismissing sets the flag and removes the overlay", () => {
    renderWalkthrough();
    const closeBtn = screen.getByRole("button", { name: /skip onboarding/i });
    fireEvent.click(closeBtn);
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe("1");
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
  });

  it("re-shows when the replay event fires", async () => {
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

describe("FirstRunWalkthrough step-2 name validation (path-traversal defense)", () => {
  beforeEach(() => {
    principalsSignal.value = [];
    modelsSignal.value = [
      { id: "openai", displayName: "OpenAI", apiFormat: "openai", modelId: "gpt-4o" },
    ];
    localStorage.removeItem(ONBOARDING_KEY);
    settingsSignal.value = [];
    pekohubBundleSignal.value = null;
    pekohubBundleSignal.loading = false;
  });

  function advanceToStep2() {
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
  }

  // The step-2 input has no htmlFor/id association, so reach it
  // via its unique placeholder ("alice"). The description textarea
  // has placeholder "Personal coding assistant" so the two are
  // disambiguated by role+placeholder.
  function getStep2NameInput() {
    return screen.getByPlaceholderText("alice") as HTMLInputElement;
  }

  it.each([
    "..", // double-dot (path traversal)
    ".", // single dot
    "../escape",
    "foo..bar",
    "-leading-hyphen",
    "trailing-hyphen-",
  ])("disables Create button when name is %s", (badName) => {
    renderWalkthrough();
    advanceToStep2();
    fireEvent.change(getStep2NameInput(), { target: { value: badName } });
    const createBtn = screen.getByRole("button", { name: /create/i });
    expect(createBtn).toBeDisabled();
    // And the hint copy surfaces the `..` exclusion (or the
    // path-separator / leading-trailing hyphen line — the regex
    // is shared with CreatePrincipalModal).
    expect(
      screen.getByText(/leading\/trailing hyphen|path separators|\.\./i),
    ).toBeInTheDocument();
  });

  it("enables Create when name is a valid principal name", () => {
    renderWalkthrough();
    advanceToStep2();
    fireEvent.change(getStep2NameInput(), { target: { value: "alice" } });
    expect(screen.getByRole("button", { name: /create/i })).not.toBeDisabled();
  });
});

describe("FirstRunWalkthrough PR #10 steps 3 + 4", () => {
  beforeEach(() => {
    localStorage.clear();
    principalsSignal.value = [];
    modelsSignal.value = [
      { id: "openai", displayName: "OpenAI", apiFormat: "openai", modelId: "gpt-4o" },
    ];
    settingsSignal.value = [
      { key: "pekohub.base_url", value: "https://hub.example.com" },
      { key: "pekohub.oauth_scope", value: "runtimes:read" },
    ];
    pekohubBundleSignal.value = null;
    pekohubBundleSignal.loading = false;
    runOAuthFlowMock.mockReset();
    principalCreateMutateMock.mockClear();
  });

  // Drive step 1 → step 2 → step 3. Step 1 has a pre-selected model
  // (the useEffect picks the first configured model on mount); step 2
  // needs a valid principal name; the Create button click fires
  // mutate whose onSuccess advances to step 3.
  function advanceToStep3() {
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.change(screen.getByPlaceholderText("alice"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
  }

  function advanceToStep4() {
    advanceToStep3();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  }

  it("renders 4 step pills in the stepper", () => {
    renderWalkthrough();
    const list = screen.getByRole("list", { name: /onboarding progress/i });
    expect(list.querySelectorAll("li")).toHaveLength(4);
  });

  it("step 3 surfaces a Sign in with PekoHub button that calls runOAuthFlow", async () => {
    runOAuthFlowMock.mockResolvedValue({ added: 1, runtimes: [] });
    renderWalkthrough();
    advanceToStep3();
    const connectBtn = screen.getByTestId("onboarding-connect-hub");
    fireEvent.click(connectBtn);
    // Allow the awaited runOAuthFlow microtask to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(runOAuthFlowMock).toHaveBeenCalledTimes(1);
    expect(runOAuthFlowMock).toHaveBeenCalledWith({
      baseUrl: "https://hub.example.com",
      scope: "runtimes:read",
    });
  });

  it("step 3 surfaces 'Already connected' when a PekoHub bundle is stored", () => {
    pekohubBundleSignal.value = { access_token: "tok" };
    pekohubBundleSignal.loading = false;
    renderWalkthrough();
    advanceToStep3();
    expect(screen.getByText(/Already connected to PekoHub/i)).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-connect-hub")).toBeNull();
  });

  it("step 3's footer Skip button transitions to step 4 without dismissing", () => {
    renderWalkthrough();
    advanceToStep3();
    // Footer button label is "Skip — go local-only"; the in-body
    // button is "Skip — stay local-only". Use the footer label to
    // disambiguate.
    fireEvent.click(screen.getByRole("button", { name: /skip.*go local-only/i }));
    expect(screen.getByTestId("onboarding-add-local")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-add-remote")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-browse-discover")).toBeInTheDocument();
    expect(screen.getByTestId("first-run-walkthrough")).toBeInTheDocument();
    expect(localStorage.getItem(ONBOARDING_KEY)).not.toBe("1");
  });

  it("step 4's Done button dismisses the walkthrough", () => {
    renderWalkthrough();
    advanceToStep4();
    // The Next button on step 4 is labelled "Done".
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe("1");
  });

  it("step 4 action buttons mount the local-create trigger without auto-dismissing", () => {
    renderWalkthrough();
    advanceToStep4();
    expect(screen.getByTestId("onboarding-add-local")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-add-remote")).toBeInTheDocument();
    // Clicking the local-create trigger does NOT auto-dismiss; the
    // user is still on step 4 (we verify by re-finding the action
    // buttons and the overlay test id).
    fireEvent.click(screen.getByTestId("onboarding-add-local"));
    expect(screen.getByTestId("first-run-walkthrough")).toBeInTheDocument();
  });
});
