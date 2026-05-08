import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export const Route = createFileRoute("/_admin/bids")({
  component: Bids,
});

const bids = [
  { id: "B-9821", tender: "T-3901", name: "Поставка IaaS серверов для дата-центра", organizer: '110840000407 Некоммерческое акционерное общество "Talap"', price: "12 380 000", date: "12.04.2026", status: "approved" },
  { id: "B-9820", tender: "T-3901", name: "Поставка IaaS серверов для дата-центра", organizer: '110840000407 Некоммерческое акционерное общество "Talap"', price: "12 410 000", date: "12.04.2026", status: "pending" },
  { id: "B-9819", tender: "T-3902", name: "Аренда IaaS инфраструктуры на 12 месяцев", organizer: '110840000407 Некоммерческое акционерное общество "Talap"', price: "8 050 000", date: "11.04.2026", status: "approved" },
  { id: "B-9818", tender: "T-3902", name: "Аренда IaaS инфраструктуры на 12 месяцев", organizer: '110840000407 Некоммерческое акционерное общество "Talap"', price: "8 180 000", date: "11.04.2026", status: "pending" },
  { id: "B-9817", tender: "T-3903", name: "Развертывание отказоустойчивого IaaS кластера", organizer: '110840000407 Некоммерческое акционерное общество "Talap"', price: "15 200 000", date: "10.04.2026", status: "rejected" },
  { id: "B-9816", tender: "T-3904", name: "Поставка серверных стоек под IaaS", organizer: '110840000407 Некоммерческое акционерное общество "Talap"', price: "6 695 000", date: "10.04.2026", status: "approved" },
];

const statusMap = {
  approved: { label: "Принята", icon: CheckCircle2, cls: "bg-success/15 text-success" },
  pending: { label: "Ожидает", icon: Clock, cls: "bg-warning/15 text-warning" },
  rejected: { label: "Отклонена", icon: XCircle, cls: "bg-destructive/15 text-destructive" },
};

function Bids() {
  return (
    <>
      <PageHeader title="Заявки" description="Все заявки участников на тендеры" />
      <div className="p-8">
        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">ID заявки</th>
                <th className="px-6 py-3 text-left font-medium">Тендер</th>
                <th className="px-6 py-3 text-left font-medium">Наименование тендера</th>
                <th className="px-6 py-3 text-left font-medium">Организатор тендера</th>
                <th className="px-6 py-3 text-right font-medium">Цена ₸</th>
                <th className="px-6 py-3 text-left font-medium">Дата</th>
                <th className="px-6 py-3 text-left font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => {
                const s = statusMap[b.status as keyof typeof statusMap];
                const Icon = s.icon;
                return (
                  <tr key={b.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{b.id}</td>
                    <td className="px-6 py-4 font-mono text-xs font-medium text-primary">{b.tender}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{b.name}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{b.organizer}</td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums">{b.price}</td>
                    <td className="px-6 py-4 text-muted-foreground">{b.date}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
                        <Icon className="h-3 w-3" /> {s.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
