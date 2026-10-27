// Chat page: the "[tos_required]" send/stream rejection renders as a
// distinct in-thread acknowledgement notice carrying the hub's terms
// text — never as a generic red error bubble with the tag showing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ pekoName: "alice" }),
  useRouterState: () => ({ location: { pathname: "/chat/alice" } }),
  useSearch: () => ({}),
}));

const sendMut = { mutateAsync: vi.fn() };
const stopMut = { mutateAsync: vi.fn(), isPending: false };
const logWatch = { pausedRef: { current: false }, flush: vi.fn() };

const principalsState: { data: unknown; isLoading: boolean } = {
  data: [{ name: "alice", owner: "user:local", runtimeId: "local" }],
  isLoading: false,
};

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => principalsState,
  usePrincipalSend: () => sendMut,
  usePrincipalLog: () => ({ data: undefined, isSuccess: true, isError: false }),
  usePrincipalStop: () => stopMut,
  usePrincipalLogWatch: () => logWatch,
  useCallerSubject: () => "user:local",
  newestLogCursor: () => null,
}));

// The modal pulls in model/genesis hooks that are irrelevant here.
vi.mock("../components/modals/CreatePrincipalModal", () => ({
  default: () => null,
}));

import Chat from "../pages/Chat";

function sendMessage(text: string) {
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

describe("Chat ToS gate", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    sendMut.mutateAsync.mockReset();
    stopMut.mutateAsync.mockReset();
    logWatch.flush.mockReset();
    logWatch.pausedRef.current = false;
    principalsState.data = [
      { name: "alice", owner: "user:local", runtimeId: "local" },
    ];
    principalsState.isLoading = false;
  });

  it("renders a [tos_required] rejection as a distinct acknowledgement notice", async () => {
    sendMut.mutateAsync.mockRejectedValue(
      new Error("[tos_required] Be excellent to each other."),
    );
    render(<Chat />);
    sendMessage("hello");

    const notice = await screen.findByTestId("tos-required-notice");
    expect(notice).toHaveTextContent(
      /requires you to acknowledge its terms before chatting/i,
    );
    expect(notice).toHaveTextContent("Be excellent to each other.");
    // The raw tag never leaks into the thread.
    expect(screen.queryByText(/\[tos_required\]/)).toBeNull();
  });

  it("keeps generic send failures in the plain error box", async () => {
    sendMut.mutateAsync.mockRejectedValue(new Error("daemon unreachable"));
    render(<Chat />);
    sendMessage("hello");

    expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
    expect(screen.queryByTestId("tos-required-notice")).toBeNull();
  });

  it("treats a user stop as no error", async () => {
    sendMut.mutateAsync.mockRejectedValue(
      new Error("principal_send_stream failed: receive failed: stopped by user"),
    );
    render(<Chat />);
    sendMessage("hello");

    await waitFor(() => expect(logWatch.flush).toHaveBeenCalled());
    expect(screen.queryByText(/stopped by user/)).toBeNull();
  });

  it("shows Stop while a reply streams and stops the peko's turn", async () => {
    let settle: (v: string) => void = () => {};
    sendMut.mutateAsync.mockReturnValue(new Promise<string>((r) => (settle = r)));
    render(<Chat />);
    sendMessage("hello");

    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(stopMut.mutateAsync).toHaveBeenCalledWith({ name: "alice", runtimeId: "local" });
    // The stream pauses the log watch until it settles, then refetches.
    expect(logWatch.pausedRef.current).toBe(true);
    settle("");
    await waitFor(() => expect(logWatch.flush).toHaveBeenCalled());
    expect(logWatch.pausedRef.current).toBe(false);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("queues a message sent while the peko is busy", async () => {
    let settleFirst: (v: string) => void = () => {};
    sendMut.mutateAsync
      .mockReturnValueOnce(new Promise<string>((r) => (settleFirst = r)))
      .mockImplementationOnce(async (vars: { onEvent: (m: unknown) => void }) => {
        vars.onEvent({ kind: "queued", message: "busy" });
        return "";
      });
    render(<Chat />);
    sendMessage("first");
    sendMessage("also check the weather");

    expect(await screen.findByText(/your peko will read this next/i)).toBeInTheDocument();
    expect(sendMut.mutateAsync).toHaveBeenCalledTimes(2);
    // The second send settling does not end the turn or refetch yet.
    expect(logWatch.flush).not.toHaveBeenCalled();
    settleFirst("done");
    await waitFor(() => expect(logWatch.flush).toHaveBeenCalledTimes(1));
  });

  it("empty state uses peko copy", () => {
    principalsState.data = [];
    render(<Chat />);
    expect(screen.getByText("No pekos yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create a peko/i }),
    ).toBeInTheDocument();
  });
});
