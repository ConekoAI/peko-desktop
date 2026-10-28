// Chat page: the "[tos_required]" send/stream rejection renders as a
// distinct in-thread acknowledgement notice carrying the hub's terms
// text — never as a generic red error bubble with the tag showing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const navigateMock = vi.fn();
// The chat route's search params (`?say=` hands over a first message).
const searchState: Record<string, string | undefined> = {};
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ pekoName: "alice" }),
  useRouterState: () => ({ location: { pathname: "/chat/alice" } }),
  useSearch: () => searchState,
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
  fetchOlderPrincipalLog: (args: unknown) => fetchOlderMock(args),
}));

const fetchOlderMock = vi.fn();

const modelsState: { data: unknown } = { data: [] };
vi.mock("../hooks/useModels", () => ({
  useModels: () => modelsState,
}));

const copyMock = vi.fn(async (_text: string) => true);
vi.mock("../components/chat/copy", () => ({
  copyText: (text: string) => copyMock(text),
}));

vi.mock("../components/modals/PrincipalProfileModal", () => ({
  default: () => null,
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
    for (const k of Object.keys(searchState)) delete searchState[k];
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

  it("sends on Enter, adds a line on Shift+Enter, and never mid-composition", async () => {
    sendMut.mutateAsync.mockResolvedValue("");
    render(<Chat />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(sendMut.mutateAsync).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
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

  it("sends a first message handed over in the URL once, and drops it", async () => {
    searchState.say = "Help me plan my week.";
    sendMut.mutateAsync.mockResolvedValue("");
    const { rerender } = render(<Chat />);
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0]).toMatchObject({ message: "Help me plan my week." });
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/chat/$pekoName", replace: true, search: { runtimeId: undefined } }),
    );
    rerender(<Chat />);
    expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1);
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

const msg = (id: string, sender: string, text: string) => ({
  id,
  sender,
  text,
  timestamp: "2026-10-28T10:00:00Z",
});

describe("Chat thread and peko lifecycle", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    fetchOlderMock.mockReset();
    logState.data = undefined;
    principalsState.data = [{ name: "alice", owner: "user:local", runtimeId: "local" }];
    principalsState.isLoading = false;
  });

  it("leaves the address of a peko that no longer exists", () => {
    principalsState.data = [{ name: "bob", owner: "user:local", runtimeId: "local" }];
    render(<Chat />);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/chat", replace: true });
  });

  it("leaves it even while the list refetches (a busy engine can hold that up)", () => {
    principalsState.data = [{ name: "bob", owner: "user:local", runtimeId: "local" }];
    (principalsState as Record<string, unknown>).isFetching = true;
    render(<Chat />);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/chat", replace: true });
    delete (principalsState as Record<string, unknown>).isFetching;
  });

  it("stays on a peko that exists", () => {
    render(<Chat />);
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/chat", replace: true });
  });

  it("loads earlier messages above the latest page", async () => {
    logState.data = {
      messages: [msg("m3", "user:local", "latest question")],
      nextCursor: "c1",
      hasMore: true,
    };
    fetchOlderMock.mockResolvedValue({
      messages: [msg("m1", "user:local", "first question"), msg("m2", "principal:alice", "first answer")],
      nextCursor: null,
      hasMore: false,
    });
    render(<Chat />);
    expect(screen.queryByText("first question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));

    expect(await screen.findByText("first question")).toBeInTheDocument();
    expect(fetchOlderMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alice", cursor: "c1", peer: "user:local" }),
    );
    const order = ["first question", "first answer", "latest question"].map(
      (t) => screen.getByText(t).compareDocumentPosition(screen.getByText("latest question")),
    );
    expect(order.slice(0, 2).every((pos) => pos & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // Nothing older remains.
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("offers no earlier messages on a short thread", () => {
    logState.data = { messages: [msg("m1", "user:local", "hi")], nextCursor: null, hasMore: false };
    render(<Chat />);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });
});
