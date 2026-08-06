// src/__tests__/ChannelLeaveConfirmModal.test.tsx
//
// PR-3 / feature/desktop-channels: render coverage for the leave
// confirmation modal. Pure presentational component — no hooks —
// so the test surface is just the conditional creator caveat
// and the onConfirm / onCancel callback wiring.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ChannelLeaveConfirmModal from "../components/modals/ChannelLeaveConfirmModal";

function renderModal(
  props: Partial<React.ComponentProps<typeof ChannelLeaveConfirmModal>> = {},
) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  return {
    ...render(
      <ChannelLeaveConfirmModal
        open={true}
        channelId="chan_alpha"
        isCreator={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    ),
    onConfirm,
    onCancel,
  };
}

describe("ChannelLeaveConfirmModal", () => {
  it("renders nothing when closed", () => {
    render(
      <ChannelLeaveConfirmModal
        open={false}
        channelId="chan_alpha"
        isCreator={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("channel-leave-confirm")).toBeNull();
  });

  it("renders the channel id in the title + the confirm button", () => {
    renderModal();
    expect(screen.getByText(/chan_alpha/)).toBeInTheDocument();
    expect(screen.getByTestId("channel-leave-confirm")).toBeInTheDocument();
  });

  it("hides the creator caveat when isCreator is false", () => {
    renderModal({ isCreator: false });
    expect(
      screen.queryByText(/You created this channel/),
    ).toBeNull();
  });

  it("shows the creator caveat when isCreator is true", () => {
    renderModal({ isCreator: true });
    expect(screen.getByText(/You created this channel/)).toBeInTheDocument();
  });

  it("fires onConfirm when the confirm button is clicked", () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByTestId("channel-leave-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel when the Cancel button is clicked", () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByText(/^Cancel$/));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});