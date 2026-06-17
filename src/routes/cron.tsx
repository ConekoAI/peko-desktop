import { createFileRoute } from "@tanstack/react-router";
import Cron from "../pages/Cron";

export const Route = createFileRoute("/cron")({
  component: Cron,
});
