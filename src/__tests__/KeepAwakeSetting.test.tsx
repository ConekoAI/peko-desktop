// The engine keeps its computer awake while a peko works unless you turn
// it off (runtime `power.keep_awake`, on by default).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const settingsState: { data: { key: string; value: string }[] | undefined } = { data: [] };
const mutate = vi.fn();
vi.mock("../hooks/useSettings", () => ({
  useSettings: () => settingsState,
  useSetSetting: () => ({ mutate, isPending: false, error: null }),
}));

import KeepAwakeSetting from "../components/KeepAwakeSetting";

describe("KeepAwakeSetting", () => {
  beforeEach(() => mutate.mockReset());

  it("is on unless turned off, and writes the engine's setting", () => {
    settingsState.data = [];
    const { unmount } = render(<KeepAwakeSetting />);
    const toggle = screen.getByTestId("keep-awake-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(mutate.mock.calls[0][0]).toEqual({ key: "power.keep_awake", value: "false" });
    unmount();

    settingsState.data = [{ key: "power.keep_awake", value: "false" }];
    render(<KeepAwakeSetting />);
    expect((screen.getByTestId("keep-awake-toggle") as HTMLInputElement).checked).toBe(false);
  });
});
