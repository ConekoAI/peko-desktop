// Runtime ADR-092 D5: a group's home registers it on PekoHub and makes
// invite links.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const groupRegisterMock = vi.fn();
const groupLinkMock = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  groupRegister: (id: string, v: string) => groupRegisterMock(id, v),
  groupLink: (id: string, o: unknown) => groupLinkMock(id, o),
}));

import GroupSharePanel from "../components/GroupSharePanel";

function renderPanel(group: Parameters<typeof GroupSharePanel>[0]["group"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupSharePanel channelId="chan_book" group={group} />
    </QueryClientProvider>,
  );
}

describe("GroupSharePanel", () => {
  beforeEach(() => {
    groupRegisterMock.mockReset();
    groupLinkMock.mockReset();
  });

  it("registers an unregistered group with the chosen visibility", async () => {
    groupRegisterMock.mockResolvedValue({ id: "123", page: "https://pekohub.ai/g/123", visibility: "public" });
    renderPanel({ homeHere: true, owner: "principal:local:p", hubId: null, page: null, visibility: null });
    expect(screen.queryByTestId("group-share-link")).toBeNull();
    fireEvent.change(screen.getByTestId("group-share-visibility"), { target: { value: "public" } });
    fireEvent.click(screen.getByTestId("group-share-register"));
    await waitFor(() => expect(groupRegisterMock).toHaveBeenCalledWith("chan_book", "public"));
  });

  it("makes an invite link and stops them all", async () => {
    groupLinkMock.mockImplementation(async (_id: string, o: { revoke?: boolean }) =>
      o.revoke
        ? { link: null, expires: null, revoked: 2 }
        : { link: "https://pekohub.ai/g/123?invite=tok", expires: "2026-11-10T00:00:00Z", revoked: null },
    );
    renderPanel({
      homeHere: true,
      owner: "principal:local:p",
      hubId: "123",
      page: "https://pekohub.ai/g/123",
      visibility: "invite_only",
    });
    expect(screen.getByTestId("group-share-id")).toHaveTextContent("123");
    fireEvent.click(screen.getByTestId("group-share-link"));
    expect(await screen.findByTestId("group-share-link-value")).toHaveTextContent(
      "https://pekohub.ai/g/123?invite=tok",
    );
    expect(groupLinkMock).toHaveBeenCalledWith("chan_book", { revoke: false });
    fireEvent.click(screen.getByTestId("group-share-revoke"));
    expect(await screen.findByTestId("group-share-revoked")).toHaveTextContent("Stopped 2 link(s).");
  });

  it("says why registering failed", async () => {
    groupRegisterMock.mockRejectedValue(new Error("The group's owner must be registered with PekoHub first"));
    renderPanel({ homeHere: true, owner: "principal:local:p", hubId: null, page: null, visibility: null });
    fireEvent.click(screen.getByTestId("group-share-register"));
    expect(await screen.findByText(/must be registered with PekoHub first/)).toBeInTheDocument();
  });
});
