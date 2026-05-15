import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Clock, Palette } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { pushNotification } from "@/hooks/use-notifications";
import { useTheme, THEMES } from "@/hooks/use-theme";
import { getLocalApiBase } from "@/lib/tenders-api";

export const Route = createFileRoute("/_admin/settings")({
  component: Settings,
});

const settingsKey = "tender_admin_settings_v1";

type SettingsState = {
  name: string;
  email: string;
  notifications: Record<string, boolean>;
};

type ParserStatus = {
  configured: boolean;
  intervalSeconds: number;
  nextRunAt?: string;
  lastRun?: {
    id: number;
    startedAt: string;
    finishedAt?: string;
    status: string;
    platforms: string[];
    keywords: string[];
    lotsFound: number;
    lotsChanged: number;
    errors: Array<Record<string, unknown>>;
  };
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

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-KZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSince(value?: string) {
  if (!value) return "нет запусков";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет запусков";
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ч. ${rest} мин. назад`;
}

function formatInterval(seconds?: number) {
  if (!seconds) return "—";
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч. ${minutes % 60} мин.` : `${minutes} мин.`;
}

function Settings() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [parserStatus, setParserStatus] = useState<ParserStatus | null>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const base = getLocalApiBase();
    const loadStatus = () => {
      fetch(`${base}/api/v1/parser/status`)
        .then((res) => res.ok ? res.json() : null)
        .then((body) => setParserStatus(body && !body.error ? body as ParserStatus : null))
        .catch(() => setParserStatus(null));
    };
    loadStatus();
    const timer = window.setInterval(loadStatus, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const save = () => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    pushNotification("success", "Настройки сохранены", "Параметры аккаунта и уведомлений обновлены.", "/settings");
  };

  return (
    <>
      <PageHeader title="Настройки" description="Параметры площадки и аккаунта" />
      <div className="max-w-5xl space-y-6 p-8">
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
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold">Тема интерфейса</h3>
              <p className="text-sm text-muted-foreground">Выберите цветовую схему админ-панели</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {THEMES.map((item) => {
              const active = theme === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setTheme(item.key)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${active ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: item.color }}>
                    {active && <Check className="h-4 w-4 text-white" />}
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">Таймер парсера zakup.gov.kz</h3>
                <p className="text-sm text-muted-foreground">Последний запуск: {formatSince(parserStatus?.lastRun?.startedAt)}</p>
              </div>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${parserStatus?.configured ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
              {parserStatus?.configured ? "Подключён" : "Нет данных"}
            </span>
          </div>
          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Статус</p>
              <p className="mt-1 font-medium">{parserStatus?.lastRun?.status || "—"}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Старт</p>
              <p className="mt-1 font-medium">{formatDateTime(parserStatus?.lastRun?.startedAt)}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Следующий запуск</p>
              <p className="mt-1 font-medium">{formatDateTime(parserStatus?.nextRunAt)}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Интервал</p>
              <p className="mt-1 font-medium">{formatInterval(parserStatus?.intervalSeconds)}</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Найдено / изменено</p>
              <p className="mt-1 font-medium">{parserStatus?.lastRun ? `${parserStatus.lastRun.lotsFound} / ${parserStatus.lastRun.lotsChanged}` : "—"}</p>
            </div>
          </div>
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
