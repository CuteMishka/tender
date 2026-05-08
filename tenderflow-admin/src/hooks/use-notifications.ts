import { useCallback, useEffect, useState } from "react";

export type NotificationType = "success" | "warning" | "error" | "info";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  link?: string;
}

const STORAGE_KEY = "tender_notifications";
const MAX_NOTIFICATIONS = 50;

function loadFromStorage(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(items: AppNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    /* ignore */
  }
}

// Глобальный стор уведомлений — подписчики через window-event
const NOTIFY_EVENT = "tender_notify_update";

export function pushNotification(
  type: NotificationType,
  title: string,
  message: string,
  link?: string,
): void {
  const current = loadFromStorage();
  const item: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
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

  return { notifications, unreadCount, markAllRead, markRead, clearAll, remove };
}
