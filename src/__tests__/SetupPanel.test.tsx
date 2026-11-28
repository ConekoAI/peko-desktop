// A peko's first turn and its setup steps, above its conversation: what
// it is doing with a Stop button, then each step's result with Try again.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { SetupStatus } from "../lib/api";

const statusSignal: { value: SetupStatus | null | undefined } = { value: undefined };
const stopMock = vi.fn();
const runMock = vi.fn();
const stopState: { isPending: boolean; error: unknown } = { isPending: false, error: null };
const runState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

vi.mock("../hooks/useSetup", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useSetup")>("../hooks/useSetup");
  return {
    isSettingUp: actual.isSettingUp,
    useSetupStatus: () => ({ data: statusSignal.value }),
    useStopSetup: () => ({ mutate: stopMock, ...stopState }),
    useRunSetup: () => ({ mutate: runMock, ...runState }),
  };
});

const updateMock = vi.fn();
const modelsSignal: { value: Array<{ id: string; displayName: string; enabled: boolean }> } = {
  value: [],
};
vi.mock("../hooks/usePrincipals", () => ({
  usePrincipalUpdate: () => ({ mutate: updateMock, isPending: false, error: null }),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsSignal.value }),
}));

import SetupPanel from "../components/peko/SetupPanel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderPanel(name = "pip") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SetupPanel name={name} />
    </QueryClientProvider>,
  );
}

const none: SetupStatus = {
  settingUp: false,
  running: false,
  setup: [],
  steps: [],
  report: null,
  setupState: "none",
  results: [],
};

const firstTurn: SetupStatus = {
  ...none,
  settingUp: true,
  running: true,
  setup: ["Install ripgrep"],
  steps: [
    { callId: "c1", tool: "Read", line: "Read: peko.toml", outcome: "ok" },
    { callId: "c2", tool: "Write", line: "Write: kb/index.md", outcome: null },
  ],
  setupState: "pending",
  results: [{ step: "Install ripgrep", status: "pending", note: null }],
};

const finished: SetupStatus = {
  ...none,
  setup: ["Install ripgrep", "Add Playwright"],
  setupState: "done",
  results: [
    { step: "Install ripgrep", status: "ready", note: "`rg --version` prints 14.1.0" },
    { step: "Add Playwright", status: "failed", note: "Node is missing; run `brew install node`" },
  ],
};

beforeEach(() => {
  stopMock.mockClear();
  runMock.mockClear();
  updateMock.mockClear();
  modelsSignal.value = [
    { id: "gpt-6.2-sol", displayName: "GPT-6.2-Sol", enabled: true },
    { id: "old-off", displayName: "Old", enabled: false },
    { id: "claude-haiku-5-5", displayName: "Claude Haiku", enabled: true },
  ];
  stopState.isPending = false;
  stopState.error = null;
  runState.isPending = false;
  runState.error = null;
  statusSignal.value = undefined;
  localStorage.clear();
});

describe("a first turn that can't go on", () => {
  // Field report (2026-11-28): a peko set to a model since removed sat at
  // "setting itself up… Nothing yet" for good, with nothing saying why.
  const stuck: SetupStatus = {
    ...none,
    settingUp: true,
    running: false,
    firstTurnError: "no model configured for this call",
    missingModel: "mimo-v2.6-flash",
  };

  it("says its model is gone and sets the one you pick", () => {
    statusSignal.value = stuck;
    renderPanel();
    expect(screen.getByTestId("setup-stuck")).toHaveTextContent(
      "pip needs a model to set itself up",
    );
    expect(screen.getByTestId("setup-stuck-reason")).toHaveTextContent(
      "pip is set to mimo-v2.6-flash, which isn't on this computer any more",
    );
    expect(screen.queryByText(/Nothing yet/)).toBeNull();
    expect(screen.queryByTestId("setup-stop")).toBeNull();
    // Only models that are turned on are offered.
    const select = screen.getByTestId("setup-model") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["gpt-6.2-sol", "claude-haiku-5-5"]);
    fireEvent.change(select, { target: { value: "claude-haiku-5-5" } });
    fireEvent.click(screen.getByTestId("setup-use-model"));
    expect(updateMock).toHaveBeenCalledWith(
      { name: "pip", preferredModelId: "claude-haiku-5-5", runtimeId: undefined },
      expect.anything(),
    );
  });

  it("says when it is set to no model", () => {
    statusSignal.value = { ...stuck, missingModel: "" };
    renderPanel();
    expect(screen.getByTestId("setup-stuck-reason")).toHaveTextContent(
      "pip isn't set to a model",
    );
  });

  it("points to Settings when this computer has no models", () => {
    statusSignal.value = stuck;
    modelsSignal.value = [];
    renderPanel();
    expect(screen.getByTestId("setup-stuck")).toHaveTextContent("Add one in Settings");
    expect(screen.queryByTestId("setup-use-model")).toBeNull();
  });

  it("shows another failure and tries again", () => {
    statusSignal.value = { ...stuck, missingModel: null, firstTurnError: "rate limited" };
    renderPanel();
    expect(screen.getByTestId("setup-stuck")).toHaveTextContent(
      "pip couldn't finish setting itself up",
    );
    expect(screen.getByTestId("setup-stuck-reason")).toHaveTextContent(
      "Its first turn failed: rate limited",
    );
    fireEvent.click(screen.getByTestId("setup-first-turn-retry"));
    expect(runMock).toHaveBeenCalledWith({ name: "pip", runtimeId: undefined });
  });

  it("is not stuck while its first turn runs", () => {
    statusSignal.value = { ...firstTurn, missingModel: "mimo-v2.6-flash" };
    renderPanel();
    expect(screen.queryByTestId("setup-stuck")).toBeNull();
    expect(screen.getByTestId("setup-panel")).toBeTruthy();
  });
});

describe("SetupPanel", () => {
  it("shows nothing for a peko that is set up and has no setup steps", () => {
    statusSignal.value = none;
    expect(render(<SetupPanel name="ada" />).container).toBeEmptyDOMElement();
    statusSignal.value = null;
    expect(render(<SetupPanel name="ada" />).container).toBeEmptyDOMElement();
  });

  it("shows the first turn as it happens and stops it on request", () => {
    statusSignal.value = firstTurn;
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-panel")).toHaveTextContent("ada is setting itself up");
    expect(screen.getAllByTestId("setup-step").map((s) => s.textContent)).toEqual([
      "Read: peko.toml",
      "Write: kb/index.md",
    ]);
    // The setup steps are listed, not done yet.
    expect(screen.getByTestId("setup-result")).toHaveAttribute("data-status", "pending");
    expect(screen.queryByTestId("setup-retry")).toBeNull();
    fireEvent.click(screen.getByTestId("setup-stop"));
    expect(stopMock).toHaveBeenCalledWith({ name: "ada", runtimeId: undefined });
  });

  it("says when the peko has moved on to its setup steps", () => {
    statusSignal.value = { ...firstTurn, settingUp: false, setupState: "running", steps: [] };
    render(<SetupPanel name="ada" />);
    const panel = screen.getByTestId("setup-panel");
    expect(panel).toHaveTextContent("ada is going through its setup steps");
    expect(panel).toHaveTextContent(/nothing yet/i);
    expect(screen.getByTestId("setup-stop")).toBeEnabled();
  });

  it("offers no Stop when nothing is running", () => {
    statusSignal.value = { ...firstTurn, running: false };
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-stop")).toBeDisabled();
  });

  it("shows each step's result and has the peko try again", () => {
    statusSignal.value = finished;
    render(<SetupPanel name="ada" />);
    const rows = screen.getAllByTestId("setup-result");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["ready", "failed"]);
    expect(rows[0]).toHaveTextContent("Install ripgrep");
    expect(rows[0]).toHaveTextContent("`rg --version` prints 14.1.0");
    expect(rows[1]).toHaveTextContent("Node is missing; run `brew install node`");
    expect(screen.getByLabelText("Ready")).toBeInTheDocument();
    expect(screen.getByLabelText("This step failed")).toBeInTheDocument();
    expect(screen.queryByTestId("setup-stop")).toBeNull();

    fireEvent.click(screen.getByTestId("setup-retry"));
    expect(runMock).toHaveBeenCalledWith({ name: "ada", runtimeId: undefined });
  });

  it("offers no retry when every step is ready", () => {
    statusSignal.value = {
      ...finished,
      results: finished.results.map((r) => ({ ...r, status: "ready" })),
    };
    render(<SetupPanel name="ada" />);
    expect(screen.queryByTestId("setup-retry")).toBeNull();
    expect(screen.getByTestId("setup-hide")).toBeInTheDocument();
  });

  it("stays hidden once hidden, for that peko only, until it works again", () => {
    statusSignal.value = finished;
    const { unmount } = render(<SetupPanel name="ada" />);
    fireEvent.click(screen.getByTestId("setup-hide"));
    expect(screen.queryByTestId("setup-panel")).toBeNull();
    unmount();
    expect(render(<SetupPanel name="ada" />).container).toBeEmptyDOMElement();
    const other = render(<SetupPanel name="bea" />);
    expect(screen.getByTestId("setup-panel")).toBeInTheDocument();
    other.unmount();
    // A setup turn in flight is shown whatever was hidden.
    statusSignal.value = { ...finished, setupState: "running", running: true };
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-panel")).toHaveTextContent("going through its setup steps");
  });

  it("falls back to the peko's own report from an engine without step results", () => {
    statusSignal.value = {
      ...none,
      setup: ["Install ripgrep"],
      report: "- ripgrep: ready (`rg --version`)",
      setupState: "",
    };
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-report")).toHaveTextContent("ripgrep: ready");
    expect(screen.queryByTestId("setup-result")).toBeNull();
  });

  it("says so when stopping or starting again fails", () => {
    statusSignal.value = firstTurn;
    stopState.error = new Error("Couldn't stop the peko");
    const first = render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-panel")).toHaveTextContent("Couldn't stop the peko");
    first.unmount();
    stopState.error = null;
    statusSignal.value = finished;
    runState.error = "a setup turn is already scheduled";
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-panel")).toHaveTextContent("already scheduled");
  });
});
