package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dauren/tender/internal/authctx"
)

type routeAccess struct {
	public       bool
	roles        map[string]bool
	allowService bool
}

type routeRule struct {
	method  string
	pattern string
}

var allUserRoles = roleSet("admin", "director", "tender_specialist")
var adminRoles = roleSet("admin")
var managementRoles = roleSet("admin", "director")

var administratorRoutes = []routeRule{
	{http.MethodPost, "/api/v1/users/{id}/sessions/revoke"},
	{http.MethodPost, "/api/v1/dictionaries"},
	{http.MethodPut, "/api/v1/dictionaries/{id}"},
	{http.MethodDelete, "/api/v1/dictionaries/{id}"},
	{http.MethodPost, "/api/v1/parser/run"},
	{http.MethodPost, "/api/v1/parser/reanalyze-existing"},
	{http.MethodPost, "/api/v1/rag/lots/{lotId}/index"},
	{http.MethodPost, "/api/v1/rag/lots/{lotId}/index-document"},
	{http.MethodGet, "/api/v1/settings/telegram"},
	{http.MethodPut, "/api/v1/settings/telegram"},
	{http.MethodPost, "/api/v1/settings/telegram/test"},
	{http.MethodPost, "/api/v1/analytics/sync"},
}

var userManagementRoutes = []routeRule{
	{http.MethodPatch, "/api/v1/users/{id}/role"},
	{http.MethodDelete, "/api/v1/users/{id}"},
	{http.MethodGet, "/api/v1/registration-requests"},
	{http.MethodPost, "/api/v1/registration-requests/{id}/approve"},
	{http.MethodPost, "/api/v1/registration-requests/{id}/reject"},
}

var operationalRoutes = []routeRule{
	{http.MethodDelete, "/api/v1/tenders/{tenderId}/suitable"},
	{http.MethodPost, "/api/v1/lots/participate"},
	{http.MethodDelete, "/api/v1/lots/saved/{id}"},
	{http.MethodPost, "/api/v1/lots/{id}/comments"},
	{http.MethodPost, "/api/v1/lots/{id}/tasks"},
	{http.MethodPatch, "/api/v1/lots/{id}/tasks/{taskId}"},
	{http.MethodPut, "/api/v1/analytics/lots/{id}"},
	{http.MethodPost, "/api/v1/analytics/customers"},
	{http.MethodPut, "/api/v1/analytics/customers/{id}"},
	{http.MethodDelete, "/api/v1/analytics/customers/{id}"},
}

var authenticatedRoutes = []routeRule{
	{http.MethodGet, "/api/v1/auth/me"},
	{http.MethodPost, "/api/v1/auth/logout"},
	{http.MethodPost, "/api/v1/auth/logout-all"},
	{http.MethodGet, "/api/v1/tenders"},
	{http.MethodGet, "/api/v1/tenders/{tenderId}"},
	{http.MethodPost, "/api/v1/tenders/{tenderId}/spec-summary/auto"},
	{http.MethodPost, "/api/v1/tenders/{tenderId}/cloudy/chat"},
	{http.MethodGet, "/api/v1/notifications"},
	{http.MethodGet, "/api/v1/users"},
	{http.MethodGet, "/api/v1/users/{id}/telegram"},
	{http.MethodPut, "/api/v1/users/{id}/telegram"},
	{http.MethodPost, "/api/v1/users/{id}/telegram/test"},
	{http.MethodGet, "/api/v1/dictionaries"},
	{http.MethodGet, "/api/v1/dictionaries/{id}"},
	{http.MethodGet, "/api/v1/parser/status"},
	{http.MethodPost, "/api/v1/fetch-document"},
	{http.MethodGet, "/api/v1/dashboard"},
	{http.MethodGet, "/api/v1/dashboard/dynamics"},
	{http.MethodGet, "/api/v1/lots/saved"},
	{http.MethodGet, "/api/v1/lots/{id}/activity"},
	{http.MethodGet, "/api/v1/lots/{id}/comments"},
	{http.MethodGet, "/api/v1/lots/{id}/tasks"},
	{http.MethodGet, "/api/v1/analytics/lots"},
	{http.MethodGet, "/api/v1/analytics/stats"},
	{http.MethodGet, "/api/v1/analytics/dynamics"},
	{http.MethodGet, "/api/v1/analytics/filters"},
	{http.MethodGet, "/api/v1/analytics/export"},
	{http.MethodGet, "/api/v1/analytics/company-tenders"},
	{http.MethodPost, "/api/v1/analytics/reports/preview"},
	{http.MethodPost, "/api/v1/analytics/reports/docx"},
	{http.MethodGet, "/api/v1/analytics/customers/candidates"},
	{http.MethodGet, "/api/v1/analytics/customers"},
	{http.MethodGet, "/api/v1/analytics/customers/{id}/lots"},
	{http.MethodGet, "/api/v1/analytics/winners"},
	{http.MethodGet, "/api/v1/analytics/prices"},
	{http.MethodPost, "/api/v1/rag/lot/analyze"},
	{http.MethodGet, "/api/v1/rag/lots/{lotId}/spec-summary"},
}

var internalServiceRoutes = []routeRule{
	{http.MethodGet, "/api/v1/dictionaries"},
	{http.MethodPut, "/api/v1/dictionaries/{id}"},
	{http.MethodGet, "/api/v1/parser/status"},
	{http.MethodPost, "/api/v1/parser/run"},
	{http.MethodPost, "/api/v1/parser/reanalyze-existing"},
	{http.MethodPost, "/api/v1/analytics/sync"},
}

func roleSet(values ...string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[value] = true
	}
	return out
}

func authMiddleware(auth *AuthManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if auth != nil {
				r = r.WithContext(context.WithValue(r.Context(), clientIPContextKey{}, auth.ClientIP(r)))
				if !auth.ValidateHost(r) {
					securityAudit(r, "host_rejected", http.StatusBadRequest, nil)
					http.Error(w, "invalid request host", http.StatusBadRequest)
					return
				}
			}
			access := accessForRoute(r.Method, r.URL.Path)
			if access.public {
				if isPublicBrowserWrite(r.Method, r.URL.Path) {
					if auth == nil || !auth.ValidateRequestSource(r) {
						securityAudit(r, "public_origin_rejected", http.StatusForbidden, nil)
						http.Error(w, "invalid request origin", http.StatusForbidden)
						return
					}
				}
				next.ServeHTTP(w, r)
				return
			}
			if auth == nil {
				securityAudit(r, "authentication_unavailable", http.StatusServiceUnavailable, nil)
				http.Error(w, "authentication service unavailable", http.StatusServiceUnavailable)
				return
			}
			principal, err := auth.Authenticate(r)
			if err != nil {
				auth.ClearSessionCookies(w)
				securityAudit(r, "authentication_rejected", http.StatusUnauthorized, nil)
				http.Error(w, "authentication required", http.StatusUnauthorized)
				return
			}
			if principal.Service {
				if !access.allowService {
					securityAudit(r, "authorization_rejected", http.StatusForbidden, principal)
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
			} else if !access.roles[principal.Role()] {
				securityAudit(r, "authorization_rejected", http.StatusForbidden, principal)
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if isUnsafeMethod(r.Method) && !auth.ValidateCSRF(r, principal) {
				securityAudit(r, "csrf_rejected", http.StatusForbidden, principal)
				http.Error(w, "CSRF validation failed", http.StatusForbidden)
				return
			}
			ctx := context.WithValue(r.Context(), authContextKey{}, principal)
			identity := authctx.Identity{Role: principal.Role(), Service: principal.Service}
			if principal.User != nil {
				identity.UserID = principal.User.ID
				identity.Name = strings.TrimSpace(principal.User.Name)
				if identity.Name == "" {
					identity.Name = fmt.Sprintf("user:%d", principal.User.ID)
				}
			}
			ctx = authctx.WithIdentity(ctx, identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func accessForRoute(method, path string) routeAccess {
	if method == http.MethodOptions || (method == http.MethodGet && path == "/health") ||
		(method == http.MethodPost && (path == "/api/v1/auth/login" || path == "/api/v1/auth/register-request")) {
		return routeAccess{public: true}
	}

	serviceAllowed := matchesAny(internalServiceRoutes, method, path)
	if matchesAny(administratorRoutes, method, path) {
		return routeAccess{roles: adminRoles, allowService: serviceAllowed}
	}
	if matchesAny(userManagementRoutes, method, path) {
		return routeAccess{roles: managementRoles}
	}
	if matchesAny(operationalRoutes, method, path) {
		return routeAccess{roles: allUserRoles}
	}
	if matchesAny(authenticatedRoutes, method, path) {
		return routeAccess{roles: allUserRoles, allowService: serviceAllowed}
	}
	// New routes are denied until they receive an explicit policy above.
	return routeAccess{roles: map[string]bool{}}
}

func matchesAny(rules []routeRule, method, path string) bool {
	for _, rule := range rules {
		if rule.method == method && pathMatches(rule.pattern, path) {
			return true
		}
	}
	return false
}

func pathMatches(pattern, path string) bool {
	patternParts := strings.Split(strings.Trim(pattern, "/"), "/")
	pathParts := strings.Split(strings.Trim(path, "/"), "/")
	if len(patternParts) != len(pathParts) {
		return false
	}
	for index := range patternParts {
		part := patternParts[index]
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			if pathParts[index] == "" {
				return false
			}
			continue
		}
		if part != pathParts[index] {
			return false
		}
	}
	return true
}

func isUnsafeMethod(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

func isPublicBrowserWrite(method, path string) bool {
	return method == http.MethodPost && (path == "/api/v1/auth/login" || path == "/api/v1/auth/register-request")
}

func securityHeadersMiddleware(secureCookies bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
			w.Header().Set("Cross-Origin-Resource-Policy", "same-site")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			if secureCookies || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") || r.TLS != nil {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}
