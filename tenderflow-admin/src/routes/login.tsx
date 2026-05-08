import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Cloud, Lock, User, AlertCircle } from "lucide-react";
import { login } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Вход — Freedom Cloud Админ" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setTimeout(() => {
      if (login(username.trim(), password)) {
        window.location.href = "/dashboard";
      } else {
        setError("Неверный логин или пароль");
        setLoading(false);
      }
    }, 300);
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-primary)" }}
        />
        <div
          className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-primary)" }}
        />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-primary-foreground"
            style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
          >
            <Cloud className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold text-white">Freedom Cloud</h1>
          <p className="mt-2 text-sm text-white/70">Панель администратора</p>
        </div>

        <div
          className="rounded-2xl border border-white/10 bg-card/95 p-8 backdrop-blur-xl"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <h2 className="mb-1 text-xl font-semibold text-foreground">Добро пожаловать</h2>
          <p className="mb-6 text-sm text-muted-foreground">Войдите, чтобы продолжить работу</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Логин</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Пароль</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  required
                  className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-60"
              style={{
                background: "var(--gradient-primary)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              {loading ? "Вход..." : "Войти"}
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/50 p-3 text-center text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Демо-доступ:</span> admin / admin
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-white/60">
          © 2026 Freedom Cloud. Все права защищены.
        </p>
      </div>
    </div>
  );
}
