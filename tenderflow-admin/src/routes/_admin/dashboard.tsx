import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Gavel, FileText, Building2, DollarSign, Download, ArrowRight, ChevronRight, Bell } from "lucide-react";
import { getLocalApiBase, formatTenderAmount } from "@/lib/tenders-api";
import { useNotifications } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin/dashboard")({
  component: Dashboard,
});

interface SavedLot {
  id: number;
  title: string;
  description: string;
  amount: number;
  status: string;
  deadline: string;
  start_date: string;
  end_date: string;
  purchase_type: string;
  created_at: string;
  updated_at: string;
}

const STATUS_RU: Record<string, { label: string; cls: string }> = {
  active:        { label: "Активный",   cls: "bg-green-100 text-green-700" },
  participating: { label: "Участвуем",  cls: "bg-blue-100 text-blue-700" },
  rejected:      { label: "Отклонён",   cls: "bg-red-100 text-red-600" },
};

function Dashboard() {
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();
  const [dbStats, setDbStats] = useState({
    active_count: 0, participating_count: 0, total_amount: 0, participating_amount: 0,
  });
  const [savedLots, setSavedLots] = useState<SavedLot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = getLocalApiBase();
    Promise.all([
      fetch(`${base}/api/v1/dashboard`).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/v1/lots/saved`).then((r) => r.json()).catch(() => []),
    ]).then(([stats, lots]) => {
      if (stats && !stats.error) setDbStats(stats);
      if (Array.isArray(lots)) setSavedLots(lots);
    }).finally(() => setLoading(false));
  }, []);

  const stats = [
    {
      label: "Активные тендеры",
      value: dbStats.active_count,
      display: String(dbStats.active_count),
      icon: Gavel,
      accent: "bg-primary/10 text-primary",
      border: "hover:border-primary/40",
      link: "/tenders",
    },
    {
      label: "Участвуем тендеров",
      value: dbStats.participating_count,
      display: String(dbStats.participating_count),
      icon: FileText,
      accent: "bg-green-100 text-green-600",
      border: "hover:border-green-400/40",
      link: "/bids",
    },
    {
      label: "Объём участвуем",
      value: dbStats.participating_amount,
      display: `₸ ${(dbStats.participating_amount / 1_000_000).toFixed(1)}М`,
      icon: Building2,
      accent: "bg-orange-100 text-orange-600",
      border: "hover:border-orange-400/40",
      link: "/bids",
    },
    {
      label: "Объём контрактов (всего)",
      value: dbStats.total_amount,
      display: `₸ ${(dbStats.total_amount / 1_000_000).toFixed(1)}М`,
      icon: DollarSign,
      accent: "bg-violet-100 text-violet-600",
      border: "hover:border-violet-400/40",
      link: "/bids",
    },
    {
      label: "Непрочитанных уведомлений",
      value: unreadCount,
      display: String(unreadCount),
      icon: Bell,
      accent: "bg-red-100 text-red-600",
      border: "hover:border-red-400/40",
      link: "/notifications",
    },
  ];

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const dayCounts = last7Days.map((day) => {
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    return savedLots.filter((lot) => {
      const d = new Date(lot.created_at);
      return d >= day && d < nextDay;
    }).length;
  });
  const maxCount = Math.max(...dayCounts, 1);
  const chartData = dayCounts.map((count, i) => ({
    count,
    height: count === 0 ? 4 : (count / maxCount) * 100,
    label: last7Days[i].toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", ""),
  }));

  return (
    <>
      <PageHeader
        title="Дашборд"
        description="Обзор активности тендерной площадки"
        actions={
          <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            <Download className="h-4 w-4" /> Экспорт
          </button>
        }
      />

      <div className="space-y-6 p-8">

        {/* Карточки статистики */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                onClick={() => navigate({ to: s.link as any })}
                className={`group rounded-xl border border-border bg-card p-5 text-left transition ${s.border} hover:shadow-md`}
                style={{ boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-start justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {loading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-muted" /> : s.display}
                </p>
              </button>
            );
          })}
        </div>

        {/* График динамики */}
        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Динамика заявок</h3>
              <p className="text-xs text-muted-foreground">Последние 7 дней</p>
            </div>
            <Link
              to="/bids"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Все заявки <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex h-48 items-end gap-2">
            {chartData.map((d, i) => (
              <div key={i} className="group flex flex-1 flex-col items-center gap-2">
                <span className="invisible text-xs font-medium text-foreground group-hover:visible">
                  {d.count}
                </span>
                <div
                  className="w-full rounded-t-md transition-all duration-300 hover:opacity-75"
                  style={{ height: `${d.height}%`, background: "var(--gradient-primary, #16a34a)" }}
                />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Таблица последних тендеров */}
        <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h3 className="text-base font-semibold">Последние тендеры</h3>
              <p className="text-xs text-muted-foreground">Тендеры в работе</p>
            </div>
            <Link
              to="/tenders"
              search={{ page: 1 }}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Все тендеры <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary mr-2" />
              Загрузка…
            </div>
          ) : savedLots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Gavel className="mb-3 h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">Нет тендеров в работе</p>
              <p className="mt-1 text-xs">Нажмите «Подходит» на любом тендере, чтобы добавить его</p>
              <Link
                to="/tenders"
                search={{ page: 1 }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Перейти к тендерам <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">ID</th>
                    <th className="px-6 py-3 text-left font-medium">Название</th>
                    <th className="px-6 py-3 text-left font-medium">Вид закупа</th>
                    <th className="px-6 py-3 text-right font-medium">Сумма</th>
                    <th className="px-6 py-3 text-left font-medium">Дедлайн</th>
                    <th className="px-6 py-3 text-left font-medium">Статус</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {savedLots.slice(0, 8).map((t) => {
                    const deadlineDate = new Date(t.deadline);
                    const diffDays = Math.ceil((deadlineDate.getTime() - Date.now()) / 86_400_000);
                    const isExpiring = diffDays > 0 && diffDays <= 3;
                    const s = STATUS_RU[t.status] ?? { label: t.status, cls: "bg-muted/40 text-muted-foreground" };

                    return (
                      <tr
                        key={t.id}
                        className={`group cursor-pointer border-t border-border transition hover:bg-muted/40 ${isExpiring ? "bg-red-50/60" : ""}`}
                        onClick={() => navigate({ to: "/tenders/$tenderId", params: { tenderId: String(t.id) } })}
                      >
                        <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{t.id}</td>
                        <td className="px-6 py-4 font-medium text-foreground">
                          <span className="line-clamp-1 max-w-xs">{t.title}</span>
                        </td>
                        <td className="px-6 py-4 text-xs text-muted-foreground">{t.purchase_type || "—"}</td>
                        <td className="px-6 py-4 text-right font-semibold tabular-nums">
                          ₸ {formatTenderAmount(t.amount)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs ${isExpiring ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
                            {deadlineDate.toLocaleDateString("ru-KZ")}
                          </span>
                          {isExpiring && (
                            <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                              {diffDays} дн.
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
                            {s.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/30 transition group-hover:text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {savedLots.length > 8 && (
                <div className="border-t border-border px-6 py-3 text-center">
                  <Link to="/bids" className="text-sm font-medium text-primary hover:underline">
                    Показать ещё {savedLots.length - 8} →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
