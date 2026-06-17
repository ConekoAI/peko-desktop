import { createFileRoute } from "@tanstack/react-router";
import Teams from "../pages/Teams";

export const Route = createFileRoute("/teams")({
  component: Teams,
});
