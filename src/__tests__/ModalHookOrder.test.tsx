// The group dialogs mount closed and open later. Hooks called after the
// `if (!open) return null` early return crashed the whole app on the
// first open (React #310 "Rendered more hooks than during the previous
// render"); every dialog must survive closed → open → closed.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({ data: [{ name: "nova" }], isLoading: false }),
}));
vi.mock("../hooks/useChannels", () => ({
  useChannelCreate: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
  useChannelInvite: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
  useChannelMembers: () => ({ data: [] }),
  useChannelInfo: () => ({ data: undefined }),
}));

import ChannelCreateModal from "../components/modals/ChannelCreateModal";
import ChannelInviteModal from "../components/modals/ChannelInviteModal";
import ChannelLeaveConfirmModal from "../components/modals/ChannelLeaveConfirmModal";

function cycle(element: (open: boolean) => React.ReactElement) {
  const qc = new QueryClient();
  const wrap = (open: boolean) => (
    <QueryClientProvider client={qc}>{element(open)}</QueryClientProvider>
  );
  const view = render(wrap(false));
  expect(() => view.rerender(wrap(true))).not.toThrow();
  expect(() => view.rerender(wrap(false))).not.toThrow();
}

describe("group dialogs open after mounting closed", () => {
  it("New group", () => {
    cycle((open) => <ChannelCreateModal open={open} onClose={vi.fn()} />);
  });

  it("Add to group", () => {
    cycle((open) => <ChannelInviteModal
        open={open}
        channel="chan_abcdefgh"
        detail={null}
        members={null}
        onClose={vi.fn()}
      />);
  });

  it("Leave group", () => {
    cycle((open) => (
      <ChannelLeaveConfirmModal
        open={open}
        channelId="chan_abcdefgh"
        isCreator={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    ));
  });
});
