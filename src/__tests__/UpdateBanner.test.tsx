// In-app updates: a quiet banner when a newer Peko Desktop exists, and a
// row under Settings → About to ask for one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type Status = { current: string; available: string | null; canInstall: boolean };
const checkMock = vi.fn(async (): Promise<Status> => ({ current: "0.1.5", available: null, canInstall: true }));
const installMock = vi.fn((): Promise<void> => new Promise(() => {}));
vi.mock("../lib/api", () => ({
  DOWNLOAD_PAGE_URL: "https://pekohub.ai/download",
  updateCheck: () => checkMock(),
  updateInstall: () => installMock(),
}));
const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrlMock(url) }));
let progress: ((event: { payload: { downloaded: number; total: number | null } }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: typeof progress) => {
    progress = handler;
    return () => {
      progress = null;
    };
  }),
}));

import UpdateBanner, { UpdateRow } from "../components/UpdateBanner";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const offer = (over: Partial<Status> = {}) =>
  checkMock.mockResolvedValue({ current: "0.1.5", available: "0.1.6", canInstall: true, ...over });

beforeEach(() => {
  localStorage.clear();
  checkMock.mockReset();
  checkMock.mockResolvedValue({ current: "0.1.5", available: null, canInstall: true });
  installMock.mockReset();
  installMock.mockImplementation(() => new Promise(() => {}));
  openUrlMock.mockClear();
  progress = null;
});

describe("UpdateBanner", () => {
  it("shows nothing when this is the newest version", async () => {
    wrap(<UpdateBanner />);
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("shows nothing when the check fails", async () => {
    checkMock.mockRejectedValue(new Error("Couldn't check for updates: offline"));
    wrap(<UpdateBanner />);
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("offers a newer version, without naming the engine", async () => {
    offer();
    wrap(<UpdateBanner />);
    const banner = await screen.findByTestId("update-banner");
    expect(banner).toHaveTextContent("Peko Desktop 0.1.6 is available");
    expect(banner.textContent).not.toMatch(/runtime|daemon|engine|sidecar/i);
    expect(screen.getByRole("button", { name: "Update and restart" })).toBeEnabled();
  });

  it("downloads with progress, then installs", async () => {
    offer();
    wrap(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Update and restart" }));
    expect(installMock).toHaveBeenCalledTimes(1);
    const button = await screen.findByRole("button", { name: "Downloading…" });
    expect(button).toBeDisabled();
    // No way to dismiss while it is under way.
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();

    await waitFor(() => expect(progress).not.toBeNull());
    act(() => progress?.({ payload: { downloaded: 250, total: 1000 } }));
    expect(screen.getByRole("button", { name: "Downloading… 25%" })).toBeDisabled();
    act(() => progress?.({ payload: { downloaded: 1000, total: 1000 } }));
    expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled();
  });

  it("points to the download page when the update doesn't go through", async () => {
    offer();
    installMock.mockRejectedValue(new Error("The update couldn't be installed"));
    wrap(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Update and restart" }));
    expect(await screen.findByText(/didn't go through/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open the download page/ }));
    expect(openUrlMock).toHaveBeenCalledWith("https://pekohub.ai/download");
  });

  it("links the download page where the app can't replace itself", async () => {
    offer({ canInstall: false });
    wrap(<UpdateBanner />);
    await screen.findByTestId("update-banner");
    expect(screen.queryByRole("button", { name: "Update and restart" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open the download page/ }));
    expect(openUrlMock).toHaveBeenCalledWith("https://pekohub.ai/download");
    expect(installMock).not.toHaveBeenCalled();
  });

  it("stays dismissed for that version and comes back for the next", async () => {
    offer();
    const first = wrap(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("update-banner")).toBeNull();
    first.unmount();

    wrap(<UpdateBanner />);
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("update-banner")).toBeNull();

    offer({ available: "0.1.7" });
    wrap(<UpdateBanner />);
    expect(await screen.findByTestId("update-banner")).toHaveTextContent("0.1.7");
  });
});

describe("Settings → About: updates", () => {
  it("says how a check went only once it was asked for", async () => {
    wrap(<UpdateRow />);
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("update-row")).toHaveTextContent("Updates");
    expect(screen.queryByText("You have the newest version.")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You have the newest version.")).toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it("says so when a check that was asked for fails", async () => {
    checkMock.mockRejectedValue(new Error("offline"));
    wrap(<UpdateRow />);
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Couldn't check for updates/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/Couldn't check for updates/)).toBeInTheDocument();
  });

  it("offers the newer version and installs it", async () => {
    offer();
    wrap(<UpdateRow />);
    expect(await screen.findByText("Version 0.1.6 is available.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(installMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Downloading…" })).toBeDisabled();
  });
});
