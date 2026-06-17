import { createFileRoute } from "@tanstack/react-router";
import Shared from "../pages/Shared";

export const Route = createFileRoute("/shared")({
  component: Shared,
});
