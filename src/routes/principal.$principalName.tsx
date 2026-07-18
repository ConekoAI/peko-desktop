import { createFileRoute } from "@tanstack/react-router";
import PrincipalCapabilities from "../pages/PrincipalCapabilities";

export const Route = createFileRoute("/principal/$principalName")({
  component: PrincipalCapabilities,
});
