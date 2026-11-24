// A peko may use this computer unless you turn it off (runtime ADR-123,
// `[computer] enabled`); on macOS the two permissions show with a button
// that asks for them.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const settingsState: { data: { key: string; value: string }[] | undefined } = { data: [] };
const mutate = vi.fn();
vi.mock("../hooks/useSettings", () => ({
  useSettings: () => settingsState,
  useSetSetting: () => ({ mutate, isPending: false, error: null }),
}));
const setup = vi.fn(() => Promise.resolve({}));
vi.mock("../lib/api", () => ({
  computerStatus: () =>
    Promise.resolve({
      available: true,
      permissions: {
        screen_recording: false,
        accessibility: true,
        responsible_app: "/Applications/Peko Desktop.app",
      },
    }),
  computerSetup: () => setup(),
  computerStopShortcut: () => Promise.resolve("⌃⌥⇧⎋"),
}));

import ComputerSetting from "../components/ComputerSetting";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ComputerSetting", () => {
  beforeEach(() => {
    mutate.mockReset();
    setup.mockClear();
  });

  it("is on unless turned off, and writes the engine's setting", () => {
    settingsState.data = [];
    wrap(<ComputerSetting />);
    const toggle = screen.getByTestId("computer-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(mutate.mock.calls[0][0]).toEqual({ key: "computer.enabled", value: "false" });
  });

  it("shows the macOS permissions and asks for the missing one", async () => {
    settingsState.data = [];
    wrap(<ComputerSetting />);
    const perms = await screen.findByTestId("computer-permissions");
    expect(perms.textContent).toContain("Peko Desktop.app");
    expect(perms.textContent).toContain("Not granted");
    fireEvent.click(screen.getByTestId("computer-ask"));
    await waitFor(() => expect(setup).toHaveBeenCalledOnce());
  });
});
