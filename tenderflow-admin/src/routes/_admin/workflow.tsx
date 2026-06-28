import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import {
  Archive,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  fetchSavedLots,
  getLocalApiBase,
  saveSavedLot,
  savedLotStatusLabels,
  type SavedLot,
  type SavedLotStatus,
} from "@/lib/tenders-api";
import { getCurrentUser, type UserRole } from "@/lib/auth";
import { pushNotification } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin/workflow")({
  component: Workflow,
});

type BackendUser = {
  id: number;
  email: string;
  name?: string;
  role?: UserRole;
  status?: string;
};

type WorkflowColumn = {
  key: string;
  title: string;
  hint: string;
  statuses: string[];
  color: string;
  softClass: string;
  icon: ElementType;
};

const columns: WorkflowColumn[] = [
  {
    key: "active",
    title: "Новые",
    hint: "первичный просмотр",
    statuses: ["active"],
    color: "#64748b",
    softClass: "bg-slate-50 text-slate-700 border-slate-200",
    icon: FileText,
  },
  {
    key: "review",
    title: "На оценке",
    hint: "требования и риски",
    statuses: ["review"],
    color: "#2563eb",
    softClass: "bg-blue-50 text-blue-700 border-blue-200",
    icon: BarChart3,
  },
  {
    key: "assignment_requested",
    title: "Запросы",
    hint: "просит взять",
    statuses: ["assignment_requested"],
    color: "#f59e0b",
    softClass: "bg-amber-50 text-amber-800 border-amber-200",
    icon: Send,
  },
  {
    key: "in_work",
    title: "В работе",
    hint: "назначен ответственный",
    statuses: ["in_work"],
    color: "#8b5cf6",
    softClass: "bg-violet-50 text-violet-700 border-violet-200",
    icon: BriefcaseBusiness,
  },
  {
    key: "participating",
    title: "Готовим",
    hint: "пакет документов",
    statuses: ["participating"],
    color: "#16a34a",
    softClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
  {
    key: "submitted",
    title: "Подали",
    hint: "заявка отправлена",
    statuses: ["submitted"],
    color: "#0ea5e9",
    softClass: "bg-sky-50 text-sky-700 border-sky-200",
    icon: CheckCircle2,
  },
  {
    key: "waiting_result",
    title: "Ждем итог",
    hint: "следим за результатом",
    statuses: ["waiting_result"],
    color: "#14b8a6",
    softClass: "bg-teal-50 text-teal-700 border-teal-200",
    icon: Clock,
  },
  {
    key: "closed",
    title: "Итог",
    hint: "закрытые решения",
    statuses: ["won", "lost", "rejected", "archived"],
    color: "#475569",
    softClass: "bg-slate-100 text-slate-700 border-slate-200",
    icon: Archive,
  },
];

const nextStatus: Record<string, SavedLotStatus> = {
  active: "review",
  review: "in_work",
  assignment_requested: "in_work",
  in_work: "participating",
  participating: "submitted",
  submitted: "waiting_result",
  waiting_result: "won",
};

const statusButtonText: Record<string, string> = {
  active: "На оценку",
  review: "В работу",
  assignment_requested: "Одобрить",
  in_work: "Готовим",
  participating: "Подали",
  submitted: "Ждем итог",
  waiting_result: "Выиграли",
};

const money = new Intl.NumberFormat("ru-KZ");

function Workflow() {
  const navigate = useNavigate();
  const [lots, setLots] = useState<SavedLot[]>([]);
  const [users, setUsers] = useState<BackendUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const user = getCurrentUser();
  const currentName = user?.name || user?.email || "Пользователь";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSavedLots().catch(() => []),
      fetch(`${getLocalApiBase()}/api/v1/users`).then((res) => res.ok ? res.json() : []).catch(() => []),
    ])
      .then(([saved, backendUsers]) => {
        if (cancelled) return;
        setLots(Array.isArray(saved) ? saved : []);
        setUsers(Array.isArray(backendUsers) ? backendUsers : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const managers = users.filter((item) => item.status !== "blocked" && item.role !== "admin");

  const filteredLots = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lots.filter((lot) => {
      if (assignee !== "all" && (lot.assigned_to || "none") !== assignee) return false;
      if (urgentOnly && !isUrgent(lot)) return false;
      if (!q) return true;
      return [
        lot.id,
        lot.title,
        lot.organizer_name,
        lot.purchase_type,
        lot.status,
        lot.assigned_to,
        lot.reviewer,
      ].join(" ").toLowerCase().includes(q);
    });
  }, [assignee, lots, search, urgentOnly]);

  const stats = useMemo(() => buildStats(lots), [lots]);
  const stageRows = useMemo(() => columns.map((column) => ({
    ...column,
    count: filteredLots.filter((lot) => column.statuses.includes(lot.status || "active")).length,
  })), [filteredLots]);
  const urgentLots = filteredLots.filter(isUrgent).slice(0, 6);
  const maxStageCount = Math.max(1, ...stageRows.map((stage) => stage.count));
  const busiestStage = stageRows.reduce((best, stage) => stage.count > best.count ? stage : best, stageRows[0]);
  const filteredAmount = filteredLots.reduce((sum, lot) => sum + (lot.amount || 0), 0);

  const updateLot = async (lot: SavedLot, patch: Partial<SavedLot>, message: string) => {
    setUpdatingId(lot.id);
    try {
      const updated = await saveSavedLot({
        ...lot,
        ...patch,
        reviewer: currentName,
        comment: message,
      });
      setLots((items) => items.map((item) => item.id === updated.id ? updated : item));
      pushNotification("success", "Воронка обновлена", `Тендер «${shortTitle(updated.title)}» переведен: ${statusLabel(updated.status)}.`, "/workflow");
    } catch (err) {
      pushNotification("error", "Не удалось обновить", err instanceof Error ? err.message : "Ошибка сохранения статуса");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Воронка тендеров"
        description="Рабочая доска: от нового тендера до результата"
      />

      <div className="bg-muted/20">
        <div className="mx-auto max-w-[1800px] space-y-5 px-6 py-6 xl:px-8">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="В работе" value={String(stats.inWork)} hint="активных решений" icon={BriefcaseBusiness} tone="blue" progress={stats.inWorkPercent} />
            <Metric title="Запросы" value={String(stats.requests)} hint="ждут директора" icon={Send} tone="amber" progress={stats.requestPercent} />
            <Metric title="Срочные" value={String(stats.urgent)} hint="дедлайн до 3 дней" icon={Clock} tone="red" progress={stats.urgentPercent} />
            <Metric title="Сумма" value={`₸ ${formatAmountShort(stats.amount)}`} hint="по открытым лотам" icon={BarChart3} tone="green" progress={stats.amount > 0 ? 72 : 0} />
          </div>

          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SlidersHorizontal className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Фильтры и фокус</p>
                  <p className="text-xs text-muted-foreground">
                    Показано {filteredLots.length} из {lots.length}; сумма в выборке ₸ {formatAmountShort(filteredAmount)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center 2xl:justify-end">
                <div className="relative min-w-[260px] sm:min-w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Поиск по тендеру, компании, статусу"
                    className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <select
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  className="h-10 min-w-[220px] rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                >
                  <option value="all">Все ответственные</option>
                  <option value="none">Не назначен</option>
                  {managers.map((manager) => {
                    const label = manager.name || manager.email;
                    return <option key={manager.id} value={label}>{label}</option>;
                  })}
                </select>
                <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm transition hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={urgentOnly}
                    onChange={(event) => setUrgentOnly(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Срочные
                </label>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Статусы по воронке</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Компактный срез без лишней пустоты: где сейчас лежат сохраненные тендеры</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Фокус: </span>
                  <span className="font-semibold">{busiestStage.title}</span>
                  <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-xs font-semibold">{busiestStage.count}</span>
                </div>
              </div>

              <div className="mb-5 grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
                {stageRows.map((stage) => {
                  const Icon = stage.icon;
                  return (
                    <div key={stage.key} className={`rounded-lg border px-3 py-3 ${stage.softClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="text-lg font-bold">{stage.count}</span>
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold">{stage.title}</p>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3">
                {stageRows.map((stage) => {
                  const percent = Math.round((stage.count / maxStageCount) * 100);
                  return (
                    <div key={stage.key} className="grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)_42px] sm:items-center">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        <span className="truncate text-sm font-medium">{stage.title}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${percent}%`, backgroundColor: stage.color }}
                        />
                      </div>
                      <span className="text-right text-sm font-semibold">{stage.count}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Срочные дедлайны</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Что нельзя потерять сегодня</p>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <Clock className="h-5 w-5" />
                </span>
              </div>
              <div className="space-y-2">
                {urgentLots.length === 0 ? (
                  <div className="flex min-h-[170px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                    <ShieldCheck className="mb-3 h-8 w-8 text-emerald-600" />
                    <p className="text-sm font-semibold">Срочных тендеров нет</p>
                    <p className="mt-1 text-xs text-muted-foreground">Дедлайны под контролем</p>
                  </div>
                ) : urgentLots.map((lot) => (
                  <button
                    key={lot.id}
                    onClick={() => navigate({ to: "/tenders/$tenderId", params: { tenderId: String(lot.id) } })}
                    className="w-full rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-semibold">{lot.title}</p>
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                        {deadlineLabel(lot)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{lot.organizer_name || "Компания не указана"}</p>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Рабочая доска</h2>
                <p className="mt-1 text-sm text-muted-foreground">Колонки шире, карточки читаются без сжатия</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border bg-card px-3 py-1">Всего в выборке: {filteredLots.length}</span>
                {urgentOnly && <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">Только срочные</span>}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-card p-3 shadow-sm">
              {loading ? (
                <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">Загрузка воронки...</div>
              ) : (
                <div className="flex min-w-max gap-3">
                  {columns.map((column) => {
                    const items = filteredLots.filter((lot) => column.statuses.includes(lot.status || "active"));
                    const Icon = column.icon;
                    return (
                      <div key={column.key} className="flex w-[286px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/20">
                        <div className="border-b border-border bg-card p-3">
                          <div className="mb-3 h-1 rounded-full" style={{ backgroundColor: column.color }} />
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2">
                              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${column.softClass}`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold">{column.title}</h3>
                                <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{column.hint}</p>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-semibold">{items.length}</span>
                          </div>
                        </div>
                        <div className="max-h-[720px] flex-1 space-y-3 overflow-y-auto p-3">
                          {items.length === 0 ? (
                            <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border bg-background/70 px-3 text-center text-xs text-muted-foreground">
                              Нет тендеров
                            </div>
                          ) : items.map((lot) => (
                            <TenderCard
                              key={lot.id}
                              lot={lot}
                              users={managers}
                              updating={updatingId === lot.id}
                              onOpen={() => navigate({ to: "/tenders/$tenderId", params: { tenderId: String(lot.id) } })}
                              onUpdate={(patch, message) => updateLot(lot, patch, message)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

type MetricTone = "blue" | "amber" | "red" | "green";

const metricTone: Record<MetricTone, { shell: string; icon: string; bar: string }> = {
  blue: { shell: "border-blue-100 bg-blue-50/70", icon: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  amber: { shell: "border-amber-100 bg-amber-50/80", icon: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  red: { shell: "border-red-100 bg-red-50/80", icon: "bg-red-100 text-red-700", bar: "bg-red-500" },
  green: { shell: "border-emerald-100 bg-emerald-50/80", icon: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
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

function TenderCard({
  lot,
  users,
  updating,
  onOpen,
  onUpdate,
}: {
  lot: SavedLot;
  users: BackendUser[];
  updating: boolean;
  onOpen: () => void;
  onUpdate: (patch: Partial<SavedLot>, message: string) => void;
}) {
  const currentStatus = lot.status || "active";
  const next = nextStatus[currentStatus];
  const canClose = !["won", "lost", "rejected", "archived"].includes(currentStatus);
  const currentUser = getCurrentUser();
  const currentName = currentUser?.name || currentUser?.email || "Пользователь";

  return (
    <article className="rounded-lg border border-border bg-background p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <button onClick={onOpen} className="min-w-0 text-left">
          <p className="line-clamp-3 text-sm font-semibold leading-5 hover:text-primary">{lot.title}</p>
        </button>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${deadlineClass(lot)}`}>
          {deadlineLabel(lot)}
        </span>
      </div>

      <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{lot.organizer_name || "Компания не указана"}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/50 px-2 py-2">
          <p className="text-[10px] uppercase text-muted-foreground">Сумма</p>
          <p className="truncate text-xs font-semibold">₸ {money.format(Math.round(lot.amount || 0))}</p>
        </div>
        <div className="rounded-lg bg-muted/50 px-2 py-2">
          <p className="text-[10px] uppercase text-muted-foreground">Дедлайн</p>
          <p className="truncate text-xs font-semibold">{deadlineDateLabel(lot)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{statusLabel(currentStatus)}</span>
        {lot.priority && lot.priority !== "normal" && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{priorityLabel(lot.priority)}</span>
        )}
      </div>

      <div className="mt-3">
        <select
          value={lot.assigned_to || ""}
          onChange={(event) => onUpdate({ assigned_to: event.target.value, status: currentStatus }, "Назначен ответственный")}
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          disabled={updating}
        >
          <option value="">Ответственный не назначен</option>
          {users.map((user) => {
            const label = user.name || user.email;
            return <option key={user.id} value={label}>{label}</option>;
          })}
        </select>
      </div>

      {lot.next_step && (
        <p className="mt-2 line-clamp-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">{lot.next_step}</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onOpen}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-border px-2 text-xs font-medium transition hover:bg-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Открыть
        </button>
        <button
          onClick={() => onUpdate({ assigned_to: currentName, status: currentStatus }, "Специалист взял тендер на себя")}
          disabled={updating}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-border px-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          На себя
        </button>
        {next && (
          <button
            onClick={() => onUpdate({ status: next, assigned_to: lot.assigned_to || currentName }, `Перевод в статус: ${statusLabel(next)}`)}
            disabled={updating}
            className="col-span-2 inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-primary px-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {statusButtonText[currentStatus] || statusLabel(next)}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
        {canClose && (
          <>
            <button
              onClick={() => onUpdate({ status: "lost" }, "Тендер закрыт как проигранный")}
              disabled={updating}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Проиграли
            </button>
            <button
              onClick={() => onUpdate({ status: "won" }, "Тендер отмечен как выигранный")}
              disabled={updating}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              <Trophy className="h-3.5 w-3.5" />
              Выиграли
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function buildStats(lots: SavedLot[]) {
  const activeStatuses = new Set(["active", "review", "assignment_requested", "in_work", "participating", "submitted", "waiting_result"]);
  const activeLots = lots.filter((lot) => activeStatuses.has(lot.status || "active"));
  const total = Math.max(1, lots.length);
  const urgent = lots.filter(isUrgent).length;
  const requests = lots.filter((lot) => lot.status === "assignment_requested").length;
  const inWork = activeLots.length;
  return {
    inWork,
    requests,
    urgent,
    amount: activeLots.reduce((sum, lot) => sum + (lot.amount || 0), 0),
    inWorkPercent: Math.round((inWork / total) * 100),
    requestPercent: Math.round((requests / total) * 100),
    urgentPercent: Math.round((urgent / total) * 100),
  };
}

function statusLabel(status?: string): string {
  return savedLotStatusLabels[status || "active"] || status || "Новый";
}

function shortTitle(title: string): string {
  return title.length > 44 ? `${title.slice(0, 44)}...` : title;
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case "urgent":
      return "Срочно";
    case "high":
      return "Высокий";
    case "low":
      return "Низкий";
    default:
      return "Обычный";
  }
}

function lotDeadline(lot: SavedLot): Date | null {
  const raw = lot.end_date || lot.deadline;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysLeft(lot: SavedLot): number | null {
  const deadline = lotDeadline(lot);
  if (!deadline) return null;
  return Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
}

function isUrgent(lot: SavedLot): boolean {
  const days = daysLeft(lot);
  return days !== null && days >= 0 && days <= 3 && !["won", "lost", "rejected", "archived"].includes(lot.status);
}

function deadlineLabel(lot: SavedLot): string {
  const days = daysLeft(lot);
  if (days === null) return "нет даты";
  if (days < 0) return "истек";
  if (days === 0) return "сегодня";
  return `${days} дн.`;
}

function deadlineDateLabel(lot: SavedLot): string {
  const date = lotDeadline(lot);
  if (!date) return "Нет даты";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function deadlineClass(lot: SavedLot): string {
  const days = daysLeft(lot);
  if (days === null) return "bg-muted text-muted-foreground";
  if (days < 0) return "bg-slate-100 text-slate-600";
  if (days <= 1) return "bg-red-100 text-red-700";
  if (days <= 3) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-700";
}

function formatAmountShort(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} млрд`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} тыс`;
  return money.format(Math.round(value));
}
