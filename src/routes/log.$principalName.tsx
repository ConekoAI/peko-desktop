import { createFileRoute } from "@tanstack/react-router";
import PrincipalLog from "../pages/PrincipalLog";

export const Route = createFileRoute("/log/$principalName")({
  component: PrincipalLog,
});