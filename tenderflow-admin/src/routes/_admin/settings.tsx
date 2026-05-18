import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, Check, Clock, Loader2, Monitor, Moon, Palette, Play, RefreshCw, Send, Sun } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { pushNotification } from "@/hooks/use-notifications";
import { useTheme, THEMES } from "@/hooks/use-theme";
import { getCurrentUser } from "@/lib/auth";
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
  lastRequest?: {
    id: number;
    requestedAt: string;
    requestedBy: string;
    status: string;
    startedAt?: string;
    finishedAt?: string;
    message?: string;
  };
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

type TelegramSettings = {
  enabled: boolean;
  configured: boolean;
  chatId: string;
  username?: string;
  maskedToken?: string;
};

const notificationLabels = ["Новые тендеры", "Поступление заявок", "Регистрация компаний", "Системные оповещения"];
const appearanceOptions = [
  { key: "light", label: "Светлая", icon: Sun },
  { key: "dark", label: "Тёмная", icon: Moon },
  { key: "system", label: "Системная", icon: Monitor },
] as const;

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
  const [telegram, setTelegram] = useState<TelegramSettings>({ enabled: false, configured: false, chatId: "" });
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [parserRunning, setParserRunning] = useState(false);
  const [aiReanalyzing, setAiReanalyzing] = useState(false);
  const { theme, setTheme, appearance, setAppearance } = useTheme();
  const parserRequestActive = parserStatus?.lastRequest?.status === "pending" || parserStatus?.lastRequest?.status === "running";
  const currentUser = getCurrentUser();

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, [settings]);

  const loadParserStatus = async () => {
    const base = getLocalApiBase();
    try {
      const res = await fetch(`${base}/api/v1/parser/status`);
      const body = res.ok ? await res.json() : null;
      setParserStatus(body && !body.error ? body as ParserStatus : null);
    } catch {
      setParserStatus(null);
    }
  };

  useEffect(() => {
    loadParserStatus();
    const timer = window.setInterval(loadParserStatus, parserRequestActive ? 5_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [parserRequestActive]);

  useEffect(() => {
    if (!currentUser?.id) {
      setTelegramLoading(false);
      return;
    }
    const base = getLocalApiBase();
    fetch(`${base}/api/v1/users/${currentUser.id}/telegram`)
      .then((res) => res.ok ? res.json() : null)
      .then((body) => {
        if (!body) return;
        const data = body as TelegramSettings;
        setTelegram(data);
        setTelegramChatId(data.chatId || "");
        setTelegramUsername(data.username ? `@${data.username}` : "");
      })
      .catch(() => null)
      .finally(() => setTelegramLoading(false));
  }, [currentUser?.id]);

  const save = () => {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    pushNotification("success", "Настройки сохранены", "Параметры аккаунта и уведомлений обновлены.", "/settings");
  };

  const saveTelegram = async () => {
    setTelegramSaving(true);
    try {
      if (!currentUser?.id) throw new Error("Пользователь не найден. Войдите заново.");
      const base = getLocalApiBase();
      const res = await fetch(`${base}/api/v1/users/${currentUser.id}/telegram`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: telegram.enabled,
          chatId: telegramChatId.trim(),
          username: telegramUsername.trim(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Не удалось сохранить Telegram");
      const data = body as TelegramSettings;
      setTelegram(data);
      setTelegramChatId(data.chatId || "");
      setTelegramUsername(data.username ? `@${data.username}` : "");
      pushNotification("success", "Telegram сохранён", "Привязка Telegram обновлена.", "/settings");
    } catch (error) {
      pushNotification("error", "Ошибка Telegram", error instanceof Error ? error.message : "Не удалось сохранить настройки.", "/settings");
    } finally {
      setTelegramSaving(false);
    }
  };

  const testTelegram = async () => {
    setTelegramTesting(true);
    try {
      if (!currentUser?.id) throw new Error("Пользователь не найден. Войдите заново.");
      const base = getLocalApiBase();
      const res = await fetch(`${base}/api/v1/users/${currentUser.id}/telegram/test`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Не удалось отправить тест");
      pushNotification("success", "Тест отправлен", "Проверьте сообщение от Telegram-бота.", "/settings");
    } catch (error) {
      pushNotification("error", "Telegram недоступен", error instanceof Error ? error.message : "Проверьте @username/chat_id и что вы написали боту /start.", "/settings");
    } finally {
      setTelegramTesting(false);
    }
  };

  const runParserNow = async () => {
    setParserRunning(true);
    try {
      const base = getLocalApiBase();
      const res = await fetch(`${base}/api/v1/parser/run`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Не удалось запустить парсер");
      pushNotification("success", "Парсер запускается", "GitHub Actions workflow запущен. Статус обновится автоматически.", "/settings");
      await loadParserStatus();
    } catch (error) {
      pushNotification("error", "Парсер не запущен", error instanceof Error ? error.message : "Проверьте backend и базу данных.", "/settings");
    } finally {
      setParserRunning(false);
    }
  };

  const reanalyzeExistingTenders = async () => {
    setAiReanalyzing(true);
    try {
      const base = getLocalApiBase();
      const res = await fetch(`${base}/api/v1/parser/reanalyze-existing`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Не удалось запустить AI-переоценку");
      pushNotification("success", "AI-переоценка запускается", "GitHub Actions проверит существующие тендеры по смыслу и обновит таб «Подходящие».", "/settings");
      await loadParserStatus();
    } catch (error) {
      pushNotification("error", "AI-переоценка не запущена", error instanceof Error ? error.message : "Проверьте backend, GitHub Actions и GROQ_API_KEY.", "/settings");
    } finally {
      setAiReanalyzing(false);
    }
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
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {appearanceOptions.map((item) => {
              const Icon = item.icon;
              const active = appearance === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setAppearance(item.key)}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${active ? "border-primary bg-primary/5 text-primary" : "border-border bg-background hover:bg-accent"}`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </span>
                  {active && <Check className="h-4 w-4" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="relative p-6">
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-primary/10 via-muted/40 to-transparent" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold">Telegram-уведомления</h3>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Напишите боту @freedom_tender_bot команду /start и привяжите Telegram-аккаунт, чтобы получать сообщения о новых подходящих тендерах сразу после запуска парсера.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full px-2.5 py-1 font-medium ${telegram.configured ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>
                      {telegram.configured ? "Аккаунт привязан" : "Аккаунт не привязан"}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 font-medium ${telegram.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {telegram.enabled ? "Уведомления включены" : "Уведомления выключены"}
                    </span>
                    {telegram.username && <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">@{telegram.username}</span>}
                  </div>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium">
                <span>{telegram.enabled ? "Включено" : "Выключено"}</span>
                <input
                  type="checkbox"
                  checked={telegram.enabled}
                  onChange={(e) => setTelegram((prev) => ({ ...prev, enabled: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                  disabled={telegramLoading}
                />
              </label>
            </div>

            <div className="relative mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className="mb-1.5 block text-sm font-medium">@username</label>
                <input
                  value={telegramUsername}
                  onChange={(e) => setTelegramUsername(e.target.value)}
                  placeholder="@username"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Chat ID</label>
                <input
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="заполнится автоматически"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={saveTelegram}
                  disabled={telegramSaving || telegramLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  {telegramSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Сохранить
                </button>
                <button
                  onClick={testTelegram}
                  disabled={telegramTesting || !telegram.configured}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold hover:bg-accent disabled:opacity-60"
                >
                  {telegramTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Тест
                </button>
              </div>
            </div>
            <p className="relative mt-4 text-xs text-muted-foreground">
              Откройте @freedom_tender_bot, отправьте `/start`, укажите свой `@username` и нажмите «Сохранить». Система сама найдёт `chat_id`. Если Telegram не нашёл пользователя, можно вручную вставить `chat_id`.
            </p>
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={runParserNow}
                disabled={parserRunning || parserRequestActive}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                style={{ background: "var(--gradient-primary)" }}
              >
                {parserRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {parserRequestActive ? "Парсер запускается" : "Запустить сейчас"}
              </button>
              <button
                onClick={reanalyzeExistingTenders}
                disabled={aiReanalyzing || parserRequestActive}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold transition hover:bg-accent disabled:opacity-60"
                title="Запустить Groq AI-переоценку уже сохранённых тендеров"
              >
                {aiReanalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Проверить существующие AI
              </button>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${parserStatus?.configured ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                {parserStatus?.configured ? "Подключён" : "Нет данных"}
              </span>
            </div>
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
          <div className="mt-3 rounded-lg bg-muted/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground">Последний ручной запуск</p>
            <p className="mt-1 font-medium">
              {parserStatus?.lastRequest
                ? `${parserStatus.lastRequest.status} · ${formatDateTime(parserStatus.lastRequest.requestedAt)}`
                : "—"}
            </p>
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
