import { RootRoute, Route, Router } from "@tanstack/react-router";
import App from "./App";
import Chat from "./pages/Chat";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import Teams from "./pages/Teams";
import TeamDetail from "./pages/TeamDetail";
import Extensions from "./pages/Extensions";
import Registry from "./pages/Registry";
import Cron from "./pages/Cron";
import EventBus from "./pages/EventBus";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";

const rootRoute = new RootRoute({
  component: App,
});

// Chat is the default landing page — redirects to first team/agent
const chatRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Chat,
});

const chatTeamRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$teamName",
  component: Chat,
});

const chatTeamAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$teamName/$agentName",
  component: Chat,
});

const chatTeamAgentSessionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$teamName/$agentName/$sessionId",
  component: Chat,
});

// Legacy redirects for bookmarks
const chatAgentRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$agentName",
  component: Chat,
});

const chatAgentSessionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/chat/$agentName/$sessionId",
  component: Chat,
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

export const routeTree = rootRoute.addChildren([
  chatRoute,
  chatTeamRoute,
  chatTeamAgentRoute,
  chatTeamAgentSessionRoute,
  chatAgentRoute,
  chatAgentSessionRoute,
  agentsRoute,
  agentDetailRoute,
  teamsRoute,
  teamDetailRoute,
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
