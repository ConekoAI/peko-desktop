// A remote peko's profile: where it lives, its live status, and
// removing it from the list (the peko itself keeps running).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const removeMutate = vi.fn((_args: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
const record: Record<string, unknown> = {
  hubUrl: "http://localhost:3000",
  owner: "tester",
  principalName: "remy",
  displayName: "Remy",
  exposure: "public",
  status: "online",
  runtimeId: "hub:http://localhost:3000",
  addedAtUnixMs: 0,
  hasInviteToken: false,
};
vi.mock("../hooks/useRemotePrincipals", () => ({
  useRemotePeko: () => ({
    record,
    status: { data: { status: "online", lastSeenAt: null, source: "remote" }, isLoading: false },
    identity: { name: "remy", avatar: "🦊", initials: "R", accent: "sky" },
    description: "Finds things",
  }),
  useRemotePrincipalRemove: () => ({ mutate: removeMutate, isPending: false, error: null }),
}));

import RemotePekoProfile from "../components/modals/RemotePekoProfile";

describe("RemotePekoProfile", () => {
  it("shows where the peko lives and removes it from the list", () => {
    const onClose = vi.fn();
    const onRemoved = vi.fn();
    render(
      <RemotePekoProfile
        open
        principalName="remy"
        runtimeId={record.runtimeId as string}
        onClose={onClose}
        onRemoved={onRemoved}
      />,
    );
    expect(screen.getByText("Finds things")).toBeTruthy();
    expect(screen.getByTestId("remote-status-label").textContent).toBe("Online");
    // Whose engine runs it is not shown; only where it is reached.
    expect(screen.queryByText(/runtime/i)).toBeNull();
    expect(screen.getByText("localhost:3000")).toBeTruthy();
    expect(screen.getByText("http://localhost:3000/@tester/remy")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove from your list/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(removeMutate).toHaveBeenCalledWith(
      { hubUrl: "http://localhost:3000", owner: "tester", principalName: "remy" },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalled();
  });

  // One of your own pekos on another computer follows your account: it
  // says where it lives and offers no removing by hand.
  it("says one of yours lives on your other computer, with nothing to remove", () => {
    record.fromAccount = true;
    try {
      render(
        <RemotePekoProfile
          open
          principalName="remy"
          runtimeId={record.runtimeId as string}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText("Your other computer")).toBeTruthy();
      expect(screen.getByTestId("own-peko-elsewhere").textContent).toMatch(/local only/);
      expect(screen.queryByRole("button", { name: /remove from your list/i })).toBeNull();
    } finally {
      delete record.fromAccount;
    }
  });

  it("offers no share link for a private peko, which has no page", () => {
    record.exposure = "private";
    try {
      render(
        <RemotePekoProfile open principalName="remy" runtimeId={record.runtimeId as string} onClose={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: /copy share link/i })).toBeNull();
    } finally {
      record.exposure = "public";
    }
  });
});
