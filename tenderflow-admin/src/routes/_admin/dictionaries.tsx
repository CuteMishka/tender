import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Edit2, Plus, Save, Trash2, X, Download, Search } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { getLocalApiBase } from "@/lib/tenders-api";

export const Route = createFileRoute("/_admin/dictionaries")({
  component: DictionariesPage,
});

type DictKind = "advantages" | "blockers" | "keywords" | "tru" | "companies";

type DictItem = {
  id: string;
  kind?: DictKind;
  value: string;
  active: boolean;
  lastLot?: string;
};

const tabs: { key: DictKind; label: string; hint: string }[] = [
  { key: "advantages", label: "Преимущества", hint: "Что усиливает релевантность тендера" },
  { key: "blockers", label: "Блокеры", hint: "Что исключает тендер на этапе парсинга" },
  { key: "keywords", label: "Ключевые слова", hint: "Слова для поиска тендеров и парсера" },
  { key: "tru", label: "ТРУ коды", hint: "Коды товаров/работ/услуг для будущего парсера" },
  { key: "companies", label: "Компании / BIN", hint: "Наши компании, конкуренты и заказчики" },
];

const storageKey = "parser_dictionaries_v1";

function createItem(value: string): DictItem {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, value, active: true };
}

function emptyData(): Record<DictKind, DictItem[]> {
  return {
    advantages: [],
    blockers: [],
    keywords: [],
    tru: [],
    companies: [],
  };
}

function loadData(): Record<DictKind, DictItem[]> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as Partial<Record<DictKind, DictItem[]>>;
    const data = emptyData();
    for (const tab of tabs) data[tab.key] = Array.isArray(parsed[tab.key]) ? parsed[tab.key]! : [];
    return data;
  } catch {
    return emptyData();
  }
}

function saveData(data: Record<DictKind, DictItem[]>) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

function normalizeData(items: DictItem[]): Record<DictKind, DictItem[]> {
  const data = emptyData();
  for (const item of items) {
    const kind = item.kind;
    if (!kind || !(kind in data)) continue;
    data[kind].push({ ...item, id: String(item.id), kind });
  }
  return data;
}

async function fetchDictionaries(): Promise<Record<DictKind, DictItem[]>> {
  const res = await fetch(`${getLocalApiBase()}/api/v1/dictionaries`);
  if (!res.ok) throw new Error(`Dictionaries API ${res.status}`);
  const payload = await res.json() as { items?: DictItem[]; data?: DictItem[] };
  return normalizeData(Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : []);
}

async function createDictionaryItem(kind: DictKind, value: string): Promise<DictItem> {
  const res = await fetch(`${getLocalApiBase()}/api/v1/dictionaries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, value, active: true }),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200));
  return await res.json() as DictItem;
}

async function updateDictionaryItem(item: DictItem): Promise<DictItem> {
  const res = await fetch(`${getLocalApiBase()}/api/v1/dictionaries/${encodeURIComponent(item.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: item.kind, value: item.value, active: item.active, lastLot: item.lastLot || "" }),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200));
  return await res.json() as DictItem;
}

async function deleteDictionaryItem(id: string): Promise<void> {
  const res = await fetch(`${getLocalApiBase()}/api/v1/dictionaries/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error((await res.text()).slice(0, 200));
}

function DictionariesPage() {
  const [data, setData] = useState<Record<DictKind, DictItem[]>>(loadData);
  const [active, setActive] = useState<DictKind>("keywords");
  const [draft, setDraft] = useState("");
  const [searchText, setSearchText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [syncStatus, setSyncStatus] = useState<"loading" | "online" | "offline">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => saveData(data), [data]);

  useEffect(() => {
    let cancelled = false;
    fetchDictionaries()
      .then((remoteData) => {
        if (cancelled) return;
        setData(remoteData);
        setSyncStatus("online");
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSyncStatus("offline");
        setError(err instanceof Error ? err.message : "Справочник работает локально");
      });
    return () => { cancelled = true; };
  }, []);

  const activeTab = tabs.find((tab) => tab.key === active)!;
  const items = data[active];
  const visibleItems = items.filter((item) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${item.value} ${item.lastLot ?? ""} ${item.active ? "вкл активно" : "выкл неактивно"}`.toLowerCase().includes(q);
  });
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

  const add = async () => {
    const value = draft.trim();
    if (!value) return;
    const optimistic = { ...createItem(value), kind: active };
    setData((prev) => ({ ...prev, [active]: [...prev[active], optimistic] }));
    setDraft("");
    if (syncStatus !== "online") return;
    try {
      const saved = await createDictionaryItem(active, value);
      setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === optimistic.id ? { ...saved, kind: active, id: String(saved.id) } : item) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить значение");
    }
  };

  const remove = async (id: string) => {
    const previous = data;
    setData((prev) => ({ ...prev, [active]: prev[active].filter((item) => item.id !== id) }));
    if (syncStatus !== "online") return;
    try {
      await deleteDictionaryItem(id);
    } catch (err) {
      setData(previous);
      setError(err instanceof Error ? err.message : "Не удалось удалить значение");
    }
  };

  const toggle = async (id: string) => {
    const current = data[active].find((item) => item.id === id);
    if (!current) return;
    const updated = { ...current, kind: current.kind || active, active: !current.active };
    setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === id ? updated : item) }));
    if (syncStatus !== "online") return;
    try {
      const saved = await updateDictionaryItem(updated);
      setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === id ? { ...saved, kind: active, id: String(saved.id) } : item) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить значение");
    }
  };

  const startEdit = (item: DictItem) => {
    setEditingId(item.id);
    setEditingValue(item.value);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const value = editingValue.trim();
    if (!value) return;
    const current = data[active].find((item) => item.id === editingId);
    if (!current) return;
    const updated = { ...current, kind: current.kind || active, value };
    setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === editingId ? updated : item) }));
    setEditingId(null);
    setEditingValue("");
    if (syncStatus !== "online") return;
    try {
      const saved = await updateDictionaryItem(updated);
      setData((prev) => ({ ...prev, [active]: prev[active].map((item) => item.id === updated.id ? { ...saved, kind: active, id: String(saved.id) } : item) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить изменение");
    }
  };

  return (
    <>
      <PageHeader
        title="Справочники"
        description="Преимущества, блокеры, ключевые слова, ТРУ коды и переменные для будущего парсера"
        actions={
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${syncStatus === "online" ? "bg-green-100 text-green-700" : syncStatus === "loading" ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>
              {syncStatus === "online" ? "Backend sync" : syncStatus === "loading" ? "Загрузка" : "Local fallback"}
            </span>
            <button onClick={() => setData(emptyData())} className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
              Очистить локально
            </button>
          </div>
        }
      />

      <div className="space-y-5 p-8">
        {error && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            {syncStatus === "offline" ? "Backend справочников недоступен, изменения сохраняются локально. " : ""}
            {error}
          </div>
        )}
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
              <div className="relative min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Поиск по справочнику"
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
                />
              </div>
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
                {visibleItems.map((item, i) => (
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
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-muted-foreground">
                      По справочнику ничего не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
