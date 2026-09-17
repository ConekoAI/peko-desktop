import { createFileRoute } from "@tanstack/react-router";
import PrincipalCapabilities from "../pages/PrincipalCapabilities";

export const Route = createFileRoute("/peko/$pekoName")({
  component: PrincipalCapabilities,
});
