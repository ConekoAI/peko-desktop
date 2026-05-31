import { RootRoute, Route, Router } from "@tanstack/react-router";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import Teams from "./pages/Teams";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import Extensions from "./pages/Extensions";
import Registry from "./pages/Registry";
import Cron from "./pages/Cron";
import EventBus from "./pages/EventBus";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";

const rootRoute = new RootRoute({
  component: App,
});

const indexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const agentsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: Agents,
});

const agentDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/agents/$name",
  component: AgentDetail,
});

const teamsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/teams",
  component: Teams,
});

const sessionsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: Sessions,
});

const sessionDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/sessions/$id",
  component: SessionDetail,
});

const extensionsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/extensions",
  component: Extensions,
});

const registryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/registry",
  component: Registry,
});

const cronRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/cron",
  component: Cron,
});

const eventBusRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/event-bus",
  component: EventBus,
});

const logsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/logs",
  component: Logs,
});

const settingsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  agentsRoute,
  agentDetailRoute,
  teamsRoute,
  sessionsRoute,
  sessionDetailRoute,
  extensionsRoute,
  registryRoute,
  cronRoute,
  eventBusRoute,
  logsRoute,
  settingsRoute,
]);

export const router = new Router({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
