// macOS draws its own window buttons (overlay title bar); other
// platforms get ours.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));

async function renderWithUserAgent(ua: string) {
  vi.stubGlobal("navigator", { ...navigator, userAgent: ua });
  vi.resetModules();
  const { default: TitleBar } = await import("../components/TitleBar");
  return render(<TitleBar />);
}

afterEach(() => vi.unstubAllGlobals());

describe("TitleBar", () => {
  it("leaves the window buttons to macOS", async () => {
    await renderWithUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    expect(screen.queryByTitle("Close")).toBeNull();
    expect(screen.getByText("Peko")).toBeInTheDocument();
  });

  it("draws its own window buttons elsewhere", async () => {
    await renderWithUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(screen.getByTitle("Close")).toBeInTheDocument();
    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
  });
});
