package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/dauren/tender/internal/domain"
	"github.com/go-chi/chi/v5"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registrationRequestInput struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Company  string `json:"company"`
	Position string `json:"position"`
	Comment  string `json:"comment"`
	Password string `json:"password"`
}

type approveRegistrationInput struct {
	Role string `json:"role"`
}

type updateUserRoleInput struct {
	Role string `json:"role"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if h.Users == nil {
		http.Error(w, "database not configured (DATABASE_URL)", http.StatusServiceUnavailable)
		return
	}
	var input loginRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	user, err := h.Users.Login(r.Context(), input.Email, input.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

func (h *Handler) CreateRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	if h.Users == nil {
		http.Error(w, "database not configured (DATABASE_URL)", http.StatusServiceUnavailable)
		return
	}
	var input registrationRequestInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	req := domain.RegistrationRequest{
		Email:    input.Email,
		Name:     input.Name,
		Company:  input.Company,
		Position: input.Position,
		Comment:  input.Comment,
		Password: input.Password,
	}
	if err := h.Users.CreateRegistrationRequest(r.Context(), &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(req)
}

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

func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	if err := h.Users.Delete(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true}`))
}

func (h *Handler) UpdateUserRole(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	var input updateUserRoleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	user, err := h.Users.UpdateRole(r.Context(), id, input.Role)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

func (h *Handler) ListRegistrationRequests(w http.ResponseWriter, r *http.Request) {
	requests, err := h.Users.ListRegistrationRequests(r.Context(), r.URL.Query().Get("status"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if requests == nil {
		requests = []domain.RegistrationRequest{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(requests)
}

func (h *Handler) ApproveRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	var input approveRegistrationInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	user, err := h.Users.ApproveRegistrationRequest(r.Context(), id, input.Role)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

func (h *Handler) RejectRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	if err := h.Users.RejectRegistrationRequest(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true}`))
}

func parseUintParam(w http.ResponseWriter, r *http.Request, name string) (uint, bool) {
	raw := chi.URLParam(r, name)
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return 0, false
	}
	return uint(id), true
}
