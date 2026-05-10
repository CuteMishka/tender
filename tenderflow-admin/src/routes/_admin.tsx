import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/admin/Sidebar";
import { isAuthenticated } from "@/lib/auth";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin")({
  component: AdminLayout,
});

const typeStyles: Record<AppNotification["type"], { dot: string; bg: string }> = {
  success: { dot: "bg-green-500", bg: "border-l-green-500" },
  warning: { dot: "bg-yellow-500", bg: "border-l-yellow-500" },
  error: { dot: "bg-red-500", bg: "border-l-red-500" },
  info: { dot: "bg-blue-500", bg: "border-l-blue-500" },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин. назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч. назад`;
  return `${Math.floor(h / 24)} дн. назад`;
}

function NotificationBell() {
  const { notifications, unreadCount, markAllRead, markRead, clearAll, remove } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Уведомления"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl animate-in fade-in-0 slide-in-from-top-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Уведомления</span>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <>
                  <button
                    onClick={markAllRead}
                    title="Отметить все как прочитанные"
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={clearAll}
                    title="Очистить все"
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <Bell className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">Нет уведомлений</p>
              </div>
            ) : (
              notifications.map((n) => {
                const s = typeStyles[n.type];
                return (
                  <div
                    key={n.id}
                    className={`group relative border-l-2 px-4 py-3 transition hover:bg-muted/40 ${s.bg} ${!n.read ? "bg-muted/20" : ""}`}
                    onClick={() => {
                      markRead(n.id);
                      if (n.link) {
                        setOpen(false);
                        navigate({ to: n.link as any });
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground">{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground/60">{timeAgo(n.timestamp)}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                        className="invisible shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:visible"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-border px-4 py-2">
            <button
              onClick={() => {
                setOpen(false);
                navigate({ to: "/notifications" as any });
              }}
              className="w-full rounded-lg px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent"
            >
              Открыть центр уведомлений
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate({ to: "/login", replace: true });
    } else {
      setReady(true);
    }
  }, [navigate]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="fixed right-6 top-4 z-40">
          <NotificationBell />
        </div>
        <main className="flex-1 overflow-y-auto">
          <div key={location.pathname} className="animate-in fade-in-0 slide-in-from-bottom-3 duration-200 min-h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
