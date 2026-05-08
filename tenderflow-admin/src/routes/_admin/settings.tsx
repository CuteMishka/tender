import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/PageHeader";

export const Route = createFileRoute("/_admin/settings")({
  component: Settings,
});

function Settings() {
  return (
    <>
      <PageHeader title="Настройки" description="Параметры площадки и аккаунта" />
      <div className="max-w-3xl space-y-6 p-8">
        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h3 className="mb-1 font-semibold">Профиль администратора</h3>
          <p className="mb-5 text-sm text-muted-foreground">Базовая информация об аккаунте</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Имя</label>
              <input defaultValue="Администратор" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input defaultValue="admin@tender.ru" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <button className="mt-5 rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
            Сохранить изменения
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h3 className="mb-5 font-semibold">Уведомления</h3>
          <div className="space-y-3">
            {["Новые тендеры", "Поступление заявок", "Регистрация компаний", "Системные оповещения"].map((label, i) => (
              <label key={label} className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
                <span className="text-sm font-medium">{label}</span>
                <input type="checkbox" defaultChecked={i < 3} className="h-4 w-4 accent-primary" />
              </label>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
