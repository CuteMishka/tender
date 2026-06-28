import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  Archive,
  Banknote,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Trophy,
  UserCheck,
  XCircle,
} from "lucide-react";
import { getCurrentUser, type UserRole } from "@/lib/auth";
import { getLocalApiBase } from "@/lib/tenders-api";

export const Route = createFileRoute("/_admin/bids")({
  component: Bids,
});

interface SavedLot {
  id: number;
  title: string;
  amount: number;
  status: string;
  purchase_type: string;
  organizer_name: string;
  partner_link: string;
  comment?: string;
  assigned_to?: string;
  reviewer?: string;
  action_history?: string;
  created_at: string;
}

type BackendUser = {
  id: number;
  email: string;
  name?: string;
  role?: UserRole;
  status?: string;
};

type TabKey =
  | "all"
  | "assignment_requested"
  | "participating"
  | "review"
  | "in_work"
  | "submitted"
  | "waiting_result"
  | "won"
  | "lost"
  | "rejected"
  | "active";

type StatusMeta = {
  label: string;
  icon: ElementType;
  cls: string;
  dot: string;
};

const statusMap: Record<string, StatusMeta> = {
  assignment_requested: {
    label: "Запрос",
    icon: Send,
    cls: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  participating: {
    label: "Участвуем",
    icon: CheckCircle2,
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  review: {
    label: "На ревью",
    icon: FileText,
    cls: "border-blue-200 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
  in_work: {
    label: "В работе",
    icon: BriefcaseBusiness,
    cls: "border-violet-200 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
  submitted: {
    label: "Подали",
    icon: CheckCircle2,
    cls: "border-sky-200 bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
  },
  waiting_result: {
    label: "Ждем итог",
    icon: Clock,
    cls: "border-teal-200 bg-teal-50 text-teal-700",
    dot: "bg-teal-500",
  },
  won: {
    label: "Выигран",
    icon: Trophy,
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  lost: {
    label: "Проигран",
    icon: XCircle,
    cls: "border-slate-200 bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
  },
  archived: {
    label: "Архив",
    icon: Archive,
    cls: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  active: {
    label: "Открыт",
    icon: Clock,
    cls: "border-green-200 bg-green-50 text-green-700",
    dot: "bg-green-500",
  },
  rejected: {
    label: "Не подходит",
    icon: XCircle,
    cls: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "Все" },
  { key: "assignment_requested", label: "Запросы" },
  { key: "participating", label: "Участвуем" },
  { key: "review", label: "На ревью" },
  { key: "in_work", label: "В работе" },
  { key: "submitted", label: "Подали" },
  { key: "waiting_result", label: "Ждем итог" },
  { key: "won", label: "Выиграли" },
  { key: "lost", label: "Проиграли" },
  { key: "rejected", label: "Не подходит" },
];

const money = new Intl.NumberFormat("ru-KZ");
const activeStatuses = new Set(["active", "review", "assignment_requested", "in_work", "participating", "submitted", "waiting_result"]);

function Bids() {
  const navigate = useNavigate();
  const [bids, setBids] = useState<SavedLot[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchText, setSearchText] = useState("");
  const [managerOptions, setManagerOptions] = useState<BackendUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = getLocalApiBase();
    Promise.all([
      fetch(`${base}/api/v1/lots/saved`).then((res) => res.json()).catch(() => []),
      fetch(`${base}/api/v1/users`).then((res) => res.json()).catch(() => []),
    ])
      .then(([lots, users]) => {
        if (Array.isArray(lots)) setBids(lots);
        if (Array.isArray(users)) {
          setManagerOptions(users.filter((user: BackendUser) => user.status !== "blocked" && user.role !== "admin"));
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Вы уверены, что хотите удалить этот тендер из заявок?")) return;
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/lots/saved/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Ошибка при удалении");
      setBids((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error(err);
      alert("Не удалось удалить заявку");
    }
  };

  const updateStatus = async (lot: SavedLot, status: SavedLot["status"]) => {
    const comment = window.prompt(status === "in_work" ? "Комментарий при принятии в работу" : "Комментарий", lot.comment || "") ?? lot.comment ?? "";
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/lots/participate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...lot,
          status,
          comment,
          assigned_to: getCurrentUser()?.name || getCurrentUser()?.email || lot.assigned_to || "",
        }),
      });
      if (!res.ok) throw new Error("Ошибка обновления статуса");
      const updated = await res.json() as SavedLot;
      setBids((prev) => prev.map((b) => b.id === updated.id ? updated : b));
    } catch (err) {
      console.error(err);
      alert("Не удалось обновить статус");
    }
  };

  const updateManager = async (lot: SavedLot, assignedTo: string) => {
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/lots/participate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...lot,
          status: lot.status || "review",
          assigned_to: assignedTo,
          reviewer: getCurrentUser()?.name || getCurrentUser()?.email || lot.reviewer || "",
        }),
      });
      if (!res.ok) throw new Error("Ошибка обновления менеджера");
      const updated = await res.json() as SavedLot;
      setBids((prev) => prev.map((b) => b.id === updated.id ? updated : b));
    } catch (err) {
      console.error(err);
      alert("Не удалось назначить менеджера");
    }
  };

  const filteredBids = useMemo(() => bids.filter((b) => {
    if (activeTab !== "all" && b.status !== activeTab) return false;
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${b.id} ${b.title} ${b.organizer_name} ${b.purchase_type} ${b.status} ${b.assigned_to || ""}`.toLowerCase().includes(q);
  }), [activeTab, bids, searchText]);

  const tabCounts = useMemo(() => ({
    all: bids.length,
    assignment_requested: bids.filter((b) => b.status === "assignment_requested").length,
    participating: bids.filter((b) => b.status === "participating").length,
    review: bids.filter((b) => b.status === "review").length,
    in_work: bids.filter((b) => b.status === "in_work").length,
    submitted: bids.filter((b) => b.status === "submitted").length,
    waiting_result: bids.filter((b) => b.status === "waiting_result").length,
    won: bids.filter((b) => b.status === "won").length,
    lost: bids.filter((b) => b.status === "lost").length,
    active: bids.filter((b) => b.status === "active").length,
    rejected: bids.filter((b) => b.status === "rejected").length,
  }), [bids]);

  const stats = useMemo(() => buildStats(bids), [bids]);
  const selectedLabel = activeTab === "all" ? "Все заявки" : statusMap[activeTab]?.label || activeTab;

  return (
    <>
      <PageHeader title="Заявки" description="Рабочий процесс: ревью, участие, работа и результат" />

      <div className="bg-muted/20">
        <div className="mx-auto max-w-[1800px] space-y-5 px-6 py-6 xl:px-8">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="Всего заявок" value={String(bids.length)} hint={`${filteredBids.length} в текущей выборке`} icon={FileText} tone="blue" progress={bids.length ? 100 : 0} />
            <Metric title="Активные" value={String(stats.active)} hint="в рабочем процессе" icon={BriefcaseBusiness} tone="green" progress={stats.activePercent} />
            <Metric title="Без менеджера" value={String(stats.unassigned)} hint="ожидают назначения" icon={UserCheck} tone="amber" progress={stats.unassignedPercent} />
            <Metric title="Сумма активных" value={`₸ ${formatAmountShort(stats.activeAmount)}`} hint="по незакрытым заявкам" icon={Banknote} tone="teal" progress={stats.activeAmount > 0 ? 72 : 0} />
          </div>

          <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SlidersHorizontal className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Фильтр заявок</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedLabel}: {filteredBids.length} из {bids.length}; сумма в выборке ₸ {formatAmountShort(sumAmount(filteredBids))}
                  </p>
                </div>
              </div>
              <div className="relative w-full min-w-[260px] 2xl:w-[520px]">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Поиск по названию, организатору, виду закупки"
                  className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>
            </div>
          </section>

          <div className="flex flex-wrap gap-2 pb-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-foreground hover:bg-accent"
                  }`}
                >
                  {tab.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>
                    {tabCounts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>

          <section
            className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Заявка</th>
                    <th className="px-5 py-3 text-left font-semibold">Тендер</th>
                    <th className="px-5 py-3 text-left font-semibold">Организатор</th>
                    <th className="px-5 py-3 text-right font-semibold">Сумма</th>
                    <th className="px-5 py-3 text-left font-semibold">Дата</th>
                    <th className="px-5 py-3 text-left font-semibold">Менеджер</th>
                    <th className="px-5 py-3 text-left font-semibold">Статус</th>
                    <th className="px-5 py-3 text-right font-semibold">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center text-sm text-muted-foreground">
                        Загрузка заявок...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredBids.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <FileText className="h-10 w-10 opacity-25" />
                          <p className="text-sm font-semibold">
                            {searchText.trim()
                              ? "По этому запросу заявок не найдено"
                              : activeTab === "all" ? "Заявок пока нет" : `Нет заявок со статусом «${statusMap[activeTab]?.label || activeTab}»`}
                          </p>
                          {activeTab === "all" && !searchText.trim() && (
                            <p className="text-xs">Сохраненные тендеры появятся здесь после решения участвовать</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading && filteredBids.map((bid) => (
                    <BidRow
                      key={bid.id}
                      bid={bid}
                      users={managerOptions}
                      onOpen={() => navigate({ to: "/tenders/$tenderId", params: { tenderId: String(bid.id) } })}
                      onDelete={() => handleDelete(bid.id)}
                      onManagerChange={(assignedTo) => updateManager(bid, assignedTo)}
                      onTakeToWork={() => updateStatus(bid, "in_work")}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function BidRow({
  bid,
  users,
  onOpen,
  onDelete,
  onManagerChange,
  onTakeToWork,
}: {
  bid: SavedLot;
  users: BackendUser[];
  onOpen: () => void;
  onDelete: () => void;
  onManagerChange: (assignedTo: string) => void;
  onTakeToWork: () => void;
}) {
  const status = statusMap[bid.status] || statusMap.active;
  const Icon = status.icon;
  const dateStr = formatDate(bid.created_at);
  const amountStr = money.format(Math.round(bid.amount || 0));

  return (
    <tr
      className="group cursor-pointer bg-card transition hover:bg-muted/30"
      onClick={onOpen}
    >
      <td className="px-5 py-4 align-top">
        <div className="flex items-start gap-3">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">B-{bid.id}</p>
            <p className="mt-1 font-mono text-xs font-semibold text-primary">T-{bid.id}</p>
          </div>
        </div>
      </td>
      <td className="max-w-[360px] px-5 py-4 align-top">
        <button onClick={(event) => { event.stopPropagation(); onOpen(); }} className="text-left">
          <p className="line-clamp-3 text-sm font-semibold leading-5 text-foreground group-hover:text-primary">{bid.title}</p>
          {bid.purchase_type && (
            <p className="mt-2 inline-flex max-w-full rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <span className="truncate">{bid.purchase_type}</span>
            </p>
          )}
        </button>
      </td>
      <td className="max-w-[330px] px-5 py-4 align-top">
        <p className="line-clamp-3 text-sm font-medium leading-5 text-foreground">{bid.organizer_name || "Компания не указана"}</p>
      </td>
      <td className="px-5 py-4 text-right align-top">
        <p className="font-semibold tabular-nums">₸ {amountStr}</p>
      </td>
      <td className="px-5 py-4 align-top">
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{dateStr}</span>
      </td>
      <td className="px-5 py-4 align-top" onClick={(event) => event.stopPropagation()}>
        <select
          value={bid.assigned_to || ""}
          onChange={(event) => onManagerChange(event.target.value)}
          className="h-9 min-w-[190px] rounded-lg border border-input bg-background px-2 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          title="Ответственный менеджер"
        >
          <option value="">Не назначен</option>
          {users.map((manager) => {
            const label = manager.name || manager.email;
            return <option key={manager.id} value={label}>{label}</option>;
          })}
        </select>
      </td>
      <td className="px-5 py-4 align-top">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${status.cls}`}>
          <Icon className="h-3.5 w-3.5" />
          {status.label}
        </span>
      </td>
      <td className="px-5 py-4 text-right align-top" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-end gap-2">
          <button
            onClick={onOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Открыть тендер"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          {bid.status === "participating" && (
            <button
              onClick={onTakeToWork}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 transition hover:bg-violet-100"
              title="Принять в работу"
            >
              <BriefcaseBusiness className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            title="Удалить заявку"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

type MetricTone = "blue" | "green" | "amber" | "teal";

const metricTone: Record<MetricTone, { shell: string; icon: string; bar: string }> = {
  blue: { shell: "border-blue-100 bg-blue-50/70", icon: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  green: { shell: "border-emerald-100 bg-emerald-50/80", icon: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  amber: { shell: "border-amber-100 bg-amber-50/80", icon: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  teal: { shell: "border-teal-100 bg-teal-50/80", icon: "bg-teal-100 text-teal-700", bar: "bg-teal-500" },
};

function Metric({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  progress,
}: {
  title: string;
  value: string;
  hint: string;
  icon: ElementType;
  tone: MetricTone;
  progress: number;
}) {
  const cls = metricTone[tone];
  return (
    <div className={`overflow-hidden rounded-lg border p-4 shadow-sm ${cls.shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 truncate text-2xl font-bold text-foreground">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${cls.icon}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background/80">
        <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
      </div>
    </div>
  );
}

function buildStats(bids: SavedLot[]) {
  const total = Math.max(1, bids.length);
  const active = bids.filter((bid) => activeStatuses.has(bid.status || "active")).length;
  const unassigned = bids.filter((bid) => !bid.assigned_to).length;
  const activeAmount = sumAmount(bids.filter((bid) => activeStatuses.has(bid.status || "active")));

  return {
    active,
    unassigned,
    activeAmount,
    activePercent: Math.round((active / total) * 100),
    unassignedPercent: Math.round((unassigned / total) * 100),
  };
}

function sumAmount(items: SavedLot[]): number {
  return items.reduce((sum, item) => sum + (item.amount || 0), 0);
}

function formatAmountShort(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} млрд`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} тыс`;
  return money.format(Math.round(value));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "Нет даты";
  return date.toLocaleDateString("ru-KZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}
