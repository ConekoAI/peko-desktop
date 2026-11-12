// A peko's first turn, above its conversation: what it has done, a Stop
// button, and its own report afterwards.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { SetupStatus } from "../lib/api";

const statusSignal: { value: SetupStatus | null | undefined } = { value: undefined };
const stopMock = vi.fn();
const stopState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

vi.mock("../hooks/useSetup", () => ({
  useSetupStatus: () => ({ data: statusSignal.value }),
  useStopSetup: () => ({ mutate: stopMock, ...stopState }),
}));

import SetupPanel from "../components/peko/SetupPanel";

const working: SetupStatus = {
  settingUp: true,
  running: true,
  setup: ["Install ripgrep"],
  steps: [
    { callId: "c1", tool: "Fetch", line: "Fetch: https://example.com/rg", outcome: "ok" },
    { callId: "c2", tool: "Bash", line: "Bash: brew install ripgrep", outcome: null },
  ],
  report: null,
};

beforeEach(() => {
  stopMock.mockClear();
  stopState.isPending = false;
  stopState.error = null;
  statusSignal.value = undefined;
  localStorage.clear();
});

describe("SetupPanel", () => {
  it("shows nothing for a peko that is set up and has no report", () => {
    statusSignal.value = { settingUp: false, running: false, setup: [], steps: [], report: null };
    const { container } = render(<SetupPanel name="ada" />);
    expect(container).toBeEmptyDOMElement();
    statusSignal.value = null;
    expect(render(<SetupPanel name="ada" />).container).toBeEmptyDOMElement();
  });

  it("lists what the peko has done so far and stops it on request", () => {
    statusSignal.value = working;
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-panel")).toHaveTextContent("ada is setting itself up");
    expect(screen.getAllByTestId("setup-step").map((s) => s.textContent)).toEqual([
      "Fetch: https://example.com/rg",
      "Bash: brew install ripgrep",
    ]);
    fireEvent.click(screen.getByTestId("setup-stop"));
    expect(stopMock).toHaveBeenCalledWith({ name: "ada", runtimeId: undefined });
  });

  it("offers no Stop when nothing is running, and says when nothing has happened yet", () => {
    statusSignal.value = { ...working, running: false, steps: [] };
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-stop")).toBeDisabled();
    expect(screen.getByTestId("setup-panel")).toHaveTextContent(/nothing yet/i);
  });

  it("shows the peko's report once it is set up, until it is hidden", () => {
    statusSignal.value = {
      settingUp: false,
      running: false,
      setup: ["Install ripgrep"],
      steps: [],
      report: "- ripgrep: ready (`rg --version`)",
    };
    const { unmount } = render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-report")).toHaveTextContent("ripgrep: ready");
    expect(screen.queryByTestId("setup-stop")).toBeNull();
    fireEvent.click(screen.getByTestId("setup-hide"));
    expect(screen.queryByTestId("setup-panel")).toBeNull();
    unmount();
    // Hidden stays hidden for that peko, and only for that peko.
    expect(render(<SetupPanel name="ada" />).container).toBeEmptyDOMElement();
    render(<SetupPanel name="bea" />);
    expect(screen.getByTestId("setup-report")).toBeInTheDocument();
  });

  it("says so when stopping fails", () => {
    statusSignal.value = working;
    stopState.error = new Error("Couldn't stop the peko");
    render(<SetupPanel name="ada" />);
    expect(screen.getByTestId("setup-panel")).toHaveTextContent("Couldn't stop the peko");
  });
});
