import { createFileRoute } from "@tanstack/react-router";
import Chat from "../pages/Chat";

export const Route = createFileRoute("/chat/$principalName")({
  component: Chat,
});