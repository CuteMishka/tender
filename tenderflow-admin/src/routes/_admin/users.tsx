import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Search } from "lucide-react";
import { getLocalApiBase } from "@/lib/tenders-api";

export const Route = createFileRoute("/_admin/users")({
  component: Users,
});

const users = [
  { name: "Иван Петров", email: "i.petrov@rassvet.ru", role: "Заказчик", company: "ООО «Рассвет»", status: "Активен" },
  { name: "Мария Сидорова", email: "m.sidorova@stroymash.ru", role: "Заказчик", company: "СК «СтройМаш»", status: "Активен" },
  { name: "Алексей Козлов", email: "a.kozlov@techflow.com", role: "Поставщик", company: "TechFlow Ltd.", status: "Активен" },
  { name: "Елена Новикова", email: "e.novikova@medprom.ru", role: "Поставщик", company: "МедПром", status: "Заблокирован" },
  { name: "Дмитрий Васин", email: "d.vasin@admin.ru", role: "Модератор", company: "—", status: "Активен" },
];

type BackendUser = {
  id: number;
  email: string;
  name?: string;
  created_at?: string;
};

type UserRow = {
  name: string;
  email: string;
  role: string;
  company: string;
  status: string;
};

function mapBackendUser(u: BackendUser): UserRow {
  return {
    name: u.name?.trim() || u.email,
    email: u.email,
    role: "Пользователь",
    company: "—",
    status: "Активен",
  };
}

function Users() {
  const [searchText, setSearchText] = useState("");
  const [rows, setRows] = useState<UserRow[]>(users);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`${getLocalApiBase()}/api/v1/users`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
        return res.json() as Promise<BackendUser[]>;
      })
      .then((data) => {
        if (!cancelled && Array.isArray(data) && data.length > 0) setRows(data.map(mapBackendUser));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const visibleUsers = rows.filter((u) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${u.name} ${u.email} ${u.role} ${u.company} ${u.status}`.toLowerCase().includes(q);
  });

  return (
    <>
      <PageHeader title="Пользователи" description="Учётные записи на платформе" />
      <div className="space-y-4 p-8">
        {loadError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Backend users недоступен, показан локальный список: {loadError}
          </div>
        )}
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Поиск по пользователю, email, роли, компании..."
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div
          className="overflow-hidden rounded-xl border border-border bg-card"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Пользователь</th>
                <th className="px-6 py-3 text-left font-medium">Роль</th>
                <th className="px-6 py-3 text-left font-medium">Компания</th>
                <th className="px-6 py-3 text-left font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.email} className="border-t border-border hover:bg-muted/40">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {u.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{u.company}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${u.status === "Активен" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                      {u.status}
                    </span>
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-sm text-muted-foreground">
                    {loading ? "Загрузка пользователей…" : "Пользователи не найдены"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
