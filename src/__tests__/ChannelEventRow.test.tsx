// src/__tests__/ChannelEventRow.test.tsx
//
// PR-2a / feature/desktop-channels: render one event row per variant.
// Extracted from ChannelView so the composer / reply / edit surfaces
// can reuse it. Validates:
//   • posted event renders the author + body
//   • created event renders the channel name + creator
//   • member_joined event renders the member name with runtime badge
//   • member_left event hides the runtime badge when showRuntimeBadge=false

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Pekos on this runtime: actors resolve to their names.
vi.mock("../hooks/usePrincipals", () => ({
  useLocalUserAccount: () => ({ data: null }),
  usePrincipals: () => ({
    data: [
      { name: "alice", localId: "prin_alice", avatar: "🦊", runtimeId: "local" },
      { name: "bob", localId: "prin_bob", runtimeId: "local" },
    ],
  }),
}));

// The channel's roster names members on other computers.
const channelInfo: { data: unknown } = { data: undefined };
vi.mock("../hooks/useChannels", () => ({
  useChannelInfo: () => channelInfo,
}));

import ChannelEventRow from "../components/ChannelEventRow";

describe("ChannelEventRow", () => {
  // Found live: a copy from another computer showed raw ids.
  it("names members on other computers and their address mentions", () => {
    channelInfo.data = {
      people: [
        { address: "principal:hub:b1ec", aliases: ["did:key:z6Mk"], kind: "principal", name: "ada", you: false, here: false },
        { address: "user:hub:7777", aliases: [], kind: "user", name: "Gina", you: false, here: false },
        { address: "user:local:local", aliases: ["user:hub:6666"], kind: "user", name: "Frank", you: true, here: true },
      ],
      createdAt: "2026-11-06T14:36:56Z",
    };
    const { unmount } = render(
      <ChannelEventRow
        event={{
          kind: "posted",
          channel: "group:tinytodo",
          author: "user:hub:7777",
          parent: null,
          text: "@principal:hub:b1ec can you take it?",
          at: "2026-11-06T14:42:19Z",
        }}
      />,
    );
    expect(screen.getByText("Gina")).toBeInTheDocument();
    expect(screen.getByText("@ada can you take it?")).toBeInTheDocument();
    unmount();
    render(
      <ChannelEventRow
        event={{
          kind: "created",
          channel: "group:tinytodo",
          creator: "principal:hub:b1ec",
          name: "tinytodo",
          at: "2026-11-06T14:42:42Z",
        }}
      />,
    );
    const created = screen.getByTestId("channel-event-row-created");
    expect(created).toHaveTextContent("created by ada");
    expect(created).toHaveTextContent(new Date("2026-11-06T14:36:56Z").toLocaleString());
    channelInfo.data = undefined;
  });

  it("renders the posted event with the body text and author chip", () => {
    render(
      <ChannelEventRow
        event={{
          kind: "posted",
          channel: "chan_alpha",
          author: "principal:local:prin_alice",
          parent: null,
          text: "first message",
          at: "2026-08-06T12:00:00Z",
        }}
      />,
    );
    expect(screen.getByTestId("channel-event-row-posted")).toBeInTheDocument();
    // The peko's name and face, not its raw id (kept as a tooltip).
    expect(screen.getByText("alice")).toHaveAttribute("title", "peko:local:prin_alice");
    expect(screen.getByTestId("peko-avatar")).toHaveTextContent("🦊");
    expect(screen.getByText("first message")).toBeInTheDocument();
  });

  it("names the local user You and leaves unknown actors as their id", () => {
    render(
      <ChannelEventRow
        event={{
          kind: "posted",
          channel: "chan_alpha",
          author: "user:local",
          parent: null,
          text: "hi all",
          at: "2026-08-06T12:00:00Z",
        }}
      />,
    );
    expect(screen.getByText("You")).toBeInTheDocument();
    render(
      <ChannelEventRow
        event={{
          kind: "member_joined",
          channel: "chan_alpha",
          member: "principal:hub:7f1c",
          at: "2026-08-06T12:00:00Z",
        }}
      />,
    );
    expect(screen.getByText("peko:hub:7f1c")).toBeInTheDocument();
  });

  it("renders the created event with the channel name + creator", () => {
    render(
      <ChannelEventRow
        event={{
          kind: "created",
          channel: "chan_alpha",
          creator: "prin_alice",
          name: "team-chat",
          at: "2026-08-06T12:00:00Z",
        }}
      />,
    );
    expect(screen.getByTestId("channel-event-row-created")).toBeInTheDocument();
    expect(screen.getByText("team-chat")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("renders the member_joined event with a runtime badge by default", () => {
    render(
      <ChannelEventRow
        event={{
          kind: "member_joined",
          channel: "chan_alpha",
          member: "prin_bob",
          at: "2026-08-06T12:01:00Z",
        }}
      />,
    );
    expect(
      screen.getByTestId("channel-event-row-member-joined"),
    ).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-badge-local")).toBeInTheDocument();
  });

  it("renders the member_left event without a runtime badge when suppressed", () => {
    render(
      <ChannelEventRow
        event={{
          kind: "member_left",
          channel: "chan_alpha",
          member: "prin_bob",
          at: "2026-08-06T12:05:00Z",
        }}
        showRuntimeBadge={false}
      />,
    );
    expect(
      screen.getByTestId("channel-event-row-member-left"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("runtime-badge-local")).toBeNull();
  });

  // Runtime ADR-101: a board change is a compact line, not a message.
  it("shows a board change as a line naming its author", () => {
    channelInfo.data = { people: [] };
    render(
      <ChannelEventRow
        event={{
          kind: "posted",
          channel: "group:stats",
          author: "principal:prin_alice",
          parent: null,
          text: "board: alice took “run the tests”",
          at: "2026-11-09T10:00:00Z",
          board: { op: "claim", item: "msg_1" },
        }}
      />,
    );
    const row = screen.getByTestId("channel-event-row-board");
    expect(row).toHaveTextContent("alice took “run the tests”");
    expect(screen.queryByTestId("channel-event-row-posted")).toBeNull();
  });
});