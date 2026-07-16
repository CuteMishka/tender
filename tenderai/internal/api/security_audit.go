package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

// securityAudit writes a single-line structured event without credentials,
// cookie values, CSRF values, request bodies, or raw service tokens.
func securityAudit(r *http.Request, event string, status int, principal *AuthPrincipal) {
	record := map[string]interface{}{
		"time":       time.Now().UTC().Format(time.RFC3339Nano),
		"event":      event,
		"status":     status,
		"request_id": chimiddleware.GetReqID(r.Context()),
		"method":     r.Method,
		"path":       r.URL.Path,
		"remote_ip":  directClientIP(r),
	}
	if principal != nil {
		record["role"] = principal.Role()
		if principal.User != nil {
			record["user_id"] = principal.User.ID
		}
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return
	}
	log.Printf("security_audit %s", payload)
}
