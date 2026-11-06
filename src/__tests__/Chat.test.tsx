// Chat page: sending, streaming, steering, approvals, and the thread.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

const navigateMock = vi.fn();
// The chat route's search params (`?say=` hands over a first message).
const searchState: Record<string, string | undefined> = {};
// The open peko (`/chat/<name>`); a test switches pekos by changing it.
const routeState = { pekoName: "alice" };
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ pekoName: routeState.pekoName }),
  useRouterState: () => ({
    location: { pathname: `/chat/${routeState.pekoName}`, search: searchState },
  }),
}));

const sendMut = { mutateAsync: vi.fn() };
const decideMut = { mutateAsync: vi.fn(), isPending: false };
// The approval requests waiting for the owner.
const approvalsState: { data: unknown } = { data: [] };
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
  usePrincipalApprovals: () => ({ data: approvalsState.data, refetch: vi.fn() }),
  useDecideApproval: () => decideMut,
  usePrincipalLogWatch: () => logWatch,
  useCallerSubject: () => "user:local",
  newestLogCursor: () => null,
  fetchOlderPrincipalLog: (args: unknown) => fetchOlderMock(args),
}));

const fetchOlderMock = vi.fn();

const modelsState: { data: unknown } = { data: [] };
// The pekos on other computers this desktop added, and the one open.
const remoteState: { list: unknown[]; record: unknown; asked: string[] } = {
  list: [],
  record: undefined,
  asked: [],
};
vi.mock("../hooks/useRemotePrincipals", () => ({
  useRemotePrincipals: () => ({ data: remoteState.list }),
  useRemotePeko: (runtimeId: string, name: string) => ({
    record: (remoteState.asked.push(runtimeId), remoteState.record),
    status: { data: undefined },
    identity: { name, avatar: null, initials: name.slice(0, 1).toUpperCase(), accent: "emerald" },
    description: null,
  }),
}));

// The models of the computer hosting a remote peko, and who asked.
const hostModelsState: { data: unknown; asked: Array<[string, string, boolean]> } = {
  data: undefined,
  asked: [],
};
vi.mock("../hooks/useModels", () => ({
  useModels: () => modelsState,
  useRemotePekoModels: (runtimeId: string, name: string, enabled: boolean) => {
    hostModelsState.asked.push([runtimeId, name, enabled]);
    return { data: enabled ? hostModelsState.data : undefined };
  },
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
    remoteState.list = [];
    remoteState.record = undefined;
    remoteState.asked = [];
    routeState.pekoName = "alice";
    hostModelsState.data = undefined;
    hostModelsState.asked = [];
    localStorage.clear();
    navigateMock.mockReset();
    sendMut.mutateAsync.mockReset();
    decideMut.mutateAsync.mockReset();
    approvalsState.data = [];
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

  it("keeps generic send failures in the plain error box", async () => {
    sendMut.mutateAsync.mockRejectedValue(new Error("daemon unreachable"));
    render(<Chat />);
    sendMessage("hello");

    expect(await screen.findByText("daemon unreachable")).toBeInTheDocument();
    expect(screen.queryByTestId("tos-required-notice")).toBeNull();
  });

  it("treats a user stop as no error", async () => {
    sendMut.mutateAsync.mockRejectedValue(
      new Error("Couldn't send the message: receive failed: stopped by user"),
    );
    render(<Chat />);
    sendMessage("hello");

    await waitFor(() => expect(logWatch.flush).toHaveBeenCalled());
    expect(screen.queryByText(/stopped by user/)).toBeNull();
  });

  it("shows that the peko is working, with no Stop, while a reply streams", async () => {
    let settle: (v: string) => void = () => {};
    sendMut.mutateAsync.mockReturnValue(new Promise<string>((r) => (settle = r)));
    render(<Chat />);
    sendMessage("hello");

    expect(await screen.findByTestId("working-indicator")).toHaveTextContent("alice is working");
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    // The composer stays open: the next message reaches the peko at once.
    expect(screen.getByRole("textbox", { name: "Message" })).not.toBeDisabled();
    // The stream pauses the log watch until it settles, then refetches.
    expect(logWatch.pausedRef.current).toBe(true);
    settle("");
    await waitFor(() => expect(logWatch.flush).toHaveBeenCalled());
    expect(logWatch.pausedRef.current).toBe(false);
    expect(screen.queryByTestId("working-indicator")).toBeNull();
  });

  it("sends a message while the peko is working, shown as a plain message", async () => {
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

    expect(await screen.findByText("also check the weather")).toBeInTheDocument();
    expect(screen.queryByText(/queued/i)).toBeNull();
    expect(sendMut.mutateAsync).toHaveBeenCalledTimes(2);
    // The second send settling does not end the turn or refetch yet.
    expect(logWatch.flush).not.toHaveBeenCalled();
    settleFirst("done");
    await waitFor(() => expect(logWatch.flush).toHaveBeenCalledTimes(1));
  });

  it("keeps the peko's steps to itself and shows one bubble per reply", async () => {
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
      emit({ kind: "chunk", delta: "Let me check." });
      emit({ kind: "iteration", iteration: 2 });
      emit({ kind: "toolStart", toolId: "c1", name: "Bash", input: '{"command":"date"}' });
    });
    // No tool steps; the step's text stays until the next step's comes.
    expect(screen.queryByText(/bash/i)).toBeNull();
    expect(screen.getByText("Let me check.")).toBeInTheDocument();
    expect(screen.getByTestId("working-indicator")).toBeInTheDocument();

    await act(async () => {
      emit({ kind: "toolEnd", toolId: "c1", name: "Bash", success: true, durationMs: 12, output: "Tue" });
      emit({ kind: "chunk", delta: "It is " });
      emit({ kind: "chunk", delta: "Tuesday." });
    });
    // The reply is the last step's text, in one bubble.
    expect(screen.getByText("It is Tuesday.")).toBeInTheDocument();
    expect(screen.queryByText("Let me check.")).toBeNull();
    expect(screen.queryByTestId("working-indicator")).toBeNull();
    await act(async () => settle("It is Tuesday."));
  });

  it("shows why a reply is waiting beside the thread, not in it", () => {
    logState.data = {
      messages: [{ id: "chan_1", sender: "user:local", text: "hi", timestamp: "1" }],
      runFailure: {
        at: "2026-10-31T10:00:00Z",
        kind: "provider_unreachable",
        message: "error sending request",
        nextAttemptAt: "2026-10-31T10:05:00Z",
      },
    };
    render(<Chat />);
    expect(screen.getByTestId("run-status")).toHaveTextContent(
      /Waiting — the model provider can't be reached\. It continues on its own/,
    );
    expect(screen.queryByText(/error sending request/)).toBeNull();
  });

  it("lets the owner approve or deny a waiting request", async () => {
    approvalsState.data = [
      {
        id: "apr_0123456789ab",
        actor: "user:hub:x",
        actorName: "Alice",
        trust: "untrusted",
        summary: "`Read` (file_path=finances/q3.md)",
        reason: "finances are private",
        createdAt: "2026-10-31T10:00:00Z",
        expiresAt: "2026-11-01T10:00:00Z",
      },
    ];
    decideMut.mutateAsync.mockResolvedValue("Approved apr_0123456789ab. Running it for user:hub:x now.");
    render(<Chat />);
    const cards = screen.getByTestId("approval-cards");
    expect(cards).toHaveTextContent("Alice (user:hub:x) asks alice to run Read (file_path=finances/q3.md)");
    expect(cards).toHaveTextContent("finances are private");

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(decideMut.mutateAsync).toHaveBeenCalledWith({
        name: "alice",
        id: "apr_0123456789ab",
        approve: true,
        always: false,
      }),
    );
    expect(await screen.findByText(/Running it for user:hub:x/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(decideMut.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({ approve: false }),
      ),
    );
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

  it("remembers each peko's model when switching pekos", async () => {
    modelsState.data = [{ id: "fast", displayName: "Fast model", enabled: true }];
    principalsState.data = [
      { name: "alice", owner: "user:local", runtimeId: "local" },
      { name: "bob", owner: "user:local", runtimeId: "local" },
    ];
    sendMut.mutateAsync.mockResolvedValue("");
    const { rerender } = render(<Chat />);
    const picker = () =>
      screen.getByRole<HTMLSelectElement>("combobox", { name: /model for this message/i });
    fireEvent.change(picker(), { target: { value: "fast" } });
    routeState.pekoName = "bob";
    rerender(<Chat />);
    expect(picker().value).toBe("");
    routeState.pekoName = "alice";
    rerender(<Chat />);
    expect(picker().value).toBe("fast");
    sendMessage("still fast");
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0]).toMatchObject({ name: "alice", overrideModel: "fast" });

    // A pick whose model is gone falls back to the peko's own.
    modelsState.data = [{ id: "other", displayName: "Other", enabled: true }];
    rerender(<Chat />);
    expect(picker().value).toBe("");
    sendMessage("own model");
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(2));
    expect(sendMut.mutateAsync.mock.calls[1][0].overrideModel).toBeUndefined();
  });

  it("offers your peko on another computer that computer's models, and none for others' pekos", async () => {
    principalsState.data = [];
    // This computer's own models are not the host's.
    modelsState.data = [{ id: "fast", displayName: "Fast model", enabled: true }];
    hostModelsState.data = [{ id: "work", displayName: "Work model" }];
    const mine = {
      runtimeId: "hub:https://pekohub.example",
      principalName: "alice",
      owner: "yumo",
      hubUrl: "https://pekohub.example",
      fromAccount: true,
    };
    remoteState.list = [mine];
    remoteState.record = mine;
    searchState.runtimeId = mine.runtimeId;
    sendMut.mutateAsync.mockResolvedValue("");
    const { rerender, unmount } = render(<Chat />);
    const picker = screen.getByRole("combobox", { name: /model for this message/i });
    expect(screen.getByRole("option", { name: "Work model" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Fast model" })).toBeNull();
    expect(hostModelsState.asked).toContainEqual([mine.runtimeId, "alice", true]);
    fireEvent.change(picker, { target: { value: "work" } });
    sendMessage("on the work model");
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0]).toMatchObject({
      runtimeId: mine.runtimeId,
      overrideModel: "work",
    });
    rerender(<Chat />);
    unmount();

    // Someone else's peko: no picker, and its host is not asked.
    const theirs = { ...mine, owner: "ada", fromAccount: false };
    remoteState.list = [theirs];
    remoteState.record = theirs;
    hostModelsState.asked = [];
    render(<Chat />);
    expect(screen.queryByRole("combobox", { name: /model for this message/i })).toBeNull();
    expect(hostModelsState.asked.every(([, , enabled]) => !enabled)).toBe(true);
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

    // The reply's own Copy: the retried message may already show below it
    // with a Copy of its own, so "the last Copy" isn't the reply's.
    const reply = screen.getByText("Here it is.").closest(".group") as HTMLElement;
    fireEvent.click(within(reply).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copyMock).toHaveBeenCalledWith("Here it is."));
  });

  it("sends a suggested reply with one tap, as your own message", async () => {
    logState.data = {
      messages: [
        { id: "chan_1", sender: "user:local", text: "the build is green", timestamp: "1" },
        {
          id: "chan_2",
          sender: "principal:prin_a",
          text: "Ship today?",
          timestamp: "2",
          options: ["Ship it", "Hold off"],
        },
      ],
    };
    sendMut.mutateAsync.mockResolvedValue("");
    render(<Chat />);
    const group = screen.getByRole("group", { name: "Suggested replies" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Ship it",
      "Hold off",
    ]);
    fireEvent.click(within(group).getByRole("button", { name: "Ship it" }));
    await waitFor(() => expect(sendMut.mutateAsync).toHaveBeenCalledTimes(1));
    expect(sendMut.mutateAsync.mock.calls[0][0]).toMatchObject({ message: "Ship it" });
    // The composer stays as it was.
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
  });

  it("shows suggested replies only on the latest message, and not while a reply streams", async () => {
    logState.data = {
      messages: [
        {
          id: "chan_1",
          sender: "principal:prin_a",
          text: "Tuesday or Thursday?",
          timestamp: "1",
          options: ["Tuesday", "Thursday"],
        },
        { id: "chan_2", sender: "user:local", text: "next week, actually", timestamp: "2" },
      ],
    };
    const { unmount } = render(<Chat />);
    expect(screen.queryByTestId("suggested-replies")).toBeNull();
    unmount();

    logState.data = {
      messages: [
        {
          id: "chan_1",
          sender: "principal:prin_a",
          text: "Ship today?",
          timestamp: "1",
          options: ["Ship it", "Hold off"],
        },
      ],
    };
    let finish: (v: string) => void = () => {};
    sendMut.mutateAsync.mockReturnValue(new Promise<string>((r) => (finish = r)));
    render(<Chat />);
    expect(screen.getByTestId("suggested-replies")).toBeTruthy();
    sendMessage("one more thing");
    await waitFor(() => expect(screen.queryByTestId("suggested-replies")).toBeNull());
    await act(async () => finish(""));
  });

  it("never shows suggested replies on your own messages", () => {
    logState.data = {
      messages: [
        { id: "chan_1", sender: "user:local", text: "hi", timestamp: "1", options: ["A", "B"] },
      ],
    };
    render(<Chat />);
    expect(screen.queryByTestId("suggested-replies")).toBeNull();
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

  it("opens a peko on another computer when this one has none of its own", () => {
    principalsState.data = [];
    const bolt = {
      runtimeId: "hub:https://pekohub.example",
      principalName: "alice",
      owner: "yumo",
      hubUrl: "https://pekohub.example",
    };
    remoteState.list = [bolt];
    remoteState.record = bolt;
    // The runtime comes from the whole URL (`?runtimeId=`), read where the
    // page renders, at `/chat`.
    searchState.runtimeId = bolt.runtimeId;
    render(<Chat />);
    expect(remoteState.asked).toContain(bolt.runtimeId);
    expect(screen.queryByText("No pekos yet")).toBeNull();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // The header reads like a local peko's for yours, and names the owner
  // for someone else's — even one known by its Hub ID through a DM.
  it.each([
    [true, "Your peko"],
    [false, "bob's peko"],
  ])("a remote peko from your account (%s) is headed %s", (fromAccount, subtitle) => {
    principalsState.data = [];
    const scout = {
      runtimeId: "hub:https://pekohub.example",
      principalName: "scout",
      owner: "bob",
      hubUrl: "https://pekohub.example",
      hubId: "7f700f07-e081-4dd8-b0db-ae41c7efbaeb",
      fromAccount,
    };
    remoteState.list = [scout];
    remoteState.record = scout;
    searchState.runtimeId = scout.runtimeId;
    render(<Chat />);
    expect(screen.getByText(subtitle)).toBeInTheDocument();
  });

  it("with only pekos on other computers and none open, asks to pick one", () => {
    principalsState.data = [];
    remoteState.list = [{ runtimeId: "hub:https://pekohub.example", principalName: "bolt" }];
    render(<Chat />);
    expect(screen.getByText("Select a peko from the sidebar")).toBeInTheDocument();
    expect(screen.queryByText("No pekos yet")).toBeNull();
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

  // Runtime ADR-091: past the start of this computer's copy of a chat
  // with a peko on another computer, earlier messages come from its host
  // (`msg:` cursors), page by page, until there are none.
  it("keeps loading earlier messages from the host of a remote peko", async () => {
    logState.data = {
      messages: [msg("m5", "user:local", "latest question")],
      nextCursor: "msg:m5",
      hasMore: true,
    };
    fetchOlderMock
      .mockResolvedValueOnce({
        messages: [msg("m3", "user:local", "asked on my laptop"), msg("m4", "principal:hub:x", "answered there")],
        nextCursor: "msg:m3",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        messages: [msg("m1", "user:local", "the very first")],
        nextCursor: null,
        hasMore: false,
      });
    render(<Chat />);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText("asked on my laptop")).toBeInTheDocument();
    expect(fetchOlderMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "msg:m5" }));

    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText("the very first")).toBeInTheDocument();
    expect(fetchOlderMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "msg:m3" }));
    const before = (a: string, b: string) =>
      Boolean(screen.getByText(a).compareDocumentPosition(screen.getByText(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before("the very first", "asked on my laptop")).toBe(true);
    expect(before("answered there", "latest question")).toBe(true);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("says so when the host can't be reached for earlier messages", async () => {
    logState.data = { messages: [msg("m5", "user:local", "latest")], nextCursor: "msg:m5", hasMore: true };
    fetchOlderMock.mockImplementation(async () => {
      throw new Error("Older messages couldn't be read from the computer hosting this peko.");
    });
    render(<Chat />);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText(/couldn't be read from the computer hosting this peko/)).toBeInTheDocument();
    expect(screen.getByText("latest")).toBeInTheDocument();
  });

  it("offers no earlier messages on a short thread", () => {

    logState.data = { messages: [msg("m1", "user:local", "hi")], nextCursor: null, hasMore: false };
    render(<Chat />);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });
});
