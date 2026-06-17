import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import Layout from "../components/Layout";

export const Route = createRootRouteWithContext<{
  // intentionally empty: no router context yet
  // stub kept so future context additions don't require a Route rewrite
}>()({
  component: Root,
});

function Root() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
