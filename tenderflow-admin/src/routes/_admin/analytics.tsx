import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";

export const Route = createFileRoute("/_admin/analytics")({
  component: Analytics,
});

function Analytics() {
  return (
    <>
      <PageHeader title="Аналитика" description="Отчёты и ключевые показатели" />
      <div className="grid gap-6 p-8 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h3 className="mb-4 font-semibold">Объём контрактов по месяцам</h3>
          <div className="flex h-56 items-end gap-2">
            {[55, 72, 68, 90, 78, 95, 88, 100, 84, 76, 92, 80].map((h, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div className="w-full rounded-t-md" style={{ height: `${h}%`, background: "var(--gradient-primary)" }} />
                <span className="text-[10px] text-muted-foreground">{["Я","Ф","М","А","М","И","И","А","С","О","Н","Д"][i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h3 className="mb-4 font-semibold">Топ заказчиков</h3>
          <div className="space-y-3">
            {[
              { name: "СК «СтройМаш»", val: "₸ 42.1М" },
              { name: "TechFlow Ltd.", val: "₸ 28.5М" },
              { name: "ООО «Рассвет»", val: "₸ 19.7М" },
              { name: "МедПром", val: "₸ 15.2М" },
              { name: "АльфаКонсалт", val: "₸ 11.0М" },
            ].map((c, i) => (
              <div key={c.name} className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i+1}</span>
                  <span className="font-medium">{c.name}</span>
                </div>
                <span className="font-semibold text-primary">{c.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
