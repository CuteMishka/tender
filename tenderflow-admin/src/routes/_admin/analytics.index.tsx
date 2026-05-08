import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/analytics/")({
  beforeLoad: () => {
    throw redirect({ to: "/analytics/historical" });
  },
  component: () => null,
});
