import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import Chat from "../pages/Chat";

// PR #3: declared `runtimeId` search-param schema so the URL like
// `/chat/coding-assistant?runtimeId=hub:pekohub.org` is parsed
// server-side / router-side instead of being read loosely via
// `useSearch({ strict: false })`. The decode shape is intentionally
// permissive — `runtimeId` is optional and undefined / "local" both
// resolve to the local IPC client downstream.
const chatSearchSchema = z.object({
  runtimeId: z.string().optional(),
});

export const Route = createFileRoute("/chat/$principalName")({
  component: Chat,
  validateSearch: chatSearchSchema,
});