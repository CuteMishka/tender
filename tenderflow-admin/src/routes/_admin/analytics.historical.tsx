import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ToastContainer, useToast } from "@/components/admin/PageToast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import {
  TrendingUp, FileSpreadsheet, RefreshCw, Filter, ChevronLeft, ChevronRight,
  DollarSign, Hash, BarChart2, Percent, Pencil, X, Check,
} from "lucide-react";
import {
  analyticsApi, fmtM, fmtN, fmtDate,
  type HistoricalLot, type AnalyticsStats, type DynamicsPoint, type FilterOptions,
} from "@/lib/analytics-api";

export const Route = createFileRoute("/_admin/analytics/historical")({
  component: HistoricalAnalytics,
});

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

interface EditState {
  lot: HistoricalLot;
  winner_name: string;
  contract_amount: string;
  status: string;
}

function EditModal({ state, onSave, onClose, saving }: {
  state: EditState;
  onSave: (data: { winner_name: string; contract_amount: number; status: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [winnerName, setWinnerName] = useState(state.winner_name);
  const [contractAmount, setContractAmount] = useState(state.contract_amount);
  const [status, setStatus] = useState(state.status);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Внесение результатов</h3>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{state.lot.title}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Победитель</label>
            <input
              value={winnerName}
              onChange={(e) => setWinnerName(e.target.value)}
              placeholder="Название компании-победителя"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Сумма контракта ₸</label>
            <input
              type="number"
              value={contractAmount}
              onChange={(e) => setContractAmount(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Статус</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">— выбрать —</option>
              <option value="active">Активный</option>
              <option value="completed">Завершён</option>
              <option value="cancelled">Отменён</option>
            </select>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
            Отмена
          </button>
          <button
            onClick={() => onSave({ winner_name: winnerName, contract_amount: parseFloat(contractAmount) || 0, status })}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoricalAnalytics() {
  const toast = useToast();
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [dynamics, setDynamics] = useState<DynamicsPoint[]>([]);
  const [lots, setLots] = useState<HistoricalLot[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ purchase_types: [], regions: [] });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const [page, setPage] = useState(1);
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, l, fo] = await Promise.all([
        analyticsApi.getStats(),
        analyticsApi.getDynamics(),
        analyticsApi.getLots({
          customer: filterCustomer || undefined,
          purchase_type: filterType || undefined,
          region: filterRegion || undefined,
          date_from: filterDateFrom || undefined,
          date_to: filterDateTo || undefined,
          amount_min: filterAmountMin || undefined,
          amount_max: filterAmountMax || undefined,
          page,
          limit: 20,
        }),
        analyticsApi.getFilters(),
      ]);
      setStats(s);
      setDynamics(d ?? []);
      setLots(l.items ?? []);
      setTotal(l.meta.total);
      setPageCount(l.meta.pageCount || 1);
      setFilterOptions({ purchase_types: fo?.purchase_types ?? [], regions: fo?.regions ?? [] });
    } catch (e) {
      toast.error(`Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [page, filterCustomer, filterType, filterRegion, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await analyticsApi.sync();
      toast.success(`Синхронизация завершена: загружено ${r.fetched}, обновлено ${r.upserted}`);
      await loadAll();
    } catch (e) {
      toast.error(`Ошибка синхронизации: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const openEdit = (lot: HistoricalLot) => {
    setEditState({
      lot,
      winner_name: lot.winner_name || "",
      contract_amount: lot.contract_amount > 0 ? String(lot.contract_amount) : "",
      status: lot.status || "",
    });
  };

  const handleSave = async (data: { winner_name: string; contract_amount: number; status: string }) => {
    if (!editState) return;
    setSaving(true);
    try {
      await analyticsApi.updateLot(editState.lot.id, data);
      setLots((prev) => prev.map((l) =>
        l.id === editState.lot.id
          ? { ...l, winner_name: data.winner_name, contract_amount: data.contract_amount, status: data.status || l.status }
          : l
      ));
      toast.success("Результаты сохранены");
      setEditState(null);
    } catch (e) {
      toast.error(`Ошибка сохранения: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const applyFilters = () => { setPage(1); };
  const resetFilters = () => {
    setFilterCustomer(""); setFilterType(""); setFilterRegion("");
    setFilterDateFrom(""); setFilterDateTo(""); setFilterAmountMin(""); setFilterAmountMax("");
    setPage(1);
  };

  const chartData = dynamics.map((d) => ({
    name: d.period,
    count: d.count,
    budget: +(d.budget / 1_000_000).toFixed(1),
  }));

  return (
    <>
      <PageHeader
        title="История тендеров"
        description="Аналитика закупочной деятельности"
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition ${showFilters ? "bg-accent" : "bg-background hover:bg-accent"}`}
            >
              <Filter className="h-4 w-4" /> Фильтры
            </button>
            <button
              onClick={() => analyticsApi.exportCSV()}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Синхронизация…" : "Синхронизировать"}
            </button>
          </div>
        }
      />

      <div className="space-y-6 p-8">
        {/* Фильтры */}
        {showFilters && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm animate-in slide-in-from-top-2">
            <h4 className="mb-4 text-sm font-semibold">Параметры фильтрации</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}
                placeholder="Заказчик" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                <option value="">Все виды закупки</option>
                {filterOptions.purchase_types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                <option value="">Все регионы</option>
                {filterOptions.regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex gap-2">
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <input value={filterAmountMin} onChange={(e) => setFilterAmountMin(e.target.value)}
                placeholder="Сумма от" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <input value={filterAmountMax} onChange={(e) => setFilterAmountMax(e.target.value)}
                placeholder="Сумма до" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={applyFilters} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                Применить
              </button>
              <button onClick={resetFilters} className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
                Сбросить
              </button>
            </div>
          </div>
        )}

        {/* Карточки статистики */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Всего тендеров" value={stats ? String(stats.total_lots) : "—"}
            icon={Hash} accent="bg-primary/10 text-primary" />
          <StatCard label="Общий бюджет" value={stats ? `₸ ${fmtM(stats.total_budget)}` : "—"}
            sub={stats ? `Ср. сделка: ₸ ${fmtM(stats.avg_amount)}` : undefined}
            icon={DollarSign} accent="bg-green-100 text-green-600" />
          <StatCard label="Ср. скидка" value={stats ? `${stats.avg_discount.toFixed(1)}%` : "—"}
            sub={stats ? `Контрактов: ${stats.with_contract}` : undefined}
            icon={Percent} accent="bg-orange-100 text-orange-600" />
          <StatCard label="С победителем" value={stats ? String(stats.with_winner) : "—"}
            sub={stats ? `из ${stats.total_lots}` : undefined}
            icon={TrendingUp} accent="bg-violet-100 text-violet-600" />
        </div>

        {/* Графики */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h3 className="mb-1 text-sm font-semibold">Количество тендеров по месяцам</h3>
            <p className="mb-4 text-xs text-muted-foreground">Динамика за доступный период</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, "Тендеров"]} />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
            <h3 className="mb-1 text-sm font-semibold">Бюджет по месяцам (млн ₸)</h3>
            <p className="mb-4 text-xs text-muted-foreground">Суммарный объём закупок</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`${v} млн ₸`, "Бюджет"]} />
                <Line type="monotone" dataKey="budget" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Таблица */}
        <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h3 className="text-sm font-semibold">Исторические тендеры</h3>
              <p className="text-xs text-muted-foreground">Всего: {total} · Нажмите <Pencil className="inline h-3 w-3" /> чтобы внести победителя и сумму контракта</p>
            </div>
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
              Загрузка…
            </div>
          ) : lots.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Нет данных — нажмите «Синхронизировать» для загрузки тендеров из TenderPlus
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">ID</th>
                    <th className="px-4 py-3 text-left font-medium">Наименование</th>
                    <th className="px-4 py-3 text-left font-medium">Регион / Площадка</th>
                    <th className="px-4 py-3 text-right font-medium">Нач. цена ₸</th>
                    <th className="px-4 py-3 text-right font-medium">Контракт ₸</th>
                    <th className="px-4 py-3 text-left font-medium">Победитель</th>
                    <th className="px-4 py-3 text-left font-medium">Дедлайн</th>
                    <th className="px-4 py-3 text-left font-medium">Статус</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot) => (
                    <tr key={lot.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{lot.lot_id}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-xs truncate font-medium text-foreground">{lot.title}</div>
                        {lot.purchase_type && <div className="text-[11px] text-muted-foreground">{lot.purchase_type}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <div>{lot.region || "—"}</div>
                        {lot.organizer_name && <div className="text-[11px] opacity-70">{lot.organizer_name}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtN(lot.initial_amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {lot.contract_amount > 0
                          ? <span className="text-green-700 font-medium">{fmtN(lot.contract_amount)}</span>
                          : <span className="text-muted-foreground/40 text-xs italic">не указана</span>}
                      </td>
                      <td className="px-4 py-3 max-w-[140px]">
                        {lot.winner_name
                          ? <span className="truncate block text-xs font-medium text-foreground">{lot.winner_name}</span>
                          : <span className="text-muted-foreground/40 text-xs italic">не указан</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(lot.end_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          lot.status === "completed" ? "bg-gray-100 text-gray-600" :
                          lot.status === "active" ? "bg-green-100 text-green-700" :
                          lot.status === "cancelled" ? "bg-red-100 text-red-600" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {lot.status === "completed" ? "Завершён" :
                           lot.status === "active" ? "Активный" :
                           lot.status === "cancelled" ? "Отменён" :
                           lot.status || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEdit(lot)}
                          title="Внести результат"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Пагинация */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-border px-6 py-3 text-sm text-muted-foreground">
              <span>Стр. {page} из {pageCount} · всего: {total}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="rounded-md border border-border p-1.5 hover:bg-accent disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
                  const p = page <= 3 ? i + 1 : page - 2 + i;
                  if (p < 1 || p > pageCount) return null;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`min-w-[32px] rounded-md px-2 py-1 text-sm ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}
                  className="rounded-md border border-border p-1.5 hover:bg-accent disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editState && (
        <EditModal
          state={editState}
          onSave={handleSave}
          onClose={() => setEditState(null)}
          saving={saving}
        />
      )}

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismiss} />
    </>
  );
}
