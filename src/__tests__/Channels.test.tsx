// src/__tests__/Channels.test.tsx
//
// PR-1 / P1.7 polish: render coverage for the channels landing page.
// Validates the in-app "+ New channel" CTA + the `?newChannel=1`
// query-param dispatch path. Layout-level modal wiring is covered
// end-to-end by `Layout.test.tsx`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSearch } from "@tanstack/react-router";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useSearch: vi.fn(),
  };
});

import Channels from "../pages/Channels";

function renderPage(initialSearch: Record<string, string> = {}) {
  // Mock `useSearch` so the test can drive the query-param branch.
  (useSearch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(initialSearch);
  return render(<Channels />);
}

describe("Channels landing page", () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (useSearch as unknown as ReturnType<typeof vi.fn>).mockReset();
    dispatchSpy = vi.spyOn(window, "dispatchEvent");
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it("renders the in-app New channel CTA", () => {
    renderPage();
    const cta = screen.getByTestId("channels-empty-new-button");
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveTextContent(/New channel/);
  });

  it("clicking the CTA emits peko:open-channel-create", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("channels-empty-new-button"));
    expect(dispatchSpy).toHaveBeenCalled();
    const event = dispatchSpy.mock.calls.find(
      (c: unknown[]) => c[0] instanceof CustomEvent && (c[0] as CustomEvent).type === "peko:open-channel-create",
    );
    expect(event).toBeTruthy();
  });

  it("auto-opens the modal when ?newChannel=1 is present", () => {
    renderPage({ newChannel: "1" });
    expect(dispatchSpy).toHaveBeenCalled();
    const event = dispatchSpy.mock.calls.find(
      (c: unknown[]) => c[0] instanceof CustomEvent && (c[0] as CustomEvent).type === "peko:open-channel-create",
    );
    expect(event).toBeTruthy();
  });

  it("doesn't auto-open when ?newChannel is absent", () => {
    renderPage();
    const event = dispatchSpy.mock.calls.find(
      (c: unknown[]) => c[0] instanceof CustomEvent && (c[0] as CustomEvent).type === "peko:open-channel-create",
    );
    expect(event).toBeFalsy();
  });
});