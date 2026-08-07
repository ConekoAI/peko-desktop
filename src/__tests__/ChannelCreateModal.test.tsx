// src/__tests__/ChannelCreateModal.test.tsx
//
// PR-3 / feature/desktop-channels: render coverage for the
// "New channel" modal. The mutation lives in
// `useChannelMutations.test.tsx`; this file asserts the surface
// the user actually touches — name field, creator picker, submit
// button states, and the onCreated callback wiring that the
// Layout uses to navigate.
//
// Mock pattern mirrors `ChannelSidebar.test.tsx`: vi.mock the
// hooks + QueryClientProvider wrapper.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useChannelCreateMock = vi.fn();
const usePrincipalsMock = vi.fn();

vi.mock("../hooks/useChannels", () => ({
  useChannelCreate: (...args: unknown[]) => useChannelCreateMock(...args),
}));

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: (...args: unknown[]) => usePrincipalsMock(...args),
}));

import ChannelCreateModal from "../components/modals/ChannelCreateModal";

function renderModal(
  props: Partial<React.ComponentProps<typeof ChannelCreateModal>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <ChannelCreateModal
          open={true}
          onClose={onClose}
          onCreated={onCreated}
          {...props}
        />
      </QueryClientProvider>,
    ),
    onClose,
    onCreated,
  };
}

const idleMut = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

describe("ChannelCreateModal", () => {
  beforeEach(() => {
    useChannelCreateMock.mockReset();
    usePrincipalsMock.mockReset();
    usePrincipalsMock.mockReturnValue({
      data: [{ name: "alice" }, { name: "bob" }],
    });
    useChannelCreateMock.mockReturnValue({ ...idleMut, mutate: vi.fn() });
  });

  it("renders nothing when closed", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChannelCreateModal open={false} onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("channel-create-name")).toBeNull();
    expect(screen.queryByTestId("channel-create-submit")).toBeNull();
  });

  it("renders name + creator picker + submit when open", () => {
    renderModal();
    expect(screen.getByTestId("channel-create-name")).toBeInTheDocument();
    expect(screen.getByTestId("channel-create-creator")).toBeInTheDocument();
    expect(screen.getByTestId("channel-create-submit")).toBeInTheDocument();
  });

  it("the submit button is disabled when the name is empty", () => {
    renderModal();
    const submit = screen.getByTestId("channel-create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("calls mutate with the entered name and the selected creator, then onCreated on success", async () => {
    const mutateMock = vi.fn((_args, opts) => {
      // Simulate the runtime resolving with a new channel id.
      opts.onSuccess?.("chan_xyz123");
    });
    useChannelCreateMock.mockReturnValue({
      ...idleMut,
      mutate: mutateMock,
    });
    const { onCreated } = renderModal();
    const nameInput = screen.getByTestId("channel-create-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "team-standup" } });
    const creatorSelect = screen.getByTestId("channel-create-creator") as HTMLSelectElement;
    fireEvent.change(creatorSelect, { target: { value: "bob" } });
    fireEvent.click(screen.getByTestId("channel-create-submit"));
    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock).toHaveBeenCalledWith(
      { creatorName: "bob", name: "team-standup" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onCreated).toHaveBeenCalledWith("chan_xyz123");
  });

  it("surfaces mutation errors inline instead of closing", () => {
    useChannelCreateMock.mockReturnValue({
      ...idleMut,
      isError: true,
      error: new Error("creator not loaded"),
    });
    renderModal();
    expect(screen.getByText(/creator not loaded/)).toBeInTheDocument();
  });

  it("does not render the picker when there are zero local principals", () => {
    usePrincipalsMock.mockReturnValue({ data: [] });
    renderModal();
    // The select dropdown still renders, but the user sees a hint
    // to load a principal first instead of the empty option list.
    expect(screen.getByText(/No local principals/i)).toBeInTheDocument();
  });

  // P1.5: Escape closes the modal. Uses the modal-level keydown
  // listener installed by `useModalA11y`. Fires from `document` so
  // the test mirrors a real keyboard event (the listener uses
  // `capture: true` to win against form-field keydown handlers).
  it("closes the modal when Escape is pressed", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // P1.5: backdrop click also closes the modal. We dispatch a
  // click on the outer dialog element (the one with role="dialog");
  // the `e.target === e.currentTarget` guard inside the modal means
  // a click on a child (e.g. the inner card) is ignored.
  it("closes the modal when the backdrop is clicked", () => {
    const { onClose } = renderModal();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // P1.5: aria-modal + labelled-by wired up so screen readers
  // announce the modal correctly.
  it("exposes aria-modal + aria-labelledby on the dialog container", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("channel-create-modal-title");
    expect(screen.getByText("Create a Channel")).toHaveAttribute(
      "id",
      "channel-create-modal-title",
    );
  });
});