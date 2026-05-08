import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";
import { TrendingUp, TrendingDown, Gavel, FileText, Building2, DollarSign, Download } from "lucide-react";

export const Route = createFileRoute("/_admin/dashboard")({
  component: Dashboard,
});

const stats = [
  { label: "Активные тендеры", value: "248", change: "+12.5%", trend: "up" as const, icon: Gavel, accent: "bg-primary/10 text-primary" },
  { label: "Заявки за месяц", value: "1 842", change: "+8.2%", trend: "up" as const, icon: FileText, accent: "bg-success/10 text-success" },
  { label: "Зарегистр. компаний", value: "576", change: "+3.1%", trend: "up" as const, icon: Building2, accent: "bg-warning/10 text-warning" },
  { label: "Объём контрактов", value: "₸ 124.5М", change: "-2.4%", trend: "down" as const, icon: DollarSign, accent: "bg-accent text-accent-foreground" },
];

const recentTenders = [
  { id: "T-3901", title: "Поставка IaaS серверов для дата-центра", company: "IaaS Серверы", amount: "₸ 12 450 000", status: "Активен", statusColor: "bg-success/15 text-success" },
  { id: "T-3902", title: "Аренда IaaS инфраструктуры на 12 месяцев", company: "CloudStack KZ", amount: "₸ 18 700 000", status: "На проверке", statusColor: "bg-warning/15 text-warning" },
  { id: "T-3903", title: "Развертывание отказоустойчивого IaaS кластера", company: "HyperNode Systems", amount: "₸ 15 200 000", status: "Активен", statusColor: "bg-success/15 text-success" },
  { id: "T-3904", title: "Поставка серверных стоек под IaaS", company: "ServerPoint", amount: "₸ 9 800 000", status: "Завершён", statusColor: "bg-muted text-muted-foreground" },
  { id: "T-3905", title: "Техподдержка IaaS платформы 24/7", company: "Alem Cloud", amount: "₸ 6 720 000", status: "Активен", statusColor: "bg-success/15 text-success" },
];

function Dashboard() {
  return (
    <>
      <PageHeader
        title="Дашборд"
        description="Обзор активности тендерной площадки"
        actions={
          <>
            <button className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
              <Download className="h-4 w-4" /> Экспорт
            </button>
          </>
        }
      />

      <div className="space-y-6 p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            const TrendIcon = s.trend === "up" ? TrendingUp : TrendingDown;
            return (
              <div
                key={s.label}
                className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40"
                style={{ boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-start justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.trend === "up" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                    <TrendIcon className="h-3 w-3" /> {s.change}
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{s.value}</p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div
            className="rounded-xl border border-border bg-card p-6 lg:col-span-2"
            style={{ boxShadow: "var(--shadow-sm)" }}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Динамика заявок</h3>
                <p className="text-xs text-muted-foreground">Последние 7 дней</p>
              </div>
              <select className="rounded-md border border-border bg-background px-3 py-1.5 text-xs">
                <option>Неделя</option>
                <option>Месяц</option>
                <option>Год</option>
              </select>
            </div>
            <div className="flex h-48 items-end gap-3">
              {[42, 68, 55, 80, 72, 95, 88].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md transition-all hover:opacity-80"
                    style={{ height: `${h}%`, background: "var(--gradient-primary)" }}
                  />
                  <span className="text-xs text-muted-foreground">{["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][i]}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h3 className="text-base font-semibold">Последние тендеры</h3>
              <p className="text-xs text-muted-foreground">Недавняя активность на площадке</p>
            </div>
            <button className="text-sm font-medium text-primary hover:underline">Все тендеры →</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">ID</th>
                <th className="px-6 py-3 text-left font-medium">Название</th>
                <th className="px-6 py-3 text-left font-medium">Заказчик</th>
                <th className="px-6 py-3 text-left font-medium">Сумма</th>
                <th className="px-6 py-3 text-left font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {recentTenders.map((t) => (
                <tr key={t.id} className="border-t border-border transition hover:bg-muted/40">
                  <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{t.id}</td>
                  <td className="px-6 py-4 font-medium text-foreground">{t.title}</td>
                  <td className="px-6 py-4 text-muted-foreground">{t.company}</td>
                  <td className="px-6 py-4 font-semibold">{t.amount}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${t.statusColor}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
