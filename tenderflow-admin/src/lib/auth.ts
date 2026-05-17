import { getLocalApiBase } from "@/lib/tenders-api";

const AUTH_KEY = "tender_admin_auth";
const USER_KEY = "tender_current_user";

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

function normalizeRole(role: unknown): UserRole {
  if (role === "admin" || role === "director" || role === "tender_specialist") return role;
  return "tender_specialist";
}

function saveUser(user: CurrentUser): void {
  localStorage.setItem(AUTH_KEY, "true");
  localStorage.setItem(USER_KEY, JSON.stringify({ ...user, role: normalizeRole(user.role) }));
  localStorage.setItem("tender_viewer_name", user.name || user.email);
}

export const isAuthenticated = (): boolean => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTH_KEY) === "true" && localStorage.getItem(USER_KEY) !== null;
};

export const getCurrentUser = (): CurrentUser | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentUser;
    return { ...parsed, role: normalizeRole(parsed.role) };
  } catch {
    return null;
  }
};

export const canManageUsers = (user: CurrentUser | null = getCurrentUser()): boolean => {
  return user?.role === "admin" || user?.role === "director";
};

export const canManagePlatformSettings = (user: CurrentUser | null = getCurrentUser()): boolean => {
  return user?.role === "admin" || user?.role === "director" || user?.role === "tender_specialist";
};

export const login = async (email: string, password: string): Promise<CurrentUser> => {
  const res = await fetch(`${getLocalApiBase()}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Неверный логин или пароль");
  }
  const user = await res.json() as CurrentUser;
  const normalized = { ...user, role: normalizeRole(user.role) };
  saveUser(normalized);
  return normalized;
};

export const submitRegistrationRequest = async (payload: RegistrationRequestPayload): Promise<void> => {
  const res = await fetch(`${getLocalApiBase()}/api/v1/auth/register-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Не удалось отправить заявку");
  }
};

export const logout = (): void => {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
};
