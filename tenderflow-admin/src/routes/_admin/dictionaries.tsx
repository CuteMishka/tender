import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Edit2, Plus, Save, Trash2, X, Download } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";

export const Route = createFileRoute("/_admin/dictionaries")({
  component: DictionariesPage,
});

type DictKind = "advantages" | "blockers" | "keywords" | "tru" | "companies";

type DictItem = {
  id: string;
  value: string;
  active: boolean;
  lastLot?: string;
};

const tabs: { key: DictKind; label: string; hint: string; seed: string[] }[] = [
  { key: "advantages", label: "Преимущества", hint: "Что усиливает релевантность тендера", seed: ["Информационная безопасность", "SOC", "DLP", "NGFW"] },
  { key: "blockers", label: "Блокеры", hint: "Что исключает тендер на этапе парсинга", seed: ["Строительные работы", "Поставка мебели", "Медицинское оборудование"] },
  { key: "keywords", label: "Ключевые слова", hint: "Слова для поиска тендеров и парсера", seed: ["кибербезопасность", "ОЦИБ", "EDR", "пентест", "аудит безопасности"] },
  { key: "tru", label: "ТРУ коды", hint: "Коды товаров/работ/услуг для будущего парсера", seed: ["620920.000.000000", "631111.000.000000", "749020.000.000000"] },
  { key: "companies", label: "Компании / BIN", hint: "Наши компании, конкуренты и заказчики", seed: ["Freedom Cloud", "CitizenSec", "ТОО пример / 123456789012"] },
];

const storageKey = "parser_dictionaries_v1";

function createItem(value: string): DictItem {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, value, active: true };
}

function seedData(): Record<DictKind, DictItem[]> {
  return Object.fromEntries(tabs.map((tab) => [tab.key, tab.seed.map(createItem)])) as Record<DictKind, DictItem[]>;
}

function loadData(): Record<DictKind, DictItem[]> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return seedData();
    const parsed = JSON.parse(raw) as Partial<Record<DictKind, DictItem[]>>;
    const seeded = seedData();
    for (const tab of tabs) seeded[tab.key] = Array.isArray(parsed[tab.key]) ? parsed[tab.key]! : seeded[tab.key];
    return seeded;
  } catch {
    return seedData();
  }
}

function saveData(data: Record<DictKind, DictItem[]>) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

function DictionariesPage() {
  const [data, setData] = useState<Record<DictKind, DictItem[]>>(loadData);
  const [active, setActive] = useState<DictKind>("keywords");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => saveData(data), [data]);

  const activeTab = tabs.find((tab) => tab.key === active)!;
  const items = data[active];
  const totals = useMemo(() => Object.fromEntries(
    tabs.map((tab) => [tab.key, { total: data[tab.key].length, active: data[tab.key].filter((i) => i.active).length }])
  ), [data]);

  const exportCSV = () => {
    const rows = items.map((item, i) => `${i + 1},"${item.value.replace(/"/g, '""')}",${item.active ? "Вкл" : "Выкл"},"${item.lastLot || ""}"`);
    const csv = `#,Значение,Статус,Последний лот\n${rows.join("\n")}`;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab.label}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    setData((prev) => ({ ...prev, [active]: [...prev[active], createItem(value)] }));
    setDraft("");
  };

  const remove = (id: string) => {
    setData((prev) => ({ ...prev, [active]: prev[active].filter((item) => item.id !== id) }));
  };

  const toggle = (id: string) => {
    setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === id ? { ...item, active: !item.active } : item) }));
  };

  const startEdit = (item: DictItem) => {
    setEditingId(item.id);
    setEditingValue(item.value);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const value = editingValue.trim();
    if (!value) return;
    setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === editingId ? { ...item, value } : item) }));
    setEditingId(null);
    setEditingValue("");
  };

  return (
    <>
      <PageHeader
        title="Справочники"
        description="Преимущества, блокеры, ключевые слова, ТРУ коды и переменные для будущего парсера"
        actions={
          <button onClick={() => setData(seedData())} className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            Сбросить демо
          </button>
        }
      />

      <div className="space-y-5 p-8">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const t = totals[tab.key];
            return (
              <button
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${active === tab.key ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-accent"}`}
              >
                {tab.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${active === tab.key ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>
                  {t.active}/{t.total}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <h3 className="text-base font-semibold">{activeTab.label}</h3>
              <p className="text-xs text-muted-foreground">{activeTab.hint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex min-w-[280px] flex-1 gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                  placeholder="Добавить значение"
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
                <button onClick={add} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                  <Plus className="h-4 w-4" /> Добавить
                </button>
              </div>
              <button
                onClick={exportCSV}
                title="Експорт в CSV"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                <Download className="h-4 w-4" /> CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">#</th>
                  <th className="px-6 py-3 text-left font-medium">Значение</th>
                  <th className="px-6 py-3 text-left font-medium">Активно</th>
                  <th className="px-6 py-3 text-left font-medium">Последний лот</th>
                  <th className="px-6 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-6 py-3">
                      {editingId === item.id ? (
                        <input value={editingValue} onChange={(e) => setEditingValue(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                      ) : (
                        <span className="font-medium text-foreground">{item.value}</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <button onClick={() => toggle(item.id)} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${item.active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                        <Check className="h-3 w-3" /> {item.active ? "Вкл" : "Выкл"}
                      </button>
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{item.lastLot || "—"}</td>
                    <td className="px-6 py-3 text-right">
                      {editingId === item.id ? (
                        <div className="inline-flex gap-1">
                          <button onClick={saveEdit} className="rounded-lg p-2 text-green-700 hover:bg-green-100"><Save className="h-4 w-4" /></button>
                          <button onClick={() => setEditingId(null)} className="rounded-lg p-2 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-1">
                          <button onClick={() => startEdit(item)} className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><Edit2 className="h-4 w-4" /></button>
                          <button onClick={() => remove(item.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
