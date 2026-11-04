// Runtime ADR-095 D6: the people you blocked, in Settings.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const blockedPeopleMock = vi.fn();
const setPersonBlockedMock = vi.fn();
vi.mock("../lib/api", () => ({
  blockedPeople: () => blockedPeopleMock(),
  setPersonBlocked: (account: string, blocked: boolean) => setPersonBlockedMock(account, blocked),
}));

import BlockedPeople from "../components/BlockedPeople";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BlockedPeople />
    </QueryClientProvider>,
  );
}

describe("BlockedPeople", () => {
  beforeEach(() => {
    blockedPeopleMock.mockReset();
    setPersonBlockedMock.mockReset();
  });

  it("says when nobody is blocked", async () => {
    blockedPeopleMock.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByTestId("blocked-people-empty")).toBeInTheDocument();
  });

  it("unblocks a person", async () => {
    blockedPeopleMock.mockResolvedValue(["eve-id", "mallory-id"]);
    setPersonBlockedMock.mockResolvedValue(["mallory-id"]);
    renderCard();
    const eve = await screen.findByTestId("blocked-eve-id");
    fireEvent.click(eve.querySelector("button")!);
    await waitFor(() => expect(setPersonBlockedMock).toHaveBeenCalledWith("eve-id", false));
    await waitFor(() => expect(screen.queryByTestId("blocked-eve-id")).toBeNull());
    expect(screen.getByTestId("blocked-mallory-id")).toBeInTheDocument();
  });
});
