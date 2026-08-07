import { createFileRoute } from "@tanstack/react-router";
import Channels from "../pages/Channels";

export const Route = createFileRoute("/channels")({
  component: Channels,
});