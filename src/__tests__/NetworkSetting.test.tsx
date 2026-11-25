// Settings → Network (runtime ADR-125 D11): how this computer connects to
// your other computers, chosen once; Direct only says what stops first.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const statusMock = vi.fn();
const setMock = vi.fn();
vi.mock("../lib/api", () => ({
  networkStatus: () => statusMock(),
  networkSettingsSet: (change: unknown) => setMock(change),
  accountDevices: () => Promise.resolve({ devices: [], security: [], onList: true, runtime: "" }),
}));

import NetworkSetting from "../components/NetworkSetting";

const status = (over: Record<string, unknown> = {}) => ({
  connection: "pekohub",
  directWith: "mine",
  told: [],
  peers: [],
  directAddresses: [],
  directPeers: [],
  ...over,
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NetworkSetting />
    </QueryClientProvider>,
  );
}

describe("NetworkSetting", () => {
  beforeEach(() => {
    statusMock.mockReset();
    setMock.mockReset();
    localStorage.clear();
  });

  it("is PekoHub only by default, and Automatic says it will accept connections the first time", async () => {
    statusMock.mockResolvedValue(status());
    setMock.mockResolvedValue(status({ connection: "automatic", listening: "0.0.0.0:11438" }));
    wrap();
    await waitFor(() => expect((screen.getByTestId("network-pekohub") as HTMLInputElement).checked).toBe(true));
    expect(screen.queryByTestId("network-with")).toBeNull();
    fireEvent.click(screen.getByTestId("network-automatic"));
    expect(screen.getByTestId("network-confirm")).toHaveTextContent("accept connections");
    expect(setMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("network-confirm-yes"));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ connection: "automatic" }));
    await waitFor(() => expect(screen.getByTestId("network-with")).toBeInTheDocument());
  });

  it("asks before Direct only, saying what stops", async () => {
    statusMock.mockResolvedValue(status({ connection: "automatic" }));
    setMock.mockResolvedValue(status({ connection: "direct" }));
    localStorage.setItem("peko.network.listenNoticeSeen", "1");
    wrap();
    await waitFor(() => expect((screen.getByTestId("network-automatic") as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByTestId("network-direct"));
    const confirm = screen.getByTestId("network-confirm");
    expect(confirm).toHaveTextContent("phones");
    expect(confirm).toHaveTextContent("Web chat");
    expect(confirm).toHaveTextContent("other networks wait");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("network-confirm")).toBeNull();
    expect(setMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("network-direct"));
    fireEvent.click(screen.getByTestId("network-confirm-yes"));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ connection: "direct" }));
  });

  it("chooses who to link with, shows why it could not listen, and saves Advanced", async () => {
    statusMock.mockResolvedValue(
      status({
        connection: "automatic",
        listenError: "could not listen on 0.0.0.0:11438: Address in use",
        directPeers: ["10.0.0.12:11438"],
      }),
    );
    setMock.mockImplementation((change) =>
      Promise.resolve(status({ connection: "automatic", directPeers: ["10.0.0.12:11438"], ...change })),
    );
    wrap();
    expect(await screen.findByTestId("network-listen-error")).toHaveTextContent("Address in use");
    fireEvent.click(screen.getByTestId("network-with-people"));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith({ directWith: "people" }));

    expect(screen.queryByTestId("network-advanced")).toBeNull();
    fireEvent.click(screen.getByTestId("network-advanced-toggle"));
    expect((screen.getByTestId("network-try") as HTMLTextAreaElement).value).toBe("10.0.0.12:11438");
    fireEvent.change(screen.getByTestId("network-listen"), { target: { value: "10.0.0.5:11500" } });
    fireEvent.change(screen.getByTestId("network-tell"), { target: { value: "studio.ts.net:11500\n\n" } });
    fireEvent.click(screen.getByTestId("network-advanced-save"));
    await waitFor(() =>
      expect(setMock).toHaveBeenLastCalledWith({
        directListen: "10.0.0.5:11500",
        directAddresses: ["studio.ts.net:11500"],
        directPeers: ["10.0.0.12:11438"],
      }),
    );
  });
});
