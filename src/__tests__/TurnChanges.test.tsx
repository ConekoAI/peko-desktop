// Undo a turn (runtime ADR-117): the newest recent turn that changed files
// shows above the composer, with its files and Undo.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mutateAsync = vi.fn();
vi.mock("../hooks/usePrincipals", () => ({
  useUndoTurn: () => ({ mutateAsync, isPending: false }),
}));

import TurnChangesStrip from "../components/chat/TurnChanges";
import type { TurnChanges } from "../types";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const TURN: TurnChanges = {
  turn: "run-2",
  updatedAt: "2026-11-22T11:58:00Z",
  files: [
    { path: "kb/notes.md", change: "modified" },
    { path: "kb/new.md", change: "added" },
  ],
  shell: true,
  undoneAt: null,
};

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({
    restored: ["kb/notes.md"],
    skipped: [{ path: "kb/new.md", why: "changed since" }],
  });
});

describe("TurnChangesStrip", () => {
  it("renders nothing without a recent turn to undo", () => {
    const old = { ...TURN, updatedAt: "2026-11-20T10:00:00Z" };
    const undone = { ...TURN, turn: "run-1", undoneAt: "2026-11-22T11:59:00Z" };
    const { container } = render(<TurnChangesStrip peko="mochi" turns={[undone, old]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the count, lists the files on demand, and notes shell commands", () => {
    render(<TurnChangesStrip peko="mochi" turns={[TURN]} now={NOW} />);
    expect(screen.getByTestId("turn-changes")).toHaveTextContent("mochi changed 2 files");
    expect(screen.queryByTestId("turn-changes-files")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /mochi changed 2 files/ }));
    expect(screen.getByTestId("turn-changes-files")).toHaveTextContent("kb/notes.md");
    expect(screen.getByTestId("turn-changes")).toHaveTextContent("shell commands");
  });

  it("undoes the turn and says what was put back and what was left", async () => {
    render(<TurnChangesStrip peko="mochi" turns={[TURN]} now={NOW} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    });
    expect(mutateAsync).toHaveBeenCalledWith({ name: "mochi", turn: "run-2" });
    const result = screen.getByTestId("turn-changes-result");
    expect(result).toHaveTextContent("Put back 1 file.");
    expect(result).toHaveTextContent("Left kb/new.md alone: changed since");
  });

  it("hides a turn when dismissed", () => {
    render(<TurnChangesStrip peko="mochi" turns={[TURN]} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(screen.queryByTestId("turn-changes")).toBeNull();
  });
});
