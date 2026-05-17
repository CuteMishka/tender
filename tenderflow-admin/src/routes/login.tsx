import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AlertCircle, Building2, Cloud, Lock, MessageSquare, Send, User } from "lucide-react";
import { login, submitRegistrationRequest } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Вход — Freedom Cloud Админ" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<"login" | "request">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestPassword, setRequestPassword] = useState("");
  const [requestCompany, setRequestCompany] = useState("");
  const [requestPosition, setRequestPosition] = useState("");
  const [requestComment, setRequestComment] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await login(username.trim(), password);
      window.location.href = "/dashboard";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неверный логин или пароль");
      setLoading(false);
    }
  };

  const handleRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await submitRegistrationRequest({
        name: requestName.trim(),
        email: requestEmail.trim(),
        password: requestPassword,
        company: requestCompany.trim(),
        position: requestPosition.trim(),
        comment: requestComment.trim(),
      });
      setSuccess("Заявка отправлена. Директор или админ рассмотрит её и назначит роль.");
      setRequestName("");
      setRequestEmail("");
      setRequestPassword("");
      setRequestCompany("");
      setRequestPosition("");
      setRequestComment("");
      setMode("login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить заявку");
    } finally {
      setLoading(false);
    }
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
          <h2 className="mb-1 text-xl font-semibold text-foreground">
            {mode === "login" ? "Добро пожаловать" : "Заявка на регистрацию"}
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            {mode === "login" ? "Войдите, чтобы продолжить работу" : "После одобрения директор назначит вашу роль"}
          </p>

          {mode === "login" ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="name@company.kz"
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
            <button
              type="button"
              onClick={() => { setMode("request"); setError(""); setSuccess(""); }}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-accent"
            >
              Подать заявку на регистрацию
            </button>
          </form>
          ) : (
          <form onSubmit={handleRequest} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">ФИО</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={requestName} onChange={(e) => setRequestName(e.target.value)} required className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input type="email" value={requestEmail} onChange={(e) => setRequestEmail(e.target.value)} required className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Пароль</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input type="password" value={requestPassword} onChange={(e) => setRequestPassword(e.target.value)} required className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Компания</label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={requestCompany} onChange={(e) => setRequestCompany(e.target.value)} className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Должность</label>
                <input value={requestPosition} onChange={(e) => setRequestPosition(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Комментарий</label>
              <div className="relative">
                <MessageSquare className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <textarea value={requestComment} onChange={(e) => setRequestComment(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-60" style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-md)" }}>
              <Send className="h-4 w-4" />
              {loading ? "Отправка..." : "Отправить заявку"}
            </button>
            <button type="button" onClick={() => { setMode("login"); setError(""); }} className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-accent">
              Вернуться ко входу
            </button>
          </form>
          )}
          {success && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {success}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/60">
          © 2026 Freedom Cloud. Все права защищены.
        </p>
      </div>
    </div>
  );
}
