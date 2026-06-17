import { createFileRoute } from "@tanstack/react-router";
import Sessions from "../pages/Sessions";

export const Route = createFileRoute("/sessions")({
  component: Sessions,
});
