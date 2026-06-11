import { RootRoute, Route, Router } from "@tanstack/react-router";
import App from "./App";
import Chat from "./pages/Chat";
import Teams from "./pages/Teams";
import TeamDetail from "./pages/TeamDetail";
import Extensions from "./pages/Extensions";
import Registry from "./pages/Registry";
import Cron from "./pages/Cron";
import EventBus from "./pages/EventBus";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import Shared from "./pages/Shared";

const rootRoute = new RootRoute({
  component: App,
});

// Home / Personal chat — shows all agents, no team context
const chatRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Chat,
});

const chatHomeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: Chat,
});

const chatPersonalAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$agentName",
  component: Chat,
});

const chatPersonalAgentSessionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$agentName/$sessionId",
  component: Chat,
});

// Team chat — shows team members only
const chatTeamRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/team/$teamName",
  component: Chat,
});

const chatTeamAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/team/$teamName/$agentName",
  component: Chat,
});

const chatTeamAgentSessionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/team/$teamName/$agentName/$sessionId",
  component: Chat,
});

const teamsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/teams",
  component: Teams,
});

const teamDetailRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/teams/$name",
  component: TeamDetail,
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

const sharedRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/shared",
  component: Shared,
});

export const routeTree = rootRoute.addChildren([
  chatRoute,
  chatHomeRoute,
  chatPersonalAgentRoute,
  chatPersonalAgentSessionRoute,
  chatTeamRoute,
  chatTeamAgentRoute,
  chatTeamAgentSessionRoute,
  teamsRoute,
  teamDetailRoute,
  extensionsRoute,
  registryRoute,
  sharedRoute,
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
