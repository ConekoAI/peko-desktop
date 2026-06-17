import { createFileRoute } from "@tanstack/react-router";
import Registry from "../pages/Registry";

export const Route = createFileRoute("/registry")({
  component: Registry,
});
