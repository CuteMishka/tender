import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { pushNotification } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_admin/settings")({
  component: Settings,
});

const settingsKey = "tender_admin_settings_v1";

type SettingsState = {
  name: string;
  email: string;
  notifications: Record<string, boolean>;
};

const notificationLabels = ["Новые тендеры", "Поступление заявок", "Регистрация компаний", "Системные оповещения"];

const defaultSettings: SettingsState = {
  name: "Администратор",
  email: "admin@tender.ru",
  notifications: Object.fromEntries(notificationLabels.map((label, i) => [label, i < 3])),
};

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : defaultSettings.name,
      email: typeof parsed.email === "string" ? parsed.email : defaultSettings.email,
      notifications: { ...defaultSettings.notifications, ...(parsed.notifications || {}) },
    };
  } catch {
    return defaultSettings;
  }
}

function Settings() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, [settings]);

  const save = () => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    pushNotification("success", "Настройки сохранены", "Параметры аккаунта и уведомлений обновлены.", "/settings");
  };

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
              <input
                value={settings.name}
                onChange={(e) => setSettings((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                value={settings.email}
                onChange={(e) => setSettings((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <button onClick={save} className="mt-5 rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
            Сохранить изменения
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h3 className="mb-5 font-semibold">Уведомления</h3>
          <div className="space-y-3">
            {notificationLabels.map((label) => (
              <label key={label} className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
                <span className="text-sm font-medium">{label}</span>
                <input
                  type="checkbox"
                  checked={settings.notifications[label] ?? false}
                  onChange={(e) => setSettings((prev) => ({
                    ...prev,
                    notifications: { ...prev.notifications, [label]: e.target.checked },
                  }))}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
