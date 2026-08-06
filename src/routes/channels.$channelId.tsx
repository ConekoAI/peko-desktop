import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import ChannelView from "../pages/ChannelView";

// PR-1: thread `runtimeId` through the route so the cross-runtime
// channel case (`hub:<url>` style ids) routes through HubRemoteClient
// in PR #5. PR-2a adds `sender` — the principal posting as — because
// the runtime enforces channel membership on every post. The sidebar
// links stamp `sender` from the active principal; deep-links / CLI
// opens default to no sender (composer disabled).
const channelSearchSchema = z.object({
  runtimeId: z.string().optional(),
  sender: z.string().optional(),
});

export const Route = createFileRoute("/channels/$channelId")({
  component: ChannelView,
  validateSearch: channelSearchSchema,
});