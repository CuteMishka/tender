package api

import (
	"encoding/json"
	"net/http"

	"github.com/dauren/tender/internal/domain"
)

// GET /api/v1/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	if h.Users == nil {
		http.Error(w, "database not configured (DATABASE_URL)", http.StatusServiceUnavailable)
		return
	}
	users, err := h.Users.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []domain.User{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(users)
}
