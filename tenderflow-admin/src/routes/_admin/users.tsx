import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Check, Search, Trash2, X } from "lucide-react";
import { canManageUsers, getCurrentUser, roleLabels, type UserRole } from "@/lib/auth";
import { getLocalApiBase } from "@/lib/tenders-api";

export const Route = createFileRoute("/_admin/users")({
  component: Users,
});

type BackendUser = {
  id: number;
  email: string;
  name?: string;
  role?: UserRole;
  company?: string;
  position?: string;
  status?: string;
  created_at?: string;
};

type RegistrationRequest = {
  id: number;
  email: string;
  name: string;
  company?: string;
  position?: string;
  comment?: string;
  status: string;
  created_at?: string;
};

const roleOptions: UserRole[] = ["admin", "director", "tender_specialist"];

function Users() {
  const currentUser = getCurrentUser();
  const [searchText, setSearchText] = useState("");
  const [rows, setRows] = useState<BackendUser[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Record<number, UserRole>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [usersRes, requestsRes] = await Promise.all([
        fetch(`${getLocalApiBase()}/api/v1/users`),
        fetch(`${getLocalApiBase()}/api/v1/registration-requests?status=pending`),
      ]);
      if (!usersRes.ok) throw new Error(`${usersRes.status}: ${(await usersRes.text()).slice(0, 160)}`);
      if (!requestsRes.ok) throw new Error(`${requestsRes.status}: ${(await requestsRes.text()).slice(0, 160)}`);
      const usersData = await usersRes.json() as BackendUser[];
      const requestsData = await requestsRes.json() as RegistrationRequest[];
      setRows(Array.isArray(usersData) ? usersData : []);
      setRequests(Array.isArray(requestsData) ? requestsData : []);
      const nextRoles: Record<number, UserRole> = {};
      for (const req of requestsData) nextRoles[req.id] = "tender_specialist";
      setSelectedRoles(nextRoles);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const visibleUsers = rows.filter((u) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return `${u.name ?? ""} ${u.email} ${u.role ?? ""} ${u.company ?? ""} ${u.position ?? ""} ${u.status ?? ""}`.toLowerCase().includes(q);
  });

  const approveRequest = async (request: RegistrationRequest) => {
    const role = selectedRoles[request.id] || "tender_specialist";
    setActionLoading(`approve-${request.id}`);
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/registration-requests/${request.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const rejectRequest = async (request: RegistrationRequest) => {
    setActionLoading(`reject-${request.id}`);
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/registration-requests/${request.id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const updateUserRole = async (user: BackendUser, role: UserRole) => {
    setActionLoading(`role-${user.id}`);
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/users/${user.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const deleteUser = async (user: BackendUser) => {
    if (currentUser?.id === user.id) {
      setLoadError("Нельзя удалить текущего пользователя.");
      return;
    }
    setActionLoading(`delete-${user.id}`);
    try {
      const res = await fetch(`${getLocalApiBase()}/api/v1/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  if (!canManageUsers(currentUser)) {
    return (
      <>
        <PageHeader title="Пользователи" description="Доступ ограничен" />
        <div className="p-8">
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Управление пользователями доступно только админу и директору.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Пользователи" description="Учётные записи, роли и заявки на регистрацию" />
      <div className="space-y-4 p-8">
        {loadError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {loadError}
          </div>
        )}
        <div className="rounded-xl border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Заявки на регистрацию</h2>
              <p className="text-sm text-muted-foreground">Директор или админ принимает заявку и назначает роль</p>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{requests.length}</span>
          </div>
          <div className="space-y-3">
            {requests.map((req) => (
              <div key={req.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{req.name}</div>
                    <div className="text-xs text-muted-foreground">{req.email}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{req.company || "Компания не указана"} · {req.position || "Должность не указана"}</div>
                    {req.comment && <div className="mt-2 text-sm text-muted-foreground">{req.comment}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedRoles[req.id] || "tender_specialist"}
                      onChange={(e) => setSelectedRoles((prev) => ({ ...prev, [req.id]: e.target.value as UserRole }))}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    >
                      {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                    </select>
                    <button
                      onClick={() => approveRequest(req)}
                      disabled={actionLoading !== null}
                      className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      Принять
                    </button>
                    <button
                      onClick={() => rejectRequest(req)}
                      disabled={actionLoading !== null}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      Отклонить
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {requests.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {loading ? "Загрузка заявок…" : "Новых заявок нет"}
              </div>
            )}
          </div>
        </div>
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
                <th className="px-6 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {(u.name || u.email).split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{u.name?.trim() || u.email}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={u.role || "tender_specialist"}
                      onChange={(e) => updateUserRole(u, e.target.value as UserRole)}
                      disabled={actionLoading !== null}
                      className="rounded-lg border border-input bg-background px-2 py-1 text-xs font-medium"
                    >
                      {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    <div>{u.company || "—"}</div>
                    {u.position && <div className="text-xs">{u.position}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${(u.status || "active") === "active" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                      {(u.status || "active") === "active" ? "Активен" : u.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => deleteUser(u)}
                      disabled={actionLoading !== null || currentUser?.id === u.id}
                      className="inline-flex rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 transition hover:bg-red-100 disabled:opacity-40"
                      title="Удалить пользователя"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-sm text-muted-foreground">
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
