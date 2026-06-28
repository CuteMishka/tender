import { useCallback, useEffect, useState } from "react";
import { getLocalApiBase } from "@/lib/tenders-api";

export type NotificationType = "success" | "warning" | "error" | "info";
export type NotificationCategory = "deadline" | "appeal" | "updates" | "mentions" | "review";

export interface AppNotification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  link?: string;
}

const STORAGE_KEY = "tender_notifications";
const SERVER_SEEN_KEY = "tender_server_notifications_seen_id";
const MAX_NOTIFICATIONS = 200;

function loadFromStorage(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((n) => ({ category: "updates" as NotificationCategory, ...n }))
      : [];
  } catch {
    return [];
  }
}

function saveToStorage(items: AppNotification[]): void {
  try {
    const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    /* ignore */
  }
}

// Глобальный стор уведомлений — подписчики через window-event
const NOTIFY_EVENT = "tender_notify_update";

type ServerNotification = {
  id: number;
  type: string;
  category: string;
  title: string;
  message: string;
  createdAt: string;
  link?: string;
};

type ServerNotificationsResponse = {
  items?: ServerNotification[];
  meta?: { maxId?: number };
};

export function pushNotification(
  type: NotificationType,
  title: string,
  message: string,
  link?: string,
  category: NotificationCategory = "updates",
): void {
  const current = loadFromStorage();
  const item: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    category,
    title,
    message,
    timestamp: Date.now(),
    read: false,
    link,
  };
  const updated = [item, ...current].slice(0, MAX_NOTIFICATIONS);
  saveToStorage(updated);
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT));
}

function normalizeNotificationType(value: string): NotificationType {
  return value === "success" || value === "warning" || value === "error" || value === "info" ? value : "info";
}

function normalizeNotificationCategory(value: string): NotificationCategory {
  return value === "deadline" || value === "appeal" || value === "updates" || value === "mentions" || value === "review"
    ? value
    : "updates";
}

function readLastServerId(): number {
  try {
    const parsed = Number(localStorage.getItem(SERVER_SEEN_KEY) || "0");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeLastServerId(value: number): void {
  if (!Number.isFinite(value) || value <= 0) return;
  try {
    localStorage.setItem(SERVER_SEEN_KEY, String(Math.floor(value)));
  } catch {
    /* ignore */
  }
}

function mergeServerNotifications(items: ServerNotification[], silent: boolean): void {
  if (items.length === 0) return;
  const current = loadFromStorage();
  const existingIds = new Set(current.map((item) => item.id));
  const additions: AppNotification[] = [];

  for (const item of items) {
    if (!Number.isFinite(item.id) || item.id <= 0) continue;
    const id = `server:${item.id}`;
    if (existingIds.has(id)) continue;
    const timestamp = Date.parse(item.createdAt);
    additions.push({
      id,
      type: normalizeNotificationType(item.type),
      category: normalizeNotificationCategory(item.category),
      title: item.title || "Уведомление",
      message: item.message || "",
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      read: silent,
      link: item.link && item.link.startsWith("/") ? item.link : undefined,
    });
  }

  if (additions.length === 0) return;
  saveToStorage([...additions, ...current]);
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT));
}

async function syncServerNotifications(silent: boolean): Promise<void> {
  const lastId = readLastServerId();
  const params = new URLSearchParams({ limit: "50" });
  if (lastId > 0) params.set("after", String(lastId));
  const res = await fetch(`${getLocalApiBase()}/api/v1/notifications?${params.toString()}`);
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as ServerNotificationsResponse | null;
  const items = Array.isArray(body?.items) ? body.items : [];
  mergeServerNotifications(items, silent);
  const maxFromItems = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), lastId);
  const maxFromMeta = Number(body?.meta?.maxId) || 0;
  writeLastServerId(Math.max(lastId, maxFromItems, maxFromMeta));
}

export function useServerNotificationsSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let firstSync = readLastServerId() === 0;

    async function run() {
      try {
        await syncServerNotifications(firstSync);
        firstSync = false;
      } catch {
        /* next poll will retry */
      }
    }

    run();
    const timer = window.setInterval(() => {
      if (!cancelled) run();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadFromStorage);

  const refresh = useCallback(() => {
    setNotifications(loadFromStorage());
  }, []);

  useEffect(() => {
    window.addEventListener(NOTIFY_EVENT, refresh);
    return () => window.removeEventListener(NOTIFY_EVENT, refresh);
  }, [refresh]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    const updated = loadFromStorage().map((n) => ({ ...n, read: true }));
    saveToStorage(updated);
    setNotifications(updated);
  }, []);

  const markCategoryRead = useCallback((category: NotificationCategory) => {
    const updated = loadFromStorage().map((n) => (n.category === category ? { ...n, read: true } : n));
    saveToStorage(updated);
    setNotifications(updated);
  }, []);

  const markRead = useCallback((id: string) => {
    const updated = loadFromStorage().map((n) => (n.id === id ? { ...n, read: true } : n));
    saveToStorage(updated);
    setNotifications(updated);
  }, []);

  const clearAll = useCallback(() => {
    saveToStorage([]);
    setNotifications([]);
  }, []);

  const remove = useCallback((id: string) => {
    const updated = loadFromStorage().filter((n) => n.id !== id);
    saveToStorage(updated);
    setNotifications(updated);
  }, []);

  return { notifications, unreadCount, markAllRead, markCategoryRead, markRead, clearAll, remove };
}
