import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  Eye,
  Send,
  Sparkles,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { getCurrentUser, roleLabels, type UserRole } from "@/lib/auth";
import { formatTenderAmount, getAllViewInfo, getLocalApiBase, type TenderViewInfo } from "@/lib/tenders-api";

export const Route = createFileRoute("/_admin/cabinet")({
  component: Cabinet,
});

type SavedLot = {
  id: number;
  external_id?: string;
  source?: string;
  title: string;
  description?: string;
  amount: number;
  status: string;
  comment?: string;
  assigned_to?: string;
  reviewer?: string;
  action_history?: string;
  deadline?: string;
  start_date?: string;
  end_date?: string;
  purchase_type?: string;
  organizer_name?: string;
  partner_link?: string;
  created_at?: string;
  updated_at?: string;
};

type BackendUser = {
  id: number;
  email: string;
  name?: string;
  role?: UserRole;
  status?: string;
};

type ManagerRow = {
  name: string;
  total: number;
  inWork: number;
  participating: number;
  requests: number;
  won: number;
  rejected: number;
  viewed: number;
  amount: number;
  latest: string;
};

const workStatuses = new Set(["review", "in_work", "participating", "submitted", "waiting_result", "active"]);
const statusColors = ["#16a34a", "#2563eb", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b"];

const statusMeta: Record<string, { label: string; color: string }> = {
  assignment_requested: { label: "Запросы", color: "#f59e0b" },
  participating: { label: "Участвуем", color: "#16a34a" },
  review: { label: "На ревью", color: "#2563eb" },
  in_work: { label: "В работе", color: "#8b5cf6" },
  submitted: { label: "Подали", color: "#0ea5e9" },
  waiting_result: { label: "Ждем итог", color: "#14b8a6" },
  won: { label: "Выигран", color: "#059669" },
  lost: { label: "Проигран", color: "#64748b" },
  archived: { label: "Архив", color: "#94a3b8" },
  rejected: { label: "Отклонен", color: "#ef4444" },
  active: { label: "Открыт", color: "#14b8a6" },
};

function Cabinet() {
  const user = getCurrentUser();
  const [lots, setLots] = useState<SavedLot[]>([]);
  const [users, setUsers] = useState<BackendUser[]>([]);
  const [viewInfo, setViewInfo] = useState<Record<string, TenderViewInfo>>(() => getAllViewInfo());
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const base = getLocalApiBase();
      const [lotRows, userRows] = await Promise.all([
        fetch(`${base}/api/v1/lots/saved`).then((res) => res.json()).catch(() => []),
        fetch(`${base}/api/v1/users`).then((res) => res.json()).catch(() => []),
      ]);
      if (Array.isArray(lotRows)) setLots(lotRows);
      if (Array.isArray(userRows)) setUsers(userRows);
      setViewInfo(getAllViewInfo());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentName = user?.name || user?.email || "";
  const viewerNames = useMemo(
    () => [user?.name, user?.email].filter((value): value is string => Boolean(value)),
    [user?.name, user?.email],
  );
  const isDirector = user?.role === "director" || user?.role === "admin";
  const myLots = useMemo(
    () => lots.filter((lot) => viewerNames.some((name) => samePerson(lot.assigned_to, name) || samePerson(lot.reviewer, name))),
    [lots, viewerNames],
  );
  const myViewedCount = Object.values(viewInfo).filter((info) => viewerNames.some((name) => samePerson(info.viewer, name))).length;
  const pendingRequests = lots.filter((lot) => lot.status === "assignment_requested");

  const managerRows = useMemo(() => buildManagerRows(lots, users, viewInfo), [lots, users, viewInfo]);
  const allStatusData = useMemo(() => buildStatusData(lots), [lots]);
  const allTrendData = useMemo(() => buildTrendData(lots), [lots]);
  const myStatusData = useMemo(() => buildStatusData(myLots), [myLots]);
  const myTrendData = useMemo(() => buildTrendData(myLots), [myLots]);

  const updateLot = async (lot: SavedLot, patch: Partial<SavedLot>) => {
    setActionLoading(lot.id);
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/lots/participate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lot, ...patch }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json() as SavedLot;
      setLots((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      console.error(error);
      alert("Не удалось обновить запрос");
    } finally {
      setActionLoading(null);
    }
  };

  const approveRequest = (lot: SavedLot) => updateLot(lot, {
    status: "in_work",
    assigned_to: lot.reviewer || currentName,
    reviewer: currentName,
    comment: "Запрос одобрен, тендер назначен в работу",
  });

  const rejectRequest = (lot: SavedLot) => updateLot(lot, {
    status: "rejected",
    assigned_to: "",
    reviewer: currentName,
    comment: "Запрос на взятие тендера отклонен",
  });

  return (
    <>
      <PageHeader
        title={isDirector ? "Кабинет директора" : "Кабинет менеджера"}
        description={user ? `${user.name || user.email} · ${roleLabels[user.role]}` : "Личная статистика"}
      />
      <div className="space-y-5 p-8">
        {isDirector ? (
          <DirectorView
            rows={managerRows}
            statusData={allStatusData}
            trendData={allTrendData}
            requests={pendingRequests}
            loading={loading}
            actionLoading={actionLoading}
            onApprove={approveRequest}
            onReject={rejectRequest}
          />
        ) : (
          <ManagerView
            lots={myLots}
            viewedCount={myViewedCount}
            statusData={myStatusData}
            trendData={myTrendData}
            requests={pendingRequests.filter((lot) => viewerNames.some((name) => samePerson(lot.reviewer, name)))}
            loading={loading}
          />
        )}
      </div>
    </>
  );
}

function ManagerView({
  lots,
  viewedCount,
  statusData,
  trendData,
  requests,
  loading,
}: {
  lots: SavedLot[];
  viewedCount: number;
  statusData: Array<{ name: string; value: number; color: string }>;
  trendData: Array<{ label: string; count: number; amount: number }>;
  requests: SavedLot[];
  loading: boolean;
}) {
  const inWork = lots.filter((lot) => workStatuses.has(lot.status)).length;
  const won = lots.filter((lot) => lot.status === "won").length;
  const participating = lots.filter((lot) => lot.status === "participating").length;
  const amount = lots.reduce((sum, lot) => sum + (Number(lot.amount) || 0), 0);
  const expiring = lots.filter((lot) => {
    const raw = lot.end_date || lot.deadline;
    if (!raw) return false;
    const days = Math.ceil((new Date(raw).getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 5;
  }).length;

  const stats = [
    { label: "В работе", value: inWork, hint: "активные задачи", icon: BriefcaseBusiness, cls: "bg-primary/10 text-primary" },
    { label: "Участвуем", value: participating, hint: "поданные заявки", icon: CheckCircle2, cls: "bg-green-100 text-green-700" },
    { label: "Выигранные", value: won, hint: "закрытые победы", icon: Trophy, cls: "bg-emerald-100 text-emerald-700" },
    { label: "Просмотренные", value: viewedCount, hint: "личные просмотры", icon: Eye, cls: "bg-blue-100 text-blue-700" },
  ];

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => <StatTile key={stat.label} {...stat} loading={loading} />)}
      </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <ChartPanel title="Динамика моей работы" subtitle="Новые и обновленные тендеры за 14 дней">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="managerTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip formatter={(value) => [`${value}`, "Тендеры"]} />
              <Area type="monotone" dataKey="count" stroke="#2563eb" fill="url(#managerTrend)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Статусы" subtitle="Распределение моих тендеров">
          <StatusPie data={statusData} />
        </ChartPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold">Фокус</h3>
              <p className="mt-1 text-sm text-muted-foreground">Что стоит проверить первым</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <InsightLine label="Горящие дедлайны" value={`${expiring} тендеров`} tone={expiring > 0 ? "warning" : "good"} />
            <InsightLine label="Мои запросы на одобрении" value={`${requests.length} запросов`} tone={requests.length > 0 ? "info" : "good"} />
            <InsightLine label="Портфель в работе" value={`₸ ${formatTenderAmount(amount)}`} tone="neutral" />
          </div>
        </div>
        <LotsTable lots={lots} emptyText="За вами пока не закреплены заявки" />
      </section>
    </>
  );
}

function DirectorView({
  rows,
  statusData,
  trendData,
  requests,
  loading,
  actionLoading,
  onApprove,
  onReject,
}: {
  rows: ManagerRow[];
  statusData: Array<{ name: string; value: number; color: string }>;
  trendData: Array<{ label: string; count: number; amount: number }>;
  requests: SavedLot[];
  loading: boolean;
  actionLoading: number | null;
  onApprove: (lot: SavedLot) => void;
  onReject: (lot: SavedLot) => void;
}) {
  const totals = {
    managers: rows.length,
    inWork: rows.reduce((sum, row) => sum + row.inWork, 0),
    requests: requests.length,
    amount: rows.reduce((sum, row) => sum + row.amount, 0),
  };
  const workloadData = rows.slice(0, 8).map((row) => ({
    name: compactName(row.name),
    total: row.total,
    work: row.inWork,
    won: row.won,
  }));

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Менеджеры" value={totals.managers} hint="в команде" icon={Users} cls="bg-blue-100 text-blue-700" loading={loading} />
        <StatTile label="В работе" value={totals.inWork} hint="активные тендеры" icon={BriefcaseBusiness} cls="bg-primary/10 text-primary" loading={loading} />
        <StatTile label="Запросы" value={totals.requests} hint="ждут решения" icon={Send} cls="bg-amber-100 text-amber-800" loading={loading} />
        <StatTile label="Портфель" value={`₸ ${formatTenderAmount(totals.amount)}`} hint="по назначенным" icon={Trophy} cls="bg-emerald-100 text-emerald-700" loading={loading} />
      </div>

      <AssignmentRequests requests={requests} actionLoading={actionLoading} onApprove={onApprove} onReject={onReject} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <ChartPanel title="Нагрузка менеджеров" subtitle="Всего, в работе и выиграно">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={workloadData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip />
              <Bar dataKey="total" name="Всего" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="work" name="В работе" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="won" name="Выиграно" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Статусы команды" subtitle="Срез по всем заявкам">
          <StatusPie data={statusData} />
        </ChartPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ChartPanel title="Динамика команды" subtitle="Новые и обновленные заявки за 14 дней">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="directorTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip formatter={(value) => [`${value}`, "Заявки"]} />
              <Area type="monotone" dataKey="count" stroke="#16a34a" fill="url(#directorTrend)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ManagersTable rows={rows} loading={loading} />
      </section>
    </>
  );
}

function AssignmentRequests({
  requests,
  actionLoading,
  onApprove,
  onReject,
}: {
  requests: SavedLot[];
  actionLoading: number | null;
  onApprove: (lot: SavedLot) => void;
  onReject: (lot: SavedLot) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Запросы на взятие тендера</h3>
            <p className="text-xs text-muted-foreground">Специалисты отправляют запрос, директор или админ назначает тендер в работу</p>
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{requests.length} ждут</span>
      </div>
      {requests.length === 0 ? (
        <div className="px-6 py-10 text-sm text-muted-foreground">Нет запросов на одобрение.</div>
      ) : (
        <div className="divide-y divide-border">
          {requests.slice(0, 8).map((lot) => (
            <div key={lot.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">запросил: {lot.reviewer || "не указан"}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">₸ {formatTenderAmount(lot.amount || 0)}</span>
                </div>
                <Link to="/tenders/$tenderId" params={{ tenderId: String(lot.id) }} className="line-clamp-2 font-medium text-foreground hover:text-primary">
                  {lot.title || "Без названия"}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{lot.organizer_name || "Организатор не указан"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={actionLoading === lot.id}
                  onClick={() => onApprove(lot)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Одобрить
                </button>
                <button
                  type="button"
                  disabled={actionLoading === lot.id}
                  onClick={() => onReject(lot)}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ManagersTable({ rows, loading }: { rows: ManagerRow[]; loading: boolean }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Users className="h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">Активность менеджеров</h3>
          <p className="text-xs text-muted-foreground">Заявки, статусы и последняя активность</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Менеджер</th>
              <th className="px-6 py-3 text-right font-medium">Всего</th>
              <th className="px-6 py-3 text-right font-medium">В работе</th>
              <th className="px-6 py-3 text-right font-medium">Запросы</th>
              <th className="px-6 py-3 text-right font-medium">Выиграно</th>
              <th className="px-6 py-3 text-right font-medium">Просмотрено</th>
              <th className="px-6 py-3 text-left font-medium">Последнее</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center text-muted-foreground">
                  {loading ? "Загрузка…" : "Активность менеджеров пока не найдена"}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-border">
                <td className="px-6 py-4 font-medium">{row.name}</td>
                <td className="px-6 py-4 text-right tabular-nums">{row.total}</td>
                <td className="px-6 py-4 text-right tabular-nums">{row.inWork}</td>
                <td className="px-6 py-4 text-right tabular-nums">{row.requests}</td>
                <td className="px-6 py-4 text-right tabular-nums">{row.won}</td>
                <td className="px-6 py-4 text-right tabular-nums">{row.viewed}</td>
                <td className="px-6 py-4 text-muted-foreground">{row.latest ? new Date(row.latest).toLocaleDateString("ru-KZ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LotsTable({ lots, emptyText }: { lots: SavedLot[]; emptyText: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Clock className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Мои заявки</h3>
      </div>
      {lots.length === 0 ? (
        <div className="px-6 py-14 text-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="divide-y divide-border">
          {lots.slice(0, 12).map((lot) => (
            <Link key={lot.id} to="/tenders/$tenderId" params={{ tenderId: String(lot.id) }} className="grid gap-3 px-6 py-4 hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
              <div className="min-w-0">
                <p className="line-clamp-2 font-medium text-foreground">{lot.title || "Без названия"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{lot.organizer_name || "Организатор не указан"}</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{statusLabel(lot.status)}</span>
              <span className="text-sm font-semibold tabular-nums">₸ {formatTenderAmount(lot.amount || 0)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  cls,
  loading,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: ElementType;
  cls: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${cls}`}>
          <Icon className="h-5 w-5" />
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold">{loading ? "…" : value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function StatusPie({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  if (data.length === 0) {
    return <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">Нет данных для диаграммы</div>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
            {data.map((entry, index) => (
              <Cell key={`${entry.name}-${index}`} fill={entry.color || statusColors[index % statusColors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value, name) => [`${value}`, name]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />
              <span className="truncate text-muted-foreground">{entry.name}</span>
            </span>
            <span className="font-semibold">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightLine({ label, value, tone }: { label: string; value: string; tone: "good" | "warning" | "info" | "neutral" }) {
  const cls = {
    good: "bg-green-50 text-green-700 border-green-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    neutral: "bg-muted text-foreground border-border",
  }[tone];
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${cls}`}>
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function buildManagerRows(lots: SavedLot[], users: BackendUser[], viewInfo: Record<string, TenderViewInfo>): ManagerRow[] {
  const managers = users.filter((item) => item.role !== "admin" && item.status !== "blocked");
  const names = new Set([
    ...managers.map((item) => item.name || item.email).filter(Boolean),
    ...lots.map((lot) => lot.assigned_to || lot.reviewer || "").filter(Boolean),
  ]);
  return [...names].map((name) => {
    const assignedLots = lots.filter((lot) => samePerson(lot.assigned_to, name));
    const requestedLots = lots.filter((lot) => lot.status === "assignment_requested" && samePerson(lot.reviewer, name));
    const relatedLots = [...assignedLots, ...requestedLots.filter((lot) => !assignedLots.some((item) => item.id === lot.id))];
    const viewed = Object.values(viewInfo).filter((info) => samePerson(info.viewer, name)).length;
    const dates = relatedLots.map((lot) => lot.updated_at || lot.created_at || "").filter(Boolean).sort();
    return {
      name,
      total: relatedLots.length,
      inWork: assignedLots.filter((lot) => workStatuses.has(lot.status)).length,
      participating: assignedLots.filter((lot) => lot.status === "participating").length,
      requests: requestedLots.length,
      won: assignedLots.filter((lot) => lot.status === "won").length,
      rejected: assignedLots.filter((lot) => lot.status === "rejected").length,
      viewed,
      amount: assignedLots.reduce((sum, lot) => sum + (Number(lot.amount) || 0), 0),
      latest: dates.length > 0 ? dates[dates.length - 1] : "",
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function buildStatusData(lots: SavedLot[]): Array<{ name: string; value: number; color: string }> {
  const counts = new Map<string, number>();
  for (const lot of lots) {
    const key = lot.status || "active";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, value]) => ({
      name: statusMeta[status]?.label || status,
      value,
      color: statusMeta[status]?.color || "#64748b",
    }))
    .sort((a, b) => b.value - a.value);
}

function buildTrendData(lots: SavedLot[]): Array<{ label: string; count: number; amount: number }> {
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    return { key, label: date.toLocaleDateString("ru-KZ", { day: "2-digit", month: "2-digit" }), count: 0, amount: 0 };
  });
  const byKey = new Map(days.map((item) => [item.key, item]));
  for (const lot of lots) {
    const raw = lot.updated_at || lot.created_at;
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    const row = byKey.get(key);
    if (!row) continue;
    row.count += 1;
    row.amount += Number(lot.amount) || 0;
  }
  return days;
}

function samePerson(a?: string | null, b?: string | null): boolean {
  const left = (a || "").trim().toLowerCase();
  const right = (b || "").trim().toLowerCase();
  return Boolean(left && right && left === right);
}

function compactName(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return value.slice(0, 12);
  return `${parts[0]} ${parts[1]?.[0] || ""}.`;
}

function statusLabel(status: string): string {
  return statusMeta[status]?.label || status || "—";
}
