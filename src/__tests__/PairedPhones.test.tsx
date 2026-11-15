// Runtime ADR-108: pair, list and remove phones, in Settings.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pairedPhonesMock = vi.fn();
const phonePairStartMock = vi.fn();
const pairedPhoneRemoveMock = vi.fn();
vi.mock("../lib/api", () => ({
  pairedPhones: () => pairedPhonesMock(),
  phonePairStart: () => phonePairStartMock(),
  pairedPhoneRemove: (deviceId: string) => pairedPhoneRemoveMock(deviceId),
}));

import PairedPhones from "../components/PairedPhones";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const iphone = {
  deviceId: "dev_a1",
  name: "Mira's iPhone",
  platform: "ios",
  pairedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  lastSeen: new Date(Date.now() - 5 * 60_000).toISOString(),
};
const pixel = {
  deviceId: "dev_b2",
  name: "Pixel",
  platform: "android",
  pairedAt: new Date().toISOString(),
  lastSeen: null,
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PairedPhones />
    </QueryClientProvider>,
  );
}

function inTenMinutes() {
  return new Date(Date.now() + 10 * 60_000).toISOString();
}

describe("PairedPhones", () => {
  beforeEach(() => {
    pairedPhonesMock.mockReset();
    phonePairStartMock.mockReset();
    pairedPhoneRemoveMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says when no phone is paired", async () => {
    pairedPhonesMock.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByTestId("paired-phones-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("paired-phones-code")).toBeNull();
  });

  it("lists paired phones with when they were last used", async () => {
    pairedPhonesMock.mockResolvedValue([iphone, pixel]);
    renderCard();
    const first = await screen.findByTestId("phone-dev_a1");
    expect(first).toHaveTextContent("Mira's iPhone");
    expect(first).toHaveTextContent("iPhone");
    expect(first).toHaveTextContent("last used 5 minutes ago");
    expect(screen.getByTestId("phone-dev_b2")).toHaveTextContent("not used yet");
  });

  it("shows a code, and takes it away once a phone has scanned it", async () => {
    pairedPhonesMock.mockResolvedValue([iphone]);
    phonePairStartMock.mockResolvedValue({ svg: SVG, expiresAt: inTenMinutes() });
    renderCard();
    await screen.findByTestId("phone-dev_a1");
    fireEvent.click(screen.getByTestId("paired-phones-pair"));

    const code = await screen.findByTestId("paired-phones-code");
    const picture = code.querySelector("img")!;
    expect(picture.getAttribute("src")).toBe(`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`);
    expect(code).toHaveTextContent("Anyone who scans it can read and post as you");
    // The button that opens a code is gone while one is showing.
    expect(screen.queryByTestId("paired-phones-pair")).toBeNull();

    // The phone scans it: the next look at the list has one more.
    pairedPhonesMock.mockResolvedValue([iphone, pixel]);
    await waitFor(() => expect(screen.queryByTestId("paired-phones-code")).toBeNull(), {
      timeout: 5000,
    });
    expect(screen.getByTestId("paired-phones-done")).toHaveTextContent("Pixel is paired.");
    expect(screen.getByTestId("phone-dev_b2")).toBeInTheDocument();

    // Removing it takes the "is paired" line away too.
    pairedPhoneRemoveMock.mockResolvedValue([iphone]);
    pairedPhonesMock.mockResolvedValue([iphone]);
    fireEvent.click(screen.getByTestId("phone-remove-dev_b2"));
    fireEvent.click(screen.getByTestId("phone-confirm-remove-dev_b2"));
    await waitFor(() => expect(screen.queryByTestId("phone-dev_b2")).toBeNull());
    expect(screen.queryByTestId("paired-phones-done")).toBeNull();
  }, 10_000);

  it("hides the code when asked, and when it expires", async () => {
    pairedPhonesMock.mockResolvedValue([]);
    phonePairStartMock.mockResolvedValue({ svg: SVG, expiresAt: inTenMinutes() });
    renderCard();
    fireEvent.click(await screen.findByTestId("paired-phones-pair"));
    await screen.findByTestId("paired-phones-code");
    fireEvent.click(screen.getByTestId("paired-phones-hide"));
    expect(screen.queryByTestId("paired-phones-code")).toBeNull();
    expect(screen.queryByTestId("paired-phones-expired")).toBeNull();

    // A code that runs out says so and offers another.
    phonePairStartMock.mockResolvedValue({
      svg: SVG,
      expiresAt: new Date(Date.now() + 300).toISOString(),
    });
    fireEvent.click(screen.getByTestId("paired-phones-pair"));
    await screen.findByTestId("paired-phones-code");
    expect(await screen.findByTestId("paired-phones-expired", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("paired-phones-code")).toBeNull();
    expect(screen.getByTestId("paired-phones-pair")).toBeInTheDocument();
  });

  it("asks you to sign in when this computer is not on PekoHub", async () => {
    pairedPhonesMock.mockResolvedValue([]);
    phonePairStartMock.mockRejectedValue("not_signed_in");
    renderCard();
    fireEvent.click(await screen.findByTestId("paired-phones-pair"));
    expect(await screen.findByTestId("paired-phones-error")).toHaveTextContent(
      "Sign in to PekoHub first",
    );
    expect(screen.queryByTestId("paired-phones-code")).toBeNull();
  });

  it("removes a phone only after you confirm", async () => {
    pairedPhonesMock.mockResolvedValue([iphone, pixel]);
    pairedPhoneRemoveMock.mockResolvedValue([pixel]);
    renderCard();
    fireEvent.click(await screen.findByTestId("phone-remove-dev_a1"));
    expect(pairedPhoneRemoveMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("phone-confirm-remove-dev_a1"));
    });
    await waitFor(() => expect(pairedPhoneRemoveMock).toHaveBeenCalledWith("dev_a1"));
    await waitFor(() => expect(screen.queryByTestId("phone-dev_a1")).toBeNull());
    expect(screen.getByTestId("phone-dev_b2")).toBeInTheDocument();
  });
});
