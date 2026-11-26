// Runtime ADR-128: the strip a group shows when other pekos have woken
// one of yours as often as its limit allows.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const infoState: { data: unknown } = { data: undefined };
const wakesByPeko: Record<string, unknown> = {};
const change = { mutate: vi.fn(), isPending: false, error: null as Error | null };

vi.mock("../hooks/useChannels", () => ({
  useChannelInfo: () => infoState,
  useChannelWakes: (_channel: string, peko: string) => ({ data: wakesByPeko[peko] }),
  useChangeChannelWakes: () => change,
}));

import HeldWakes from "../components/HeldWakes";

describe("HeldWakes", () => {
  beforeEach(() => {
    change.mutate.mockReset();
    for (const key of Object.keys(wakesByPeko)) delete wakesByPeko[key];
    infoState.data = {
      kind: "group",
      pekos: [
        { name: "juno", localId: "prin_j", wake: "mention" },
        { name: "otto", localId: "prin_o", wake: "mention" },
      ],
    };
  });

  it("names the peko that is held and lets you let it continue", () => {
    wakesByPeko.juno = { perHour: "60", perDay: "300", spentHour: 3, spentDay: 3, held: 0, freeAt: null };
    wakesByPeko.otto = { perHour: "2", perDay: "300", spentHour: 2, spentDay: 2, held: 3, freeAt: null };
    render(<HeldWakes channelId="group:team" />);
    expect(screen.queryByTestId("held-wakes-juno")).toBeNull();
    expect(screen.getByTestId("held-wakes-otto")).toHaveTextContent(
      "Other pekos have woken otto as often as its limit allows. Messages waiting for it: 3.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Let it continue" }));
    expect(change.mutate).toHaveBeenCalledWith({ pekoName: "otto", reset: true });
  });

  it("says when it continues by itself", () => {
    wakesByPeko.otto = {
      perHour: "2",
      perDay: "300",
      spentHour: 2,
      spentDay: 2,
      held: 1,
      freeAt: "2026-11-26T06:44:44+00:00",
    };
    render(<HeldWakes channelId="group:team" />);
    expect(screen.getByTestId("held-wakes-otto")).toHaveTextContent(/It continues at \d/);
  });

  it("shows nothing in a DM, or when nothing is held", () => {
    render(<HeldWakes channelId="group:team" />);
    expect(screen.queryByRole("button")).toBeNull();
    infoState.data = { kind: "dm", pekos: [{ name: "otto", localId: "prin_o", wake: "human" }] };
    wakesByPeko.otto = { perHour: "2", perDay: "300", spentHour: 2, spentDay: 2, held: 3, freeAt: null };
    render(<HeldWakes channelId="dm_x" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
