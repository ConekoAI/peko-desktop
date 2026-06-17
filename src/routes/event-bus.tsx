import { createFileRoute } from "@tanstack/react-router";
import EventBus from "../pages/EventBus";

export const Route = createFileRoute("/event-bus")({
  component: EventBus,
});
