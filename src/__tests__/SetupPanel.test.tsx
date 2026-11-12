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

import SetupPanel from "../components/peko/SetupPanel";

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
  stopState.isPending = false;
  stopState.error = null;
  runState.isPending = false;
  runState.error = null;
  statusSignal.value = undefined;
  localStorage.clear();
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
