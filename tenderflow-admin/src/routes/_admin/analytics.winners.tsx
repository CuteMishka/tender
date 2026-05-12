import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Trophy, AlertCircle, Search } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { analyticsApi, fmtM, fmtN, fmtPct, type WinnerRow } from "@/lib/analytics-api";

export const Route = createFileRoute("/_admin/analytics/winners")({
  component: WinnersAnalytics,
});

const COLORS = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#65a30d"];

function WinnersAnalytics() {
  const [winners, setWinners] = useState<WinnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    analyticsApi.getWinners()
      .then((d) => setWinners(d ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredWinners = winners.filter((w) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${w.winner_name} ${w.wins} ${w.total_amount} ${w.avg_amount} ${w.max_amount}`.toLowerCase().includes(q);
  });

  const totalWins = filteredWinners.reduce((s, w) => s + w.wins, 0);
  const totalAmount = filteredWinners.reduce((s, w) => s + w.total_amount, 0);

  // Данные для pie chart: топ-5 + "Остальные"
  const top5 = filteredWinners.slice(0, 5);
  const restAmount = filteredWinners.slice(5).reduce((s, w) => s + w.total_amount, 0);
  const pieData = [
    ...top5.map((w) => ({ name: w.winner_name, value: w.total_amount })),
    ...(restAmount > 0 ? [{ name: "Остальные", value: restAmount }] : []),
  ];

  // Данные для bar chart: топ-10 по числу побед
  const barData = filteredWinners.slice(0, 10).map((w) => ({
    name: w.winner_name.length > 18 ? w.winner_name.slice(0, 18) + "…" : w.winner_name,
    wins: w.wins,
    amount: +(w.total_amount / 1_000_000).toFixed(1),
  }));

  return (
    <>
      <PageHeader
        title="Аналитика победителей"
        description="Рейтинг поставщиков по числу побед и объёму контрактов"
      />

      <div className="space-y-6 p-8">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
            <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" /> Загрузка…
          </div>
        ) : winners.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-24 text-muted-foreground">
            <AlertCircle className="mb-3 h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">Нет данных о победителях</p>
            <p className="mt-1 text-xs">Добавьте победителей вручную в разделе «История тендеров» или загрузите данные из внешнего источника</p>
          </div>
        ) : (
          <>
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Поиск по победителю, количеству побед, суммам..."
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
              />
            </div>

            {/* Итоговые карточки */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                <p className="text-xs text-muted-foreground">Уникальных победителей</p>
                <p className="mt-1 text-2xl font-bold">{filteredWinners.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                <p className="text-xs text-muted-foreground">Всего побед</p>
                <p className="mt-1 text-2xl font-bold">{totalWins}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
                <p className="text-xs text-muted-foreground">Общий объём контрактов</p>
                <p className="mt-1 text-2xl font-bold">₸ {fmtM(totalAmount)}</p>
              </div>
            </div>

            {/* Графики */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
                <h3 className="mb-1 text-sm font-semibold">Доля рынка (топ-5)</h3>
                <p className="mb-4 text-xs text-muted-foreground">По объёму контрактов</p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                      dataKey="value" nameKey="name" label={({ name, percent }) =>
                        percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`₸ ${fmtM(v)}`, "Объём"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pieData.map((d, i) => (
                    <span key={d.name} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      {d.name.length > 22 ? d.name.slice(0, 22) + "…" : d.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
                <h3 className="mb-1 text-sm font-semibold">Топ-10 по числу побед</h3>
                <p className="mb-4 text-xs text-muted-foreground">Количество выигранных тендеров</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                    <Tooltip formatter={(v: number) => [v, "Побед"]} />
                    <Bar dataKey="wins" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Таблица рейтинга */}
            <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="border-b border-border px-6 py-4">
                <h3 className="text-sm font-semibold">Рейтинг поставщиков</h3>
                <p className="text-xs text-muted-foreground">По числу побед и объёму контрактов</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-center font-medium w-12">#</th>
                      <th className="px-4 py-3 text-left font-medium">Победитель</th>
                      <th className="px-4 py-3 text-right font-medium">Побед</th>
                      <th className="px-4 py-3 text-right font-medium">Общий объём ₸</th>
                      <th className="px-4 py-3 text-right font-medium">Ср. контракт ₸</th>
                      <th className="px-4 py-3 text-right font-medium">Макс. контракт ₸</th>
                      <th className="px-4 py-3 text-right font-medium">Доля рынка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWinners.map((w, i) => (
                      <tr key={w.winner_name} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-3 text-center">
                          {i === 0 ? <Trophy className="mx-auto h-4 w-4 text-yellow-500" /> :
                           i === 1 ? <Trophy className="mx-auto h-4 w-4 text-gray-400" /> :
                           i === 2 ? <Trophy className="mx-auto h-4 w-4 text-amber-700" /> :
                           <span className="text-xs text-muted-foreground">{i + 1}</span>}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{w.winner_name}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{w.wins}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtN(w.total_amount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtN(w.avg_amount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtN(w.max_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, w.market_share_pct)}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">{fmtPct(w.market_share_pct)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredWinners.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-sm text-muted-foreground">
                          Победители не найдены
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
