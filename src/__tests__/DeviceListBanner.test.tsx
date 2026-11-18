// Runtime ADR-111: a computer signed in but not on its account's devices
// says so above every page, and goes to where it joins.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const accountDevicesMock = vi.fn();
const identityCodeMock = vi.fn();
vi.mock("../lib/api", () => ({
  accountDevices: () => accountDevicesMock(),
  identityCode: (of: string) => identityCodeMock(of),
}));
const navigateMock = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

import DeviceListBanner from "../components/DeviceListBanner";
import { IdentityCodeRow } from "../components/IdentityCode";

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const base = { runtime: "did:key:zDesk", devices: [], security: [] };

describe("DeviceListBanner", () => {
  beforeEach(() => {
    accountDevicesMock.mockReset();
    navigateMock.mockClear();
  });

  it("asks a signed-in computer that is not on the list to join, and goes there", async () => {
    accountDevicesMock.mockResolvedValue({ ...base, account: "user:hub:a", onList: false });
    wrap(<DeviceListBanner />);
    fireEvent.click(await screen.findByTestId("device-list-banner-join"));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings", hash: "devices" });
  });

  it("says nothing once it is on the list, or before it signs in", async () => {
    accountDevicesMock.mockResolvedValue({ ...base, account: "user:hub:a", onList: true });
    const { unmount } = wrap(<DeviceListBanner />);
    await vi.waitFor(() => expect(accountDevicesMock).toHaveBeenCalled());
    expect(screen.queryByTestId("device-list-banner")).toBeNull();
    unmount();
    accountDevicesMock.mockResolvedValue({ ...base, account: null, onList: false });
    wrap(<DeviceListBanner />);
    await vi.waitFor(() => expect(accountDevicesMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("device-list-banner")).toBeNull();
  });
});

describe("IdentityCodeRow (runtime ADR-112)", () => {
  it("shows the code this computer holds, or says it has met none", async () => {
    identityCodeMock.mockResolvedValueOnce({ of: "peko:hub:h1", code: "10000 20000 30000 40000 50000 60000" });
    const { unmount } = wrap(<IdentityCodeRow of="peko:hub:h1" label="Code" testId="c" />);
    expect(await screen.findByTestId("c-value")).toHaveTextContent("10000 20000 30000 40000 50000 60000");
    expect(identityCodeMock).toHaveBeenCalledWith("peko:hub:h1");
    unmount();
    identityCodeMock.mockResolvedValueOnce({ of: "peko:hub:h2" });
    wrap(<IdentityCodeRow of="peko:hub:h2" label="Code" unknown="Not met yet" testId="d" />);
    expect(await screen.findByTestId("d")).toHaveTextContent("Not met yet");
  });
});
