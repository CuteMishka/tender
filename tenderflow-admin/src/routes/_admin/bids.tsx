import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { CheckCircle2, Clock, XCircle, Trash2, FileText, Search } from "lucide-react";
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
  created_at: string;
}

const statusMap: Record<string, { label: string; icon: any; cls: string }> = {
  participating: { label: "Участвуем", icon: CheckCircle2, cls: "bg-primary/15 text-primary" },
  active: { label: "Открыт", icon: Clock, cls: "bg-success/15 text-success" },
  rejected: { label: "Отклонен", icon: XCircle, cls: "bg-destructive/15 text-destructive" },
};

function Bids() {
  const navigate = useNavigate();
  const [bids, setBids] = useState<SavedLot[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "participating" | "rejected" | "active">("all");
  const [searchText, setSearchText] = useState("");

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

  const filteredBids = bids.filter((b) => {
    if (activeTab !== "all" && b.status !== activeTab) return false;
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${b.id} ${b.title} ${b.organizer_name} ${b.purchase_type} ${b.status}`.toLowerCase().includes(q);
  });
  const tabCounts = {
    all: bids.length,
    participating: bids.filter((b) => b.status === "participating").length,
    active: bids.filter((b) => b.status === "active").length,
    rejected: bids.filter((b) => b.status === "rejected").length,
  };

  return (
    <>
      <PageHeader title="Заявки" description="Все заявки участников на тендеры" />
      <div className="p-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Поиск по названию, организатору, виду закупки..."
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "all", label: "Все" },
            { key: "participating", label: "Наше участие" },
            { key: "active", label: "Активные" },
            { key: "rejected", label: "Не подходит" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === tab.key ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-accent"}`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${activeTab === tab.key ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>
                {tabCounts[tab.key as keyof typeof tabCounts]}
              </span>
            </button>
          ))}
        </div>
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
                <th className="px-6 py-3 text-left font-medium">Цена ₸</th>
                <th className="px-6 py-3 text-left font-medium">Дата</th>
                <th className="px-6 py-3 text-left font-medium">Статус</th>
                <th className="px-6 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredBids.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileText className="h-10 w-10 opacity-20" />
                      <p className="text-sm font-medium">
                        {searchText.trim()
                          ? "По названию, организатору или виду закупки заявки не найдены"
                          : activeTab === "all" ? "Заявок пока нет" : `Нет заявок со статусом «${{ all: "", participating: "Наше участие", active: "Активные", rejected: "Не подходит" }[activeTab]}»`}
                      </p>
                      {activeTab === "all" && !searchText.trim() && (
                        <p className="text-xs">Отметьте тендер кнопкой «Подходит» во вкладке Тендеры</p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {filteredBids.map((b) => {
                const s = statusMap[b.status] || statusMap.active;
                const Icon = s.icon;
                const dateStr = new Date(b.created_at).toLocaleDateString('ru-KZ');
                const amountStr = new Intl.NumberFormat('ru-KZ').format(b.amount);
                
                return (
                  <tr
                    key={b.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/40"
                    onClick={() => navigate({ to: "/tenders/$tenderId", params: { tenderId: String(b.id) } })}
                  >
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">B-{b.id}</td>
                    <td className="px-6 py-4 font-mono text-xs font-medium text-primary">T-{b.id}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{b.title}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{b.organizer_name || "Компания не указана"}</td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums">₸ {amountStr}</td>
                    <td className="px-6 py-4 text-muted-foreground">{dateStr}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
                        <Icon className="h-3 w-3" /> {s.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                        title="Удалить заявку"
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
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
