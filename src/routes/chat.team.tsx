import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout-only file for the /chat/team namespace. The app never navigates to
// /chat/team directly (every team link includes a team name), so this just
// renders an <Outlet /> for the deeper chat.team.* child routes.
export const Route = createFileRoute("/chat/team")({
  component: () => <Outlet />,
});
