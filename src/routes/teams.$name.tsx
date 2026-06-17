import { createFileRoute } from "@tanstack/react-router";
import TeamDetail from "../pages/TeamDetail";

export const Route = createFileRoute("/teams/$name")({
  component: TeamDetail,
});
