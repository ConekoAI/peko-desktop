import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import ChannelView from "../pages/ChannelView";

// PR-1: thread `runtimeId` through the route so the cross-runtime
// channel case (`hub:<url>` style ids) routes through HubRemoteClient
// in PR #5. Mirrors chat.$principalName.tsx.
const channelSearchSchema = z.object({
  runtimeId: z.string().optional(),
});

export const Route = createFileRoute("/channels/$channelId")({
  component: ChannelView,
  validateSearch: channelSearchSchema,
});