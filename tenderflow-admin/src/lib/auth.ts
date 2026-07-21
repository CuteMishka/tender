import { apiFetch } from "./api-client.ts";
import { getLocalApiBase } from "./tenders-api.ts";

export type UserRole = "admin" | "director" | "tender_specialist";

export type CurrentUser = {
  id: number;
  email: string;
  name?: string;
  role: UserRole;
  company?: string;
  position?: string;
  status?: string;
};

export type RegistrationRequestPayload = {
  email: string;
  name: string;
  company?: string;
  position?: string;
  comment?: string;
  password: string;
};

export const roleLabels: Record<UserRole, string> = {
  admin: "Админ",
  director: "Директор",
  tender_specialist: "Специалист по тендерам",
};

let currentUser: CurrentUser | null = null;
let sessionRequest: Promise<CurrentUser | null> | null = null;

function normalizeRole(role: unknown): UserRole {
  if (role === "admin" || role === "director" || role === "tender_specialist") return role;
  return "tender_specialist";
}

function rememberUser(user: CurrentUser): CurrentUser {
  const normalized = { ...user, role: normalizeRole(user.role) };
  if (typeof window === "undefined") return normalized;
  currentUser = normalized;
  try {
    localStorage.setItem("tender_viewer_name", normalized.name || normalized.email);
  } catch {
    // Viewer name is presentation-only; authentication stays server-side.
  }
  return normalized;
}

function forgetUser(): void {
  currentUser = null;
  sessionRequest = null;
  try {
    localStorage.removeItem("tender_admin_auth");
    localStorage.removeItem("tender_current_user");
  } catch {
    // Best-effort removal of legacy, forgeable auth state.
  }
}

export const getCurrentUser = (): CurrentUser | null =>
  typeof window === "undefined" ? null : currentUser;

/** Verifies the HttpOnly server session; browser storage is never trusted. */
export async function getSession(force = false): Promise<CurrentUser | null> {
  // Session identity is browser-scoped. Never cache a user in the shared SSR
  // module instance, where it could leak into another request.
  if (typeof window === "undefined") return null;
  if (!force && currentUser) return currentUser;
  if (!force && sessionRequest) return sessionRequest;

  const request = (async () => {
    const response = await apiFetch(
      `${getLocalApiBase()}/api/v1/auth/me`,
      { method: "GET" },
      { redirectOnUnauthorized: false },
    );
    if (response.status === 401) {
      forgetUser();
      return null;
    }
    if (!response.ok) {
      throw new Error("Не удалось проверить защищённую сессию");
    }
    return rememberUser((await response.json()) as CurrentUser);
  })();

  sessionRequest = request;
  try {
    return await request;
  } finally {
    if (sessionRequest === request) sessionRequest = null;
  }
}

export const canManageUsers = (user: CurrentUser | null = getCurrentUser()): boolean =>
  user?.role === "admin" || user?.role === "director";

export const canManagePlatformSettings = (user: CurrentUser | null = getCurrentUser()): boolean =>
  user?.role === "admin" || user?.role === "director" || user?.role === "tender_specialist";

/** Returns a same-origin in-app destination or the supplied safe fallback. */
export function safeNextPath(raw: string | null, origin: string, fallback = "/dashboard"): string {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return fallback;
  try {
    const target = new URL(raw, origin);
    if (target.origin !== origin || !target.pathname.startsWith("/")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export const login = async (email: string, password: string): Promise<CurrentUser> => {
  const response = await apiFetch(
    `${getLocalApiBase()}/api/v1/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    { redirectOnUnauthorized: false },
  );
  if (!response.ok) {
    if (response.status === 429) throw new Error("Слишком много попыток входа. Попробуйте позже.");
    throw new Error("Неверный email или пароль");
  }
  return rememberUser((await response.json()) as CurrentUser);
};

export const submitRegistrationRequest = async (payload: RegistrationRequestPayload): Promise<void> => {
  const response = await apiFetch(
    `${getLocalApiBase()}/api/v1/auth/register-request`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { redirectOnUnauthorized: false },
  );
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get("Retry-After") || "", 10);
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        const minutes = Math.max(1, Math.ceil(retryAfter / 60));
        throw new Error(`Слишком много заявок. Повторите примерно через ${minutes} мин.`);
      }
      throw new Error("Слишком много заявок. Попробуйте позже.");
    }
    if (response.status === 400) {
      throw new Error("Проверьте email и пароль: минимум 12 символов, заглавная и строчная буквы, цифра и спецсимвол.");
    }
    if (response.status === 403) {
      throw new Error("Откройте форму на https://qolab.kz и отправьте заявку ещё раз.");
    }
    throw new Error("Не удалось отправить заявку");
  }
};

export const logout = async (): Promise<void> => {
  const response = await apiFetch(
    `${getLocalApiBase()}/api/v1/auth/logout`,
    { method: "POST" },
    { redirectOnUnauthorized: false },
  );
  // A 401 means the server has already rejected/cleared the stale cookie.
  // Other failures must keep the local identity visible so a user on a
  // shared workstation is not misled into believing the session is closed.
  if (!response.ok && response.status !== 401) {
    throw new Error("Не удалось завершить серверную сессию");
  }
  forgetUser();
};
