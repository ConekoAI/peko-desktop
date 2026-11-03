import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const usePekohubBundleMock = vi.fn();
vi.mock("../hooks/useRuntimes", () => ({
  usePekohubBundle: () => usePekohubBundleMock(),
}));
vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ data: [{ key: "pekohub.base_url", value: "https://api.pekohub.ai" }] }),
}));

const hubNotificationsMock = vi.fn();
const markReadMock = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  hubNotifications: (hub: string) => hubNotificationsMock(hub),
  markHubNotificationsRead: (hub: string, ids?: string[]) => markReadMock(hub, ids),
}));

const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrlMock(url) }));

import HubNotificationBell from "../components/HubNotificationBell";

const OFFER = {
  id: "n1",
  kind: "transfer.offered",
  text: "@alice offers you ada. Accept it to become its owner.",
  path: "/dashboard",
  url: "https://pekohub.ai/dashboard",
  createdAt: new Date().toISOString(),
  readAt: null,
};

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HubNotificationBell />
    </QueryClientProvider>,
  );
}

describe("HubNotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markReadMock.mockResolvedValue(undefined);
  });

  it("shows nothing while signed out of PekoHub", () => {
    usePekohubBundleMock.mockReturnValue({ data: null });
    renderBell();
    expect(screen.queryByRole("button", { name: /PekoHub notifications/ })).toBeNull();
    expect(hubNotificationsMock).not.toHaveBeenCalled();
  });

  it("counts unread, marks what it shows as read, and opens the page on the website", async () => {
    usePekohubBundleMock.mockReturnValue({ data: { access_token: "t" } });
    hubNotificationsMock.mockResolvedValue({ unread: 1, notifications: [OFFER] });
    renderBell();

    const bell = await screen.findByRole("button", { name: "PekoHub notifications, 1 unread" });
    expect(hubNotificationsMock).toHaveBeenCalledWith("https://api.pekohub.ai");
    fireEvent.click(bell);
    expect(screen.getByText(/@alice offers you ada/)).toBeTruthy();
    expect(markReadMock).toHaveBeenCalledWith("https://api.pekohub.ai", ["n1"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "PekoHub notifications" })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /@alice offers you ada/ }));
    expect(openUrlMock).toHaveBeenCalledWith("https://pekohub.ai/dashboard");
  });
});
