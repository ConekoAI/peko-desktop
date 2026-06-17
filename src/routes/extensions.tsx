import { createFileRoute } from "@tanstack/react-router";
import Extensions from "../pages/Extensions";

export const Route = createFileRoute("/extensions")({
  component: Extensions,
});
