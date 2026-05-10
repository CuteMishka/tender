import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bell, CheckCheck, Clock, Gavel, Megaphone, MessageSquare, RefreshCw, Trash2, Users, X } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { pushNotification, useNotifications, type AppNotification, type NotificationCategory } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin/notifications")({
  component: NotificationsPage,
});

const categoryMeta: Record<NotificationCategory | "all", { label: string; icon: React.ElementType }> = {
  all: { label: "Все", icon: Bell },
  deadline: { label: "Дедлайны", icon: Clock },
  appeal: { label: "Обжалования", icon: Gavel },
  updates: { label: "Обновления", icon: RefreshCw },
  mentions: { label: "Упоминания", icon: MessageSquare },
  review: { label: "Ревью и решения", icon: Users },
};

const typeTone: Record<AppNotification["type"], string> = {
  success: "bg-green-100 text-green-700",
  warning: "bg-orange-100 text-orange-700",
  error: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("ru-KZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getDateGroup(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) return "На этой неделе";
  return "Ранее";
}

const DATE_GROUP_ORDER = ["Сегодня", "Вчера", "На этой неделе", "Ранее"];

function seedNotifications() {
  pushNotification("warning", "Дедлайн через 2 дня", "Лот требует первичной фильтрации и решения по участию.", "/tenders", "deadline");
  pushNotification("info", "Новый лот по ключевым словам", "Парсер нашёл закупку по справочнику ключевых слов.", "/tenders", "updates");
  pushNotification("success", "Заказчик добавлен в избранное", "Отслеживание заказчика активно для новых закупок.", "/analytics/customers", "mentions");
}

function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAllRead, markCategoryRead, markRead, clearAll, remove } = useNotifications();
  const [active, setActive] = useState<NotificationCategory | "all">("all");

  const tabs = useMemo(() => (["all", "deadline", "appeal", "updates", "mentions", "review"] as const).map((key) => {
    const count = key === "all" ? notifications.length : notifications.filter((n) => n.category === key).length;
    const unread = key === "all" ? unreadCount : notifications.filter((n) => n.category === key && !n.read).length;
    return { key, count, unread, ...categoryMeta[key] };
  }), [notifications, unreadCount]);

  const visible = active === "all" ? notifications : notifications.filter((n) => n.category === active);

  const grouped = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    for (const n of visible) {
      const g = getDateGroup(n.timestamp);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(n);
    }
    const result: { group: string; items: AppNotification[] }[] = [];
    for (const g of DATE_GROUP_ORDER) {
      if (map.has(g)) result.push({ group: g, items: map.get(g)! });
    }
    return result;
  }, [visible]);

  return (
    <>
      <PageHeader
        title="Уведомления"
        description={`${unreadCount} непрочитанных · дедлайны, обновления, упоминания и ревью`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={seedNotifications} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
              <Megaphone className="h-4 w-4" /> Тестовые
            </button>
            <button onClick={() => active === "all" ? markAllRead() : markCategoryRead(active)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
              <CheckCheck className="h-4 w-4" /> Отметить прочитанными
            </button>
            <button onClick={clearAll} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" /> Очистить
            </button>
          </div>
        }
      />

      <div className="space-y-5 p-8">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${active === tab.key ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-accent"}`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active === tab.key ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>{tab.count}</span>
                {tab.unread > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">{tab.unread}</span>}
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Bell className="mb-3 h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">Уведомлений пока нет</p>
              <p className="mt-1 text-xs">Они появятся при действиях с тендерами, заказчиками и дедлайнами.</p>
            </div>
          ) : (
            <div>
              {grouped.map(({ group, items }) => (
                <div key={group}>
                  <div className="sticky top-0 z-10 border-b border-border bg-muted/60 px-6 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {group} <span className="ml-1 font-normal normal-case">· {items.length}</span>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((n) => (
                      <div key={n.id} className={`group flex gap-4 px-6 py-4 transition hover:bg-muted/30 ${!n.read ? "bg-primary/5" : ""}`}>
                        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? "bg-muted-foreground/30" : "bg-primary"}`} />
                        <button
                          onClick={() => {
                            markRead(n.id);
                            if (n.link) navigate({ to: n.link as any });
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${typeTone[n.type]}`}>{n.type}</span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{categoryMeta[n.category].label}</span>
                            <span className="text-xs text-muted-foreground">{formatTime(n.timestamp)}</span>
                          </div>
                          <p className="mt-1 font-semibold text-foreground">{n.title}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                        </button>
                        <button onClick={() => remove(n.id)} className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
                          <X className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
