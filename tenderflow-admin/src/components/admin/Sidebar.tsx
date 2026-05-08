import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, FileText, Gavel, Settings, LogOut, Cloud,
  BarChart2, History, Building2, Trophy, TrendingDown, ChevronDown, ChevronRight,
} from "lucide-react";
import { logout } from "@/lib/auth";
import { useState } from "react";

const mainNav = [
  { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { to: "/tenders", label: "Тендеры", icon: Gavel, search: { page: 1 } },
  { to: "/bids", label: "Заявки", icon: FileText },
] as const;

const analyticsNav = [
  { to: "/analytics/historical", label: "История тендеров", icon: History },
  { to: "/analytics/customers", label: "Заказчики", icon: Building2 },
  { to: "/analytics/winners", label: "Победители", icon: Trophy },
  { to: "/analytics/prices", label: "Анализ цен", icon: TrendingDown },
] as const;

const bottomNav = [
  { to: "/settings", label: "Настройки", icon: Settings },
] as const;

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAnalytics = location.pathname.startsWith("/analytics");
  const [analyticsOpen, setAnalyticsOpen] = useState(isAnalytics);

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Cloud className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-bold">Freedom Cloud</h1>
          <p className="text-xs text-sidebar-foreground/60">Админ-панель</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {/* Основная навигация */}
        {mainNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              {...("search" in item ? { search: item.search } : {})}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {/* Разделитель */}
        <div className="pt-3 pb-1">
          <button
            onClick={() => setAnalyticsOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
          >
            <BarChart2 className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Аналитика</span>
            {analyticsOpen
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Подменю аналитики */}
        {analyticsOpen && (
          <div className="space-y-0.5 pl-2">
            {analyticsNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}

        {/* Настройки */}
        <div className="pt-1">
          {bottomNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-3 flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary font-semibold text-sidebar-primary-foreground">
            A
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Администратор</p>
            <p className="truncate text-xs text-sidebar-foreground/60">admin@tender.ru</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
