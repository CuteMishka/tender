import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Gavel, FileText, Building2, DollarSign, Download, ArrowRight, ChevronRight, Bell } from "lucide-react";
import { getLocalApiBase, formatTenderAmount, formatDate, getTenderStatus } from "@/lib/tenders-api";
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

interface DashboardDynamicsPoint {
  date: string;
  label: string;
  count: number;
  created_count?: number;
  updated_count?: number;
}

const STATUS_RU: Record<string, { label: string; cls: string }> = {
  active:        { label: "Активный",   cls: "bg-green-100 text-green-700" },
  participating: { label: "Участвуем",  cls: "bg-blue-100 text-blue-700" },
  rejected:      { label: "Отклонён",   cls: "bg-red-100 text-red-600" },
};

const deadlineClass: Record<string, string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  orange: "border-yellow-200 bg-yellow-50 text-yellow-800",
  red: "border-red-200 bg-red-50 text-red-700",
  gray: "border-border bg-muted text-muted-foreground",
};

function Dashboard() {
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();
  const [dbStats, setDbStats] = useState({
    active_count: 0, participating_count: 0, total_amount: 0, participating_amount: 0,
  });
  const [savedLots, setSavedLots] = useState<SavedLot[]>([]);
  const [dynamics, setDynamics] = useState<DashboardDynamicsPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = getLocalApiBase();
    Promise.all([
      fetch(`${base}/api/v1/dashboard`).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/v1/dashboard/dynamics?range=all`).then((r) => r.json()).catch(() => []),
      fetch(`${base}/api/v1/lots/saved`).then((r) => r.json()).catch(() => []),
    ]).then(([stats, dynamicsRows, lots]) => {
      if (stats && !stats.error) setDbStats(stats);
      if (Array.isArray(dynamicsRows)) setDynamics(dynamicsRows);
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
      label: "Валидация лота",
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

  const fallbackChartData = Object.entries(
    savedLots.reduce<Record<string, number>>((acc, lot) => {
      const date = new Date(lot.created_at || lot.updated_at);
      if (Number.isNaN(date.getTime())) return acc;
      const key = date.toISOString().slice(0, 10);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      count,
      label: new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
    }));
  const rawChartData = dynamics.length > 0 ? dynamics.map((item) => {
    const created = item.created_count == null ? Number(item.count) || 0 : Number(item.created_count) || 0;
    const updated = item.updated_count == null ? 0 : Number(item.updated_count) || 0;
    const count = Math.max(Number(item.count) || 0, created + updated);
    return {
      count,
      created,
      updated,
      label: item.label,
    };
  }) : fallbackChartData.map((item) => ({ ...item, created: item.count, updated: 0 }));
  const chartWindow = rawChartData.length > 18 ? rawChartData.slice(-18) : rawChartData;
  const totalDynamicsCount = rawChartData.reduce((sum, item) => sum + item.count, 0);
  const activeDaysCount = rawChartData.filter((item) => item.count > 0).length;
  const maxCount = Math.max(...chartWindow.map((item) => item.count), 1);
  const chartData = chartWindow.map((item) => {
    const height = item.count === 0 ? 6 : Math.max(28, Math.round((item.count / maxCount) * 148));
    return {
      ...item,
      height,
      createdShare: item.count > 0 ? (item.created / item.count) * 100 : 0,
      updatedShare: item.count > 0 ? (item.updated / item.count) * 100 : 0,
    };
  });

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">Динамика заявок</h3>
              <p className="text-xs text-muted-foreground">Новые и обновленные заявки за все время</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                {totalDynamicsCount} событий
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                {activeDaysCount} активных дн.
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Новые
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-300" /> Обновления
              </span>
              <Link
                to="/bids"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Все заявки <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div
              className="flex h-56 items-end gap-2 border-b border-border/70 pb-3"
              style={{ minWidth: `${Math.max(chartData.length, 7) * 56}px` }}
            >
              {chartData.map((d, i) => (
                <div key={`${d.label}-${i}`} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md group-hover:block">
                    <div className="font-semibold text-foreground">{d.label}: {d.count}</div>
                    <div className="mt-1 text-muted-foreground">Новые: {d.created}</div>
                    <div className="text-muted-foreground">Обновления: {d.updated}</div>
                  </div>
                  <div className="flex h-40 w-full items-end">
                    <div
                      className="flex w-full min-w-8 flex-col justify-end overflow-hidden rounded-t-lg bg-muted transition-all duration-300 group-hover:opacity-85"
                      style={{ height: `${d.height}px` }}
                    >
                      {d.updated > 0 && (
                        <span
                          className="block w-full bg-emerald-300"
                          style={{ height: `${Math.max(d.updatedShare, d.created > 0 ? 18 : 100)}%` }}
                        />
                      )}
                      {d.created > 0 && (
                        <span
                          className="block w-full bg-primary"
                          style={{ height: `${Math.max(d.createdShare, d.updated > 0 ? 18 : 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{d.label}</span>
                </div>
              ))}
            </div>
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
                    const deadlineValue = t.deadline || t.end_date;
                    const deadlineInfo = getTenderStatus(deadlineValue);
                    const isExpiring = deadlineInfo.color === "red" || deadlineInfo.color === "orange";
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
                          {deadlineValue ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-foreground">{formatDate(deadlineValue)}</span>
                              <span className={`w-fit rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${deadlineClass[deadlineInfo.color]}`}>
                                {deadlineInfo.daysLeft === null ? "—" : deadlineInfo.daysLeft < 0 ? "истёк" : deadlineInfo.daysLeft === 0 ? "сегодня" : `${deadlineInfo.daysLeft} дн.`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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
