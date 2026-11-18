// Runtime ADR-111: your account's devices, in Settings.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const accountDevicesMock = vi.fn();
const deviceAddMock = vi.fn();
const deviceJoinMock = vi.fn();
const deviceRemoveMock = vi.fn();
const securityDecideMock = vi.fn();
vi.mock("../lib/api", () => ({
  accountDevices: () => accountDevicesMock(),
  deviceAdd: () => deviceAddMock(),
  deviceJoin: (code: string) => deviceJoinMock(code),
  deviceRemove: (id: string) => deviceRemoveMock(id),
  securityDecide: (id: string, approve: boolean) => securityDecideMock(id, approve),
}));

import AccountDevices from "../components/AccountDevices";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const desk = {
  id: "did:key:zDesk",
  kind: "computer" as const,
  name: "Desk",
  addedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  addedBy: "did:key:zDesk",
  this: true,
};
const phone = {
  id: "did:key:zPhone",
  kind: "phone" as const,
  name: "Mira's iPhone",
  hubDeviceId: "dev_a1",
  addedAt: new Date().toISOString(),
  addedBy: "did:key:zDesk",
  this: false,
  lastSeen: new Date(Date.now() - 5 * 60_000).toISOString(),
};
const view = (over: Record<string, unknown> = {}) => ({
  account: "user:hub:alice",
  runtime: desk.id,
  onList: true,
  devices: [desk],
  security: [],
  ...over,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountDevices />
    </QueryClientProvider>,
  );
}

describe("AccountDevices", () => {
  beforeEach(() => {
    for (const m of [accountDevicesMock, deviceAddMock, deviceJoinMock, deviceRemoveMock, securityDecideMock]) {
      m.mockReset();
    }
  });

  it("lists the account's devices and shows a code that adds one", async () => {
    accountDevicesMock.mockResolvedValue(view());
    deviceAddMock.mockResolvedValue({ code: "K7DX-KQ7R-MTPZ", svg: SVG, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    renderCard();
    expect(await screen.findByTestId(`device-${desk.id}`)).toHaveTextContent("Desk");
    expect(screen.getByTestId(`device-${desk.id}`)).toHaveTextContent("this computer");
    fireEvent.click(screen.getByTestId("account-devices-add"));
    expect(await screen.findByTestId("account-devices-code-text")).toHaveTextContent("K7DX-KQ7R-MTPZ");

    // The phone joins: the code goes away and says who joined.
    accountDevicesMock.mockResolvedValue(view({ devices: [desk, phone] }));
    await waitFor(() => expect(screen.getByTestId("account-devices-joined")).toHaveTextContent("Mira's iPhone"), {
      timeout: 4000,
    });
    expect(screen.queryByTestId("account-devices-code-shown")).toBeNull();
  });

  it("joins this computer with a code when it is not on the list yet", async () => {
    accountDevicesMock.mockResolvedValue(view({ onList: false }));
    deviceJoinMock.mockResolvedValue(view({ devices: [desk, phone] }));
    renderCard();
    const box = await screen.findByTestId("account-devices-code");
    expect(screen.queryByTestId("account-devices-add")).toBeNull();
    fireEvent.change(box, { target: { value: "k7dx-kq7r-mtpz" } });
    fireEvent.click(screen.getByTestId("account-devices-join-go"));
    await waitFor(() => expect(deviceJoinMock).toHaveBeenCalledWith("k7dx-kq7r-mtpz"));
  });

  it("removes a device after asking", async () => {
    accountDevicesMock.mockResolvedValue(view({ devices: [desk, phone] }));
    deviceRemoveMock.mockResolvedValue(view());
    renderCard();
    fireEvent.click(await screen.findByTestId(`device-remove-${phone.id}`));
    fireEvent.click(screen.getByTestId(`device-confirm-remove-${phone.id}`));
    await waitFor(() => expect(deviceRemoveMock).toHaveBeenCalledWith(phone.id));
    await waitFor(() => expect(screen.queryByTestId(`device-${phone.id}`)).toBeNull());
  });

  it("decides what waits about the account, once", async () => {
    const item = {
      id: "apr_keychange0123",
      kind: "key_change",
      summary: "PekoHub says ada has a new identity. Use it?",
      reason: "",
      createdAt: new Date().toISOString(),
    };
    accountDevicesMock.mockResolvedValue(view({ security: [item] }));
    securityDecideMock.mockResolvedValue("Kept ada's old identity.");
    renderCard();
    expect(await screen.findByTestId(`security-${item.id}`)).toHaveTextContent("ada has a new identity");
    fireEvent.click(screen.getByTestId(`security-deny-${item.id}`));
    await waitFor(() => expect(securityDecideMock).toHaveBeenCalledWith(item.id, false));
    expect(await screen.findByText("Kept ada's old identity.")).toBeInTheDocument();
  });

  it("says to sign in first", async () => {
    accountDevicesMock.mockResolvedValue(view({ account: null, onList: false, devices: [] }));
    renderCard();
    expect(await screen.findByTestId("account-devices-signed-out")).toBeInTheDocument();
  });
});
