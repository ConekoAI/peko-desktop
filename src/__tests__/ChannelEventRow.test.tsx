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
  usePrincipals: () => ({
    data: [
      { name: "alice", localId: "prin_alice", avatar: "🦊", runtimeId: "local" },
      { name: "bob", localId: "prin_bob", runtimeId: "local" },
    ],
  }),
}));

import ChannelEventRow from "../components/ChannelEventRow";

describe("ChannelEventRow", () => {
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
    expect(screen.getByText("alice")).toHaveAttribute("title", "principal:local:prin_alice");
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
    expect(screen.getByText("principal:hub:7f1c")).toBeInTheDocument();
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
});