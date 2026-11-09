// src/__tests__/BoardPanel.test.tsx
//
// Runtime ADR-101: a group's board above its conversation. Validates:
//   • a DM shows no board
//   • the summary counts open, blocked, and past-check-in items
//   • your own item offers Done / Blocked… / Let go; an unclaimed one, Take it
//   • a change is sent as a board op

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { BoardItem } from "../types";

const info: { data: unknown } = { data: { kind: "group", people: [] } };
const board: { data: BoardItem[] | undefined } = { data: [] };
const mutate = vi.fn();
vi.mock("../hooks/useChannels", () => ({
  useChannelInfo: () => info,
  useChannelBoard: () => board,
  useChangeBoard: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("../hooks/useChannelDirectory", () => ({
  useChannelDirectory: () => ({
    resolve: (a: string) =>
      a === "user:local:local"
        ? { label: "You", peko: null, isYou: true }
        : { label: a.split(":").pop(), peko: null, isYou: false },
    named: (t: string) => t,
  }),
}));

import BoardPanel from "../components/BoardPanel";

const item = (over: Partial<BoardItem>): BoardItem => ({
  id: "msg_1",
  short: "1",
  title: "run the tests",
  added_by: "principal:local:kit",
  state: "open",
  added_at: "2026-11-09T10:00:00Z",
  updated_at: "2026-11-09T10:00:00Z",
  ...over,
});

describe("BoardPanel", () => {
  beforeEach(() => {
    mutate.mockReset();
    info.data = { kind: "group", people: [] };
  });

  it("shows nothing in a DM", () => {
    info.data = { kind: "dm", people: [] };
    board.data = [item({})];
    const { container } = render(<BoardPanel channelId="dm_x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes the board and offers what you may do", () => {
    board.data = [
      item({ id: "msg_1", title: "run the tests" }),
      item({
        id: "msg_2",
        title: "push the fix",
        state: "blocked",
        claimant: "user:local:local",
        note: "waiting on review",
        check_at: "2020-01-01T00:00:00Z",
      }),
    ];
    render(<BoardPanel channelId="group:stats" />);
    expect(screen.getByTestId("board-summary")).toHaveTextContent(
      "2 open · 1 blocked · 1 past check-in",
    );
    fireEvent.click(screen.getByRole("button", { name: /Board/ }));
    expect(screen.getAllByTestId("board-item")).toHaveLength(2);
    expect(screen.getByText("past its check-in", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take it" }));
    expect(mutate.mock.calls[0][0]).toEqual({ op: "claim", item: "msg_1" });
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    expect(mutate.mock.calls[1][0]).toEqual({ op: "update", item: "msg_2", state: "doing" });
    expect(screen.getByRole("button", { name: "Let go" })).toBeInTheDocument();
  });

  it("adds an item", () => {
    board.data = [];
    render(<BoardPanel channelId="group:stats" />);
    fireEvent.click(screen.getByRole("button", { name: /Board/ }));
    fireEvent.change(screen.getByLabelText("New board item"), { target: { value: "write docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mutate.mock.calls[0][0]).toEqual({ op: "add", title: "write docs" });
  });
});
