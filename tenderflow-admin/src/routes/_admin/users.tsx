import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";

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

function Users() {
  return (
    <>
      <PageHeader title="Пользователи" description="Учётные записи на платформе" />
      <div className="p-8">
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
              {users.map((u) => (
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
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
