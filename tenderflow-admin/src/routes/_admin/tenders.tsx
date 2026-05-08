import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/tenders")({
  component: TendersLayout,
});

function TendersLayout() {
  return <Outlet />;
}
