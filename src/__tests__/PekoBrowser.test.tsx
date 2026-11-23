// The peko's browser (runtime ADR-119): the strip under the thread, and
// the viewer where the owner takes control, acts, and hands back.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const principalBrowser = vi.fn();
vi.mock("../lib/api", () => ({
  principalBrowser: (...args: unknown[]) => principalBrowser(...args),
}));

import PekoBrowser from "../components/chat/PekoBrowser";
import type { BrowserState } from "../types";

const IDLE: BrowserState = { running: false, available: true, tabs: [], controller: null, handoff: null };
const WAITING: BrowserState = {
  running: true,
  available: true,
  tabs: [{ tab: "t1", url: "https://shop.example/login", title: "Sign in" }],
  controller: null,
  handoff: { why: "Sign in to the shop for me", tab: "t1", url: "https://shop.example/login", at: "2026-11-23T10:00:00Z" },
};

beforeEach(() => {
  principalBrowser.mockReset().mockImplementation(async (_peko: string, _runtime: string, verb: string) => {
    if (verb === "frame") {
      await new Promise((r) => setTimeout(r, 20));
      return { seq: 1, tab: "t1", width: 800, height: 600, data: "AAAA", controller: null };
    }
    if (verb === "state") return WAITING;
    return { ok: true };
  });
});

const calls = (verb: string) => principalBrowser.mock.calls.filter((c) => c[2] === verb);

describe("PekoBrowser", () => {
  it("shows nothing while the peko has no browser open", () => {
    const { container } = render(<PekoBrowser peko="mochi" runtimeId="local" state={IDLE} onChanged={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says why the peko needs you", () => {
    render(<PekoBrowser peko="mochi" runtimeId="local" state={WAITING} onChanged={() => {}} />);
    expect(screen.getByTestId("browser-strip")).toHaveTextContent("mochi needs you in its browser");
    expect(screen.getByTestId("browser-strip")).toHaveTextContent("Sign in to the shop for me");
  });

  it("sends nothing to the page until you take control, then clicks, typing, and handing back", async () => {
    const onChanged = vi.fn();
    render(<PekoBrowser peko="mochi" runtimeId="local" state={WAITING} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId("browser-open"));
    const frame = await screen.findByTestId("browser-frame");
    expect(calls("frame")[0][3]).toMatchObject({ tab: "t1", after: 0 });

    // Watching only: a click on the page goes nowhere.
    fireEvent.click(frame, { clientX: 10, clientY: 10 });
    expect(calls("input")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId("browser-take"));
    });
    expect(calls("control")[0][3]).toEqual({ take: true });
    expect(screen.getByTestId("browser-status")).toHaveTextContent("You have control");

    fireEvent.click(screen.getByTestId("browser-frame"), { clientX: 10, clientY: 10 });
    await waitFor(() => expect(calls("input")).toHaveLength(1));
    expect(calls("input")[0][3].events[0]).toMatchObject({ t: "click" });

    // Text for the page is sent once and not kept in the box.
    const box = screen.getByTestId("browser-text") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "hunter2hunter2" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(calls("input")).toHaveLength(2));
    expect(calls("input")[1][3].events).toEqual([{ t: "text", text: "hunter2hunter2" }]);
    expect(box.value).toBe("");

    // A key goes as a key.
    fireEvent.keyDown(screen.getByTestId("browser-stage"), { key: "Enter" });
    await waitFor(() => expect(calls("input")).toHaveLength(3));
    expect(calls("input")[2][3].events).toEqual([{ t: "key", key: "Enter" }]);

    // Closing the viewer hands the browser back.
    await act(async () => {
      fireEvent.click(screen.getByTestId("browser-close"));
    });
    await waitFor(() => expect(calls("control")).toHaveLength(2));
    expect(calls("control")[1][3]).toEqual({ take: false });
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not offer control while another device holds it", async () => {
    principalBrowser.mockImplementation(async (_p: string, _r: string, verb: string) =>
      verb === "frame" ? { seq: 1, tab: "t1", width: 800, height: 600, data: "AAAA", controller: "device:d1" } : WAITING,
    );
    render(<PekoBrowser peko="mochi" runtimeId="hub:abc" state={WAITING} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId("browser-open"));
    await screen.findByTestId("browser-frame");
    await waitFor(() => expect(screen.getByTestId("browser-take")).toBeDisabled());
    expect(screen.getByTestId("browser-status")).toHaveTextContent("Another of your devices");
  });
});
