import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import ChannelView from "../pages/ChannelView";

// Runtime ADR-095 D6: a DM with another person opens beside your pekos'
// chats, in the conversation view groups use (no peko runs, steering, or
// suggested replies to show).
export const Route = createFileRoute("/people/$channelId")({
  component: ChannelView,
  validateSearch: z.object({ runtimeId: z.string().optional() }),
});
