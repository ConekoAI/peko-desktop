// Chat page: the "[tos_required]" send/stream rejection renders as a
// distinct in-thread acknowledgement notice carrying the hub's terms
// text — never as a generic red error bubble with the tag showing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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
// What the thread holds; a test sets it to simulate the refetch.
const logState: { data: unknown } = { data: undefined };

const principalsState: { data: unknown; isLoading: boolean } = {
  data: [{ name: "alice", owner: "user:local", runtimeId: "local" }],
  isLoading: false,
};

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => principalsState,
  usePrincipalSend: () => sendMut,
  usePrincipalLog: () => ({ data: logState.data, isSuccess: true, isError: false }),
  usePrincipalStop: () => stopMut,
  usePrincipalLogWatch: () => logWatch,
  useCallerSubject: () => "user:local",
  newestLogCursor: () => null,
}));

const modelsState: { data: unknown } = { data: [] };
vi.mock("../hooks/useModels", () => ({
  useModels: () => modelsState,
}));

const copyMock = vi.fn(async (_text: string) => true);
vi.mock("../components/chat/copy", () => ({
  copyText: (text: string) => copyMock(text),
}));

// The modal pulls in model/genesis hooks that are irrelevant here.
vi.mock("../components/modals/CreatePrincipalModal", () => ({
  default: () => null,
}));

import Chat from "../pages/Chat";

function sendMessage(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
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
    logState.data = undefined;
    modelsState.data = [];
    copyMock.mockClear();
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

  it("shows the reply's tool steps live and keeps them after it lands", async () => {
    let settle: (v: string) => void = () => {};
    let emit: (m: unknown) => void = () => {};
    sendMut.mutateAsync.mockImplementation(
      (vars: { onEvent: (m: unknown) => void }) => {
        emit = vars.onEvent;
        return new Promise<string>((r) => (settle = r));
      },
    );
    render(<Chat />);
    sendMessage("what day is it?");

    await act(async () => {
      emit({ kind: "iteration", iteration: 1 });
      emit({ kind: "toolStart", toolId: "c1", name: "Bash", input: '{"command":"date"}' });
    });
    expect(screen.getByRole("button", { name: /running bash/i })).toBeInTheDocument();

    // The refetch after the reply returns the exchange from the thread.
    logWatch.flush.mockImplementation(async () => {
      logState.data = {
        messages: [
          { id: "chan_1", sender: "user:local", text: "what day is it?", timestamp: "1" },
          { id: "chan_2", sender: "principal:prin_a", text: "It is Tuesday.", timestamp: "2" },
        ],
      };
    });
    await act(async () => {
      emit({ kind: "toolEnd", toolId: "c1", name: "Bash", success: true, durationMs: 12, output: "Tue" });
      emit({ kind: "chunk", delta: "It is Tuesday." });
      settle("It is Tuesday.");
    });
    await waitFor(() => expect(logWatch.flush).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /used 1 tool/i })).toBeInTheDocument();
  });

  it("sends on ⌘↵ but adds a line on Enter", async () => {
    sendMut.mutateAsync.mockResolvedValue("");
    render(<Chat />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sendMut.mutateAsync).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0]).toMatchObject({ message: "line one" });
  });

  it("sends with the model picked for this message", async () => {
    modelsState.data = [
      { id: "fast", displayName: "Fast model", enabled: true },
      { id: "off", displayName: "Disabled", enabled: false },
    ];
    sendMut.mutateAsync.mockResolvedValue("");
    render(<Chat />);
    const picker = screen.getByRole("combobox", { name: /model for this message/i });
    expect(screen.queryByRole("option", { name: "Disabled" })).toBeNull();
    sendMessage("default first");
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0].overrideModel).toBeUndefined();

    fireEvent.change(picker, { target: { value: "fast" } });
    sendMessage("now fast");
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(2));
    expect(sendMut.mutateAsync.mock.calls[1][0].overrideModel).toBe("fast");
  });

  it("retries the latest reply by sending its message again, and copies messages", async () => {
    logState.data = {
      messages: [
        { id: "chan_1", sender: "user:local", text: "summarize the doc", timestamp: "1" },
        { id: "chan_2", sender: "principal:prin_a", text: "Here it is.", timestamp: "2" },
      ],
    };
    sendMut.mutateAsync.mockResolvedValue("");
    render(<Chat />);
    // Only the latest reply offers Retry.
    const retries = screen.getAllByRole("button", { name: "Retry" });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]);
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0]).toMatchObject({ message: "summarize the doc" });

    const copies = screen.getAllByRole("button", { name: "Copy" });
    fireEvent.click(copies[copies.length - 1]);
    await waitFor(() => expect(copyMock).toHaveBeenCalledWith("Here it is."));
  });

  it("shows the peko's name on its replies", () => {
    logState.data = {
      messages: [{ id: "chan_1", sender: "principal:prin_a", text: "hi", timestamp: "1" }],
    };
    render(<Chat />);
    // The header names the peko once; its reply names it again.
    expect(screen.getAllByText("alice").length).toBeGreaterThan(1);
    expect(screen.queryByText("Assistant")).toBeNull();
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
