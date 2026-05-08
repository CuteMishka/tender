import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { CheckCircle2, Clock, XCircle, Trash2 } from "lucide-react";
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
  created_at: string;
}

const statusMap: Record<string, { label: string; icon: any; cls: string }> = {
  participating: { label: "Участвуем", icon: CheckCircle2, cls: "bg-primary/15 text-primary" },
  active: { label: "Открыт", icon: Clock, cls: "bg-success/15 text-success" },
  rejected: { label: "Отклонен", icon: XCircle, cls: "bg-destructive/15 text-destructive" },
};

function Bids() {
  const [bids, setBids] = useState<SavedLot[]>([]);

  useEffect(() => {
    const base = getLocalApiBase();
    fetch(`${base}/api/v1/lots/saved`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setBids(data); })
      .catch((err) => console.error(err));
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
                    <th className="px-6 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => {
                const s = statusMap[b.status] || statusMap.active;
                const Icon = s.icon;
                const dateStr = new Date(b.created_at).toLocaleDateString('ru-KZ');
                const amountStr = new Intl.NumberFormat('ru-KZ').format(b.amount);
                
                return (
                  <tr key={b.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">B-{b.id}</td>
                    <td className="px-6 py-4 font-mono text-xs font-medium text-primary">T-{b.id}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{b.title}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{b.purchase_type || "Государственные закупки"}</td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums">₸ {amountStr}</td>
                    <td className="px-6 py-4 text-muted-foreground">{dateStr}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
                        <Icon className="h-3 w-3" /> {s.label}
                      </span>
                    </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDelete(b.id)}
                          className="inline-flex rounded p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Удалить заявку"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
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
