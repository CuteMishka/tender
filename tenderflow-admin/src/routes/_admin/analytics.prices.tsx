import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AlertTriangle, TrendingDown, AlertCircle, Search } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { analyticsApi, fmtM, fmtN, fmtPct, type PriceStats, type PriceRow } from "@/lib/analytics-api";

export const Route = createFileRoute("/_admin/analytics/prices")({
  component: PriceAnalytics,
});

function PriceAnalytics() {
  const [priceStats, setPriceStats] = useState<PriceStats | null>(null);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "anomalies">("all");
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    analyticsApi.getPrices()
      .then((d) => { setPriceStats(d.stats); setRows(d.rows ?? []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const searchedRows = rows.filter((r) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${r.lot_id} ${r.title} ${r.customer_name} ${r.purchase_type} ${r.winner_name} ${r.initial_amount} ${r.contract_amount} ${r.discount_pct}`.toLowerCase().includes(q);
  });
  const anomalies = searchedRows.filter((r) => r.discount_pct >= 40);
  const displayRows = tab === "anomalies" ? anomalies : searchedRows;

  // Гистограмма распределения скидок
  const discountBuckets: Record<string, number> = {
    "0–5%": 0, "5–10%": 0, "10–20%": 0, "20–30%": 0, "30–40%": 0, ">40%": 0,
  };
  for (const r of rows) {
    const d = r.discount_pct;
    if (d < 5) discountBuckets["0–5%"]++;
    else if (d < 10) discountBuckets["5–10%"]++;
    else if (d < 20) discountBuckets["10–20%"]++;
    else if (d < 30) discountBuckets["20–30%"]++;
    else if (d < 40) discountBuckets["30–40%"]++;
    else discountBuckets[">40%"]++;
  }
  const histData = Object.entries(discountBuckets).map(([name, count]) => ({ name, count }));

  // Scatter: нач. цена vs контракт
  const scatterData = rows.slice(0, 200).map((r) => ({
    x: +(r.initial_amount / 1_000_000).toFixed(2),
    y: +(r.contract_amount / 1_000_000).toFixed(2),
    z: r.discount_pct,
  }));

  return (
    <>
      <PageHeader
        title="Анализ цен"
        description="Сравнение начальных и итоговых цен контрактов, выявление демпинга"
      />

      <div className="space-y-6 p-8">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" /> Загрузка…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-24 text-muted-foreground">
            <AlertCircle className="mb-3 h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">Нет данных о ценах контрактов</p>
            <p className="mt-1 text-xs">Данные появятся после того как будут внесены суммы контрактов в историю тендеров</p>
            <Link
              to="/analytics/historical"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Перейти в историю тендеров
            </Link>
          </div>
        ) : (
          <>
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Поиск по названию, заказчику, виду закупки, победителю..."
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
              />
            </div>

            {/* Карточки */}
            {priceStats && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <TrendingDown className="h-4 w-4 text-green-600" /> Средняя скидка
                  </div>
                  <p className="text-2xl font-bold text-green-600">{fmtPct(priceStats.avg_discount_pct)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">от начальной цены</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <div className="mb-2 text-xs text-muted-foreground">Макс. скидка</div>
                  <p className="text-2xl font-bold">{fmtPct(priceStats.max_discount_pct)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">мин: {fmtPct(priceStats.min_discount_pct)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-red-500" /> Аномалии (&gt;40%)
                  </div>
                  <p className="text-2xl font-bold text-red-600">{priceStats.anomaly_count}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">из {searchedRows.length} контрактов</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <div className="mb-2 text-xs text-muted-foreground">Суммарная экономия</div>
                  <p className="text-2xl font-bold text-primary">₸ {fmtM(priceStats.total_savings)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ср. нач.: {fmtM(priceStats.avg_initial)} → Ср. контракт: {fmtM(priceStats.avg_contract)}
                  </p>
                </div>
              </div>
            )}

            {/* Графики */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
                <h3 className="mb-1 text-sm font-semibold">Распределение скидок</h3>
                <p className="mb-4 text-xs text-muted-foreground">Количество контрактов по диапазонам снижения цены</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={histData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [v, "Контрактов"]} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
                <h3 className="mb-1 text-sm font-semibold">Нач. цена vs Контракт (млн ₸)</h3>
                <p className="mb-4 text-xs text-muted-foreground">Каждая точка — один контракт; цвет — величина скидки</p>
                <ResponsiveContainer width="100%" height={200}>
                  <ScatterChart margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="x" name="Нач. цена" tick={{ fontSize: 11 }} unit=" млн" />
                    <YAxis dataKey="y" name="Контракт" tick={{ fontSize: 11 }} unit=" млн" />
                    <ZAxis dataKey="z" range={[40, 200]} name="Скидка %" />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }}
                      formatter={(v: number, name: string) =>
                        name === "Нач. цена" || name === "Контракт"
                          ? [`${v} млн ₸`, name]
                          : [`${v}%`, "Скидка"]} />
                    <Scatter data={scatterData} fill="var(--primary)" opacity={0.6} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Таблица */}
            <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <h3 className="text-sm font-semibold">Детализация по контрактам</h3>
                  <p className="text-xs text-muted-foreground">Отсортировано по убыванию скидки</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setTab("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === "all" ? "bg-primary text-primary-foreground" : "border border-border bg-background hover:bg-accent"}`}>
                    Все ({searchedRows.length})
                  </button>
                  <button onClick={() => setTab("anomalies")}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === "anomalies" ? "bg-red-600 text-white" : "border border-border bg-background hover:bg-accent"}`}>
                    <AlertTriangle className="h-3 w-3" /> Аномалии ({anomalies.length})
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">ID</th>
                      <th className="px-4 py-3 text-left font-medium">Наименование</th>
                      <th className="px-4 py-3 text-left font-medium">Заказчик</th>
                      <th className="px-4 py-3 text-left font-medium">Вид закупки</th>
                      <th className="px-4 py-3 text-right font-medium">Нач. цена ₸</th>
                      <th className="px-4 py-3 text-right font-medium">Контракт ₸</th>
                      <th className="px-4 py-3 text-right font-medium">Скидка ₸</th>
                      <th className="px-4 py-3 text-right font-medium">Скидка %</th>
                      <th className="px-4 py-3 text-left font-medium">Победитель</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const isAnomaly = row.discount_pct >= 40;
                      return (
                        <tr key={row.lot_id} className={`border-t border-border hover:bg-muted/30 ${isAnomaly ? "bg-red-50/50" : ""}`}>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.lot_id}</td>
                          <td className="px-4 py-3 max-w-[220px] truncate font-medium text-foreground">{row.title}</td>
                          <td className="px-4 py-3 max-w-[150px] truncate text-xs text-muted-foreground">{row.customer_name || "—"}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{row.purchase_type || "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtN(row.initial_amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtN(row.contract_amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-green-700">{fmtM(row.discount_abs)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isAnomaly ? "bg-red-100 text-red-700" :
                              row.discount_pct >= 20 ? "bg-orange-100 text-orange-700" :
                              "bg-green-100 text-green-700"
                            }`}>
                              {isAnomaly && "⚠ "}{fmtPct(row.discount_pct)}
                            </span>
                          </td>
                          <td className="px-4 py-3 max-w-[140px] truncate text-xs text-muted-foreground">{row.winner_name || "—"}</td>
                        </tr>
                      );
                    })}
                    {displayRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-sm text-muted-foreground">
                          {searchText.trim()
                            ? "По заданному поиску контракты не найдены"
                            : tab === "anomalies" ? "Аномалии не обнаружены" : "Нет данных"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
