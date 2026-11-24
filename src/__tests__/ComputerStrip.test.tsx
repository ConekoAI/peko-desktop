// While a peko uses this computer (runtime ADR-123), a strip shows which
// one, what it does, Stop, and when your hand paused it, Let it continue.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const resume = vi.fn(() => Promise.resolve({}));
const stop = vi.fn(() => Promise.resolve({}));
vi.mock("../lib/api", () => ({
  computerResume: () => resume(),
  computerStop: () => stop(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

import ComputerStrip from "../components/ComputerStrip";

describe("ComputerStrip", () => {
  beforeEach(() => {
    resume.mockClear();
    stop.mockClear();
  });

  it("names the peko and what it does, and Stop stops it", () => {
    render(<ComputerStrip initial={{ peko: "mochi", action: "clicking in Peko", paused: false }} />);
    expect(screen.getByTestId("computer-strip").textContent).toContain("mochi is using this computer");
    expect(screen.getByTestId("computer-strip").textContent).toContain("clicking in Peko");
    expect(screen.queryByTestId("computer-continue")).toBeNull();
    fireEvent.click(screen.getByTestId("computer-stop"));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("offers Let it continue while paused", () => {
    render(<ComputerStrip initial={{ peko: "mochi", action: null, paused: true }} />);
    expect(screen.getByTestId("computer-strip").textContent).toContain("mochi is paused");
    fireEvent.click(screen.getByTestId("computer-continue"));
    expect(resume).toHaveBeenCalledOnce();
  });
});
