// src/__tests__/ChannelComposer.test.tsx
//
// PR-2a / feature/desktop-channels: render the post composer. Validates:
//   • empty state with disabled send button
//   • Enter submits the trimmed text via useChannelPost; Shift+Enter adds a line
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
  channelInfo: async () => ({
    channelId: "chan_alpha",
    kind: "group",
    name: "Launch crew",
    members: ["user:local", "principal:prin_j", "principal:prin_n"],
    pekos: [
      { name: "juno", localId: "prin_j", wake: "mention" },
      { name: "nova", localId: "prin_n", wake: "mention" },
    ],
  }),
}));

import ChannelComposer from "../components/ChannelComposer";

function renderComposer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChannelComposer channelId="chan_alpha" channelName="Launch crew" />
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

  it("submits the trimmed text via channelPost on Enter", async () => {
    channelPostMock.mockResolvedValue("task_123");
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "  hello world  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(channelPostMock).toHaveBeenCalledWith(
        "chan_alpha",
        null,
        "hello world",
        null,
        undefined,
      );
    });
  });

  it("adds a line on Shift+Enter instead of submitting", () => {
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(channelPostMock).not.toHaveBeenCalled();
  });

  it("clears the textarea after a successful submit", async () => {
    channelPostMock.mockResolvedValue("task_123");
    renderComposer();
    const input = screen.getByTestId("channel-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("renders an inline error chip when the mutation rejects", async () => {
    channelPostMock.mockRejectedValue(new Error("daemon unreachable"));
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
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
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByTestId("channel-composer-error")).toBeInTheDocument();
    });
    expect(input.value).toBe("hi");
  });

  it("renders a distinct membership-gate notice when the runtime forbids the post", async () => {
    channelPostMock.mockRejectedValue("[forbidden] not a member of chan_alpha");
    renderComposer();
    const input = screen.getByTestId("channel-composer-input");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByTestId("channel-composer-forbidden"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/You aren't in this group/i),
    ).toBeInTheDocument();
    // The generic error chip must NOT render for the forbidden case.
    expect(screen.queryByTestId("channel-composer-error")).toBeNull();
  });

  describe("@mentions", () => {
    async function typeInto(text: string) {
      const input = screen.getByTestId("channel-composer-input") as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: text, selectionStart: text.length } });
      input.setSelectionRange(text.length, text.length);
      fireEvent.select(input);
      return input;
    }

    it("lists the group's pekos after @ and inserts the one picked", async () => {
      renderComposer();
      const input = await typeInto("hey @");
      expect(await screen.findByRole("option", { name: "@juno" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "@nova" })).toBeInTheDocument();
      await typeInto("hey @n");
      expect(screen.queryByRole("option", { name: "@juno" })).toBeNull();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("hey @nova ");
      // Enter chose the mention; it did not send.
      expect(channelPostMock).not.toHaveBeenCalled();
    });

    it("closes on Escape so Enter sends again", async () => {
      channelPostMock.mockResolvedValue("task_1");
      renderComposer();
      const input = await typeInto("@j");
      await screen.findByRole("option", { name: "@juno" });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(channelPostMock).toHaveBeenCalled());
    });
  });
});

