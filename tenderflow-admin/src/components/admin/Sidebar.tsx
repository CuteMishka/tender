import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, FileText, Gavel, Settings, LogOut,
  BarChart3, Building2, Bell, BookOpen, Users, UserRound, BriefcaseBusiness,
} from "lucide-react";
import { canManageUsers, getCurrentUser, logout, roleLabels } from "@/lib/auth";
import { useNotifications } from "@/hooks/use-notifications";

const mainNav = [
  { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { to: "/tenders", label: "Тендеры", icon: Gavel, search: { page: 1 } },
  { to: "/workflow", label: "Воронка", icon: BriefcaseBusiness },
  { to: "/bids", label: "Заявки", icon: FileText },
  { to: "/cabinet", label: "Кабинет", icon: UserRound },
  { to: "/analytics", label: "Аналитика", icon: BarChart3 },
  { to: "/companies", label: "Компании", icon: Building2 },
  { to: "/dictionaries", label: "Справочники", icon: BookOpen },
  { to: "/notifications", label: "Уведомления", icon: Bell },
  { to: "/users", label: "Пользователи", icon: Users, manageUsers: true },
] as const;

const bottomNav = [
  { to: "/settings", label: "Настройки", icon: Settings },
] as const;

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadCount } = useNotifications();
  const user = getCurrentUser();

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
          <Gavel className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-bold">Tender</h1>
          <p className="text-xs text-sidebar-foreground/60">Админ-панель</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {/* Основная навигация */}
        {mainNav.filter((item) => !("manageUsers" in item) || canManageUsers(user)).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          const isNotifications = item.to === "/notifications";
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
              <span className="flex-1">{item.label}</span>
              {isNotifications && unreadCount > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}

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
            <p className="truncate text-sm font-medium">{user?.name || user?.email || "Пользователь"}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{user ? roleLabels[user.role] : "Гость"}</p>
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
