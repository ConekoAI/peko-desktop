import { createFileRoute } from "@tanstack/react-router";
import SessionDetail from "../pages/SessionDetail";

export const Route = createFileRoute("/sessions/$id")({
  component: SessionDetail,
});
