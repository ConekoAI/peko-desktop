import { createFileRoute } from "@tanstack/react-router";
import DaemonLogs from "../pages/DaemonLogs";

export const Route = createFileRoute("/daemon-logs")({
  component: DaemonLogs,
});