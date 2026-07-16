import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    getSession()
      .then((user) => {
        if (!active) return;
        navigate({ to: user ? "/dashboard" : "/login", replace: true });
      })
      .catch(() => {
        if (active) navigate({ to: "/login", replace: true });
      });
    return () => { active = false; };
  }, [navigate]);

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="text-center text-white">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <p className="text-sm opacity-80">Загрузка...</p>
      </div>
    </div>
  );
}
