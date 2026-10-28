// First-run onboarding: connect a model → name your peko → say hello.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const principalsSignal: { value: unknown } = { value: [] };
const modelsSignal: { value: unknown; loading: boolean } = { value: [], loading: false };
const templatesSignal: { value: unknown } = { value: [] };

const createMock = vi.fn(async (_req: unknown) => ({ name: "nova" }));
const updateMock = vi.fn(async (_req: unknown) => ({}));
const addModelMock = vi.fn(async (_args: unknown) => ({ id: "anthropic-sonnet" }));
const testModelMock = vi.fn(async (_id: string) => ({ ok: true, message: "" }));

function mutation(fn: (arg: never) => Promise<unknown>) {
  return { mutateAsync: fn, isPending: false, error: null, reset: vi.fn() };
}

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({ data: principalsSignal.value, isLoading: false }),
  usePrincipalCreate: () => mutation(createMock as never),
  usePrincipalUpdate: () => mutation(updateMock as never),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsSignal.value, isLoading: modelsSignal.loading }),
  useModelTemplates: () => ({ data: templatesSignal.value, isLoading: false }),
  useAddModel: () => mutation(addModelMock as never),
  useTestModel: () => mutation(testModelMock as never),
}));
// The custom-endpoint dialog is the full Add Model flow, tested on its own.
vi.mock("../components/modals/AddModelModal", () => ({ default: () => null }));

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return { ...actual, useNavigate: () => navigateMock };
});

import FirstRunWalkthrough, { ONBOARDING_KEY, REPLAY_EVENT } from "../components/FirstRunWalkthrough";

const PRESETS = [
  {
    id: "anthropic",
    displayName: "Anthropic",
    apiType: "anthropic",
    baseUrl: "https://api.anthropic.com",
    requiresKey: true,
    defaultModel: "claude-sonnet-5-5",
    models: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }],
  },
  {
    id: "ollama",
    displayName: "Ollama",
    apiType: "openai",
    baseUrl: "http://localhost:11434/v1",
    requiresKey: false,
    defaultModel: "llama3",
    models: [{ id: "llama3" }],
  },
];

function renderWalkthrough() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FirstRunWalkthrough />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  principalsSignal.value = [];
  modelsSignal.value = [];
  modelsSignal.loading = false;
  templatesSignal.value = PRESETS;
  for (const m of [createMock, updateMock, addModelMock, testModelMock, navigateMock]) m.mockClear();
  testModelMock.mockImplementation(async () => ({ ok: true, message: "" }));
});

describe("visibility", () => {
  it("shows on a fresh profile with no pekos", () => {
    renderWalkthrough();
    expect(screen.getByTestId("first-run-walkthrough")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^onboarding-step-/)).toHaveLength(3);
  });

  it("stays hidden once dismissed, or when pekos exist", () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    const { unmount } = renderWalkthrough();
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
    unmount();
    localStorage.clear();
    principalsSignal.value = [{ name: "alice" }];
    renderWalkthrough();
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
  });

  it("Skip dismisses it for good; the replay event brings it back", async () => {
    renderWalkthrough();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe("1");
    window.dispatchEvent(new Event(REPLAY_EVENT));
    expect(await screen.findByTestId("first-run-walkthrough")).toBeInTheDocument();
  });
});

describe("step 1: connect a model", () => {
  it("adds the provider's default model with the pasted key, tests it, and moves on", async () => {
    renderWalkthrough();
    const connect = screen.getByRole("button", { name: /connect/i });
    expect(connect).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /anthropic/i }));
    expect(connect).toBeDisabled(); // a key is required
    fireEvent.change(screen.getByPlaceholderText("Paste your key"), {
      target: { value: " sk-test " },
    });
    fireEvent.click(connect);
    await waitFor(() =>
      expect(addModelMock).toHaveBeenCalledWith({
        template: "anthropic",
        custom: false,
        model: ["claude-sonnet-5-5"],
        key: "sk-test",
      }),
    );
    expect(testModelMock).toHaveBeenCalledWith("anthropic-sonnet");
    expect(await screen.findByRole("heading", { name: "Name your peko" })).toBeInTheDocument();
  });

  it("keeps the model choice under Advanced", async () => {
    renderWalkthrough();
    fireEvent.click(screen.getByRole("button", { name: /anthropic/i }));
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "claude-haiku-5-5" } });
    fireEvent.change(screen.getByPlaceholderText("Paste your key"), { target: { value: "k" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(addModelMock.mock.calls[0][0]).toMatchObject({ model: ["claude-haiku-5-5"] }),
    );
  });

  it("needs no key for a local provider", () => {
    renderWalkthrough();
    fireEvent.click(screen.getByRole("button", { name: /ollama/i }));
    expect(screen.queryByPlaceholderText("Paste your key")).toBeNull();
    expect(screen.getByRole("button", { name: /connect/i })).toBeEnabled();
  });

  it("says when the model can't be reached, and lets you continue anyway", async () => {
    testModelMock.mockImplementation(async () => ({ ok: false, message: "401 invalid x-api-key" }));
    renderWalkthrough();
    fireEvent.click(screen.getByRole("button", { name: /anthropic/i }));
    fireEvent.change(screen.getByPlaceholderText("Paste your key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    const error = await screen.findByTestId("onboarding-model-error");
    expect(error).toHaveTextContent("401 invalid x-api-key");
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    expect(await screen.findByRole("heading", { name: "Name your peko" })).toBeInTheDocument();
  });

  it("offers models already set up instead of asking for a key", () => {
    modelsSignal.value = [
      { id: "fast", displayName: "Fast", enabled: true },
      { id: "off", displayName: "Off", enabled: false },
    ];
    renderWalkthrough();
    expect(screen.getByRole("option", { name: "Fast" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Off" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("heading", { name: "Name your peko" })).toBeInTheDocument();
  });
});

/** Get to step 2 with an existing model. */
function toStep2() {
  modelsSignal.value = [{ id: "fast", displayName: "Fast", enabled: true }];
  renderWalkthrough();
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("step 2: name and avatar", () => {
  it("creates the peko with the model, then saves its avatar", async () => {
    toStep2();
    fireEvent.change(screen.getByRole("textbox", { name: /name/i }), { target: { value: "juno" } });
    fireEvent.click(screen.getByRole("button", { name: "Use 🦉" }));
    fireEvent.click(screen.getByRole("button", { name: /create juno/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "juno", modelId: "fast" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ name: "juno", avatar: "🦉" }));
    expect(await screen.findByRole("heading", { name: "Say hello" })).toBeInTheDocument();
  });

  it("refuses unsafe and taken names", () => {
    principalsSignal.value = [];
    toStep2();
    const name = screen.getByRole("textbox", { name: /name/i });
    fireEvent.change(name, { target: { value: "../etc" } });
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
    fireEvent.change(name, { target: { value: "ok-name" } });
    expect(screen.getByRole("button", { name: /create ok-name/i })).toBeEnabled();
  });

  it("keeps the description under Advanced", async () => {
    toStep2();
    expect(screen.queryByPlaceholderText(/what this peko is for/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByPlaceholderText(/what this peko is for/i), {
      target: { value: "Plans my week" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() =>
      expect(createMock.mock.calls[0][0]).toMatchObject({ description: "Plans my week" }),
    );
  });
});

describe("step 3: say hello", () => {
  async function toStep3() {
    toStep2();
    fireEvent.click(screen.getByRole("button", { name: /create nova/i }));
    await screen.findByRole("heading", { name: "Say hello" });
  }

  it("opens the chat with the first message to send", async () => {
    await toStep3();
    fireEvent.click(screen.getByRole("button", { name: "Help me plan my week." }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/chat/$pekoName",
      params: { pekoName: "nova" },
      search: { say: "Help me plan my week." },
    });
    expect(screen.queryByTestId("first-run-walkthrough")).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe("1");
  });

  it("can open the chat without a message", async () => {
    await toStep3();
    fireEvent.click(screen.getByRole("button", { name: /without a message/i }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/chat/$pekoName",
      params: { pekoName: "nova" },
      search: {},
    });
  });
});
