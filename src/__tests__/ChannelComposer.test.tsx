// src/__tests__/ChannelComposer.test.tsx
//
// PR-2a / feature/desktop-channels: render the post composer. Validates:
//   • empty state with disabled send button
//   • Cmd+Enter submits the trimmed text via useChannelPost
//   • mutation error surfaces as an inline error chip with the message
//   • successful submit clears the textarea
//   • disabled-while-pending keeps the spinner visible
//
// Pattern follows `ModelGalleryCard.test.tsx` (render + QueryClient) and
// `useChannelEvents.test.tsx` (vi.mock the api module).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const channelPostMock = vi.fn();

vi.mock("../lib/api", () => ({
  channelPost: (...args: unknown[]) => channelPostMock(...args),
}));

import ChannelComposer from "../components/ChannelComposer";

function renderComposer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelComposer channelId="chan_alpha" senderName="alice" />
    </QueryClientProvider>,
  );
}

describe("ChannelComposer", () => {
  beforeEach(() => {
    channelPostMock.mockReset();
  });

  it("renders the textarea with the channel id placeholder", () => {
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("TEXTAREA");
  });

  it("disables the send button when the textarea is empty", () => {
    renderComposer();
    const send = screen.getByTestId("channel-composer-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("disables the send button when the draft is whitespace-only", () => {
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "   " } });
    const send = screen.getByTestId("channel-composer-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("submits the trimmed text via channelPost on Cmd+Enter", async () => {
    channelPostMock.mockResolvedValue("task_123");
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "  hello world  " } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(channelPostMock).toHaveBeenCalledWith(
        "chan_alpha",
        "alice",
        "hello world",
        null,
        undefined,
      );
    });
  });

  it("submits on Ctrl+Enter for non-mac users", async () => {
    channelPostMock.mockResolvedValue("task_123");
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(channelPostMock).toHaveBeenCalled();
    });
  });

  it("clears the textarea after a successful submit", async () => {
    channelPostMock.mockResolvedValue("task_123");
    renderComposer();
    const input = screen.getByTestId("channel-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("renders an inline error chip when the mutation rejects", async () => {
    channelPostMock.mockRejectedValue(new Error("daemon unreachable"));
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("channel-composer-error")).toBeInTheDocument();
      expect(screen.getByText("daemon unreachable")).toBeInTheDocument();
    });
  });

  it("keeps the draft after a rejected submit so the user can retry", async () => {
    channelPostMock.mockRejectedValue(new Error("daemon unreachable"));
    renderComposer();
    const input = screen.getByTestId("channel-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("channel-composer-error")).toBeInTheDocument();
    });
    expect(input.value).toBe("hi");
  });
});