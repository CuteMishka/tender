const CSRF_COOKIE_NAME = "tender_csrf";

export type ApiFetchOptions = {
  redirectOnUnauthorized?: boolean;
};

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase());
}

function configuredApiOrigins(): Set<string> {
  const origins = new Set<string>();
  if (typeof window !== "undefined") origins.add(window.location.origin);

  const candidates = [
    typeof import.meta !== "undefined" ? import.meta.env?.VITE_LOCAL_API : undefined,
    typeof import.meta !== "undefined" ? import.meta.env?.VITE_BACK_API : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      origins.add(new URL(candidate, typeof window !== "undefined" ? window.location.href : undefined).origin);
    } catch {
      // Invalid build-time URL: ignore it and keep the same-origin default.
    }
  }
  return origins;
}

function isTrustedApiRequest(input: RequestInfo | URL): boolean {
  try {
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost";
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, base);
    return url.pathname.startsWith("/api/v1/") && configuredApiOrigins().has(url.origin);
  } catch {
    return false;
  }
}

export function readCSRFCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== CSRF_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return rawValue.join("=");
    }
  }
  return null;
}

function redirectToLogin(): void {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const target = `/login?reason=session-expired&next=${encodeURIComponent(next)}`;
  window.location.replace(target);
}

/**
 * Fetch wrapper for the protected Go API. It keeps the server session cookie
 * attached, adds the per-session CSRF token to mutations, and fails closed on
 * an expired session. Tokens are never copied to non-API or foreign origins.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const trusted = isTrustedApiRequest(input);
  const requestMethod = init.method || (input instanceof Request ? input.method : "GET");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  if (trusted) {
    if (isUnsafeMethod(requestMethod) && !headers.has("X-CSRF-Token")) {
      const csrf = readCSRFCookie();
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
  } else {
    // apiFetch may receive a pre-built Request. Never let caller-supplied
    // session material escape to an origin that is not an approved API.
    headers.delete("X-CSRF-Token");
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: trusted ? "include" : "omit",
  });

  if (
    trusted
    && response.status === 401
    && options.redirectOnUnauthorized !== false
    && typeof window !== "undefined"
  ) {
    window.dispatchEvent(new CustomEvent("tender:session-expired"));
    redirectToLogin();
  }
  return response;
}
