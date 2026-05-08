import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, FileText, Gavel, Settings, LogOut, Cloud } from "lucide-react";
import { logout } from "@/lib/auth";

const navItems = [
  { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { to: "/tenders", label: "Тендеры", icon: Gavel },
  { to: "/bids", label: "Заявки", icon: FileText },
  { to: "/settings", label: "Настройки", icon: Settings },
] as const;

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Cloud className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-bold">Freedom Cloud</h1>
          <p className="text-xs text-sidebar-foreground/60">Админ-панель</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

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
