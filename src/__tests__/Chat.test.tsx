// Chat page: the "[tos_required]" send/stream rejection renders as a
// distinct in-thread acknowledgement notice carrying the hub's terms
// text — never as a generic red error bubble with the tag showing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ pekoName: "alice" }),
  useRouterState: () => ({ location: { pathname: "/chat/alice" } }),
  useSearch: () => ({}),
}));

const sendMut = {
  mutateAsync: vi.fn(),
  sendControl: vi.fn(),
  activeRequestIdRef: { current: null as number | null },
};

const principalsState: { data: unknown; isLoading: boolean } = {
  data: [{ name: "alice", owner: "user:local", runtimeId: "local" }],
  isLoading: false,
};

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => principalsState,
  usePrincipalSend: () => sendMut,
  usePrincipalLog: () => ({ data: undefined }),
  useCallerSubject: () => "user:local",
}));

// The modal pulls in model/genesis hooks that are irrelevant here.
vi.mock("../components/modals/CreatePrincipalModal", () => ({
  default: () => null,
}));

import Chat from "../pages/Chat";

function sendMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

describe("Chat ToS gate", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    sendMut.mutateAsync.mockReset();
    sendMut.sendControl.mockReset();
    sendMut.activeRequestIdRef.current = null;
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

  it("empty state uses peko copy", () => {
    principalsState.data = [];
    render(<Chat />);
    expect(screen.getByText("No pekos yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create a peko/i }),
    ).toBeInTheDocument();
  });
});
