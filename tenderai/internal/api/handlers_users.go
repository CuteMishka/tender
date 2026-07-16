package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/repository"
	"github.com/dauren/tender/internal/service"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
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
	if h.Users == nil || h.Auth == nil {
		http.Error(w, "database not configured (DATABASE_URL)", http.StatusServiceUnavailable)
		return
	}
	var input loginRequest
	if !decodeAuthJSON(w, r, &input) {
		return
	}
	input.Email = service.CanonicalLoginEmail(input.Email)
	if allowed, wait := h.Auth.AllowLogin(r, input.Email); !allowed {
		setRetryAfter(w, wait)
		securityAudit(r, "login_rate_limited", http.StatusTooManyRequests, nil)
		http.Error(w, "too many attempts", http.StatusTooManyRequests)
		return
	}
	user, err := h.Users.Login(r.Context(), input.Email, input.Password)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			securityAudit(r, "login_failed", http.StatusUnauthorized, nil)
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		http.Error(w, "authentication unavailable", http.StatusInternalServerError)
		securityAudit(r, "login_failed", http.StatusInternalServerError, nil)
		return
	}
	h.Auth.ResetLoginAccountRate(input.Email)
	h.Auth.RevokeRequestSession(r.Context(), r)
	sessionToken, csrfToken, expires, err := h.Auth.NewSession(r.Context(), user)
	if err != nil {
		securityAudit(r, "login_failed", http.StatusInternalServerError, nil)
		http.Error(w, "authentication unavailable", http.StatusInternalServerError)
		return
	}
	h.Auth.SetSessionCookies(w, sessionToken, csrfToken, expires)
	securityAudit(r, "login_succeeded", http.StatusOK, &AuthPrincipal{User: user})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	principal := PrincipalFromContext(r.Context())
	if principal == nil || principal.User == nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(principal.User)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if h.Auth == nil {
		http.Error(w, "authentication service unavailable", http.StatusServiceUnavailable)
		return
	}
	err := h.Auth.Revoke(r.Context(), PrincipalFromContext(r.Context()))
	principal := PrincipalFromContext(r.Context())
	h.Auth.ClearSessionCookies(w)
	if err != nil {
		securityAudit(r, "logout_failed", http.StatusInternalServerError, principal)
		http.Error(w, "logout failed", http.StatusInternalServerError)
		return
	}
	securityAudit(r, "logout_succeeded", http.StatusOK, principal)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true}`))
}

func (h *Handler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	if h.Auth == nil {
		http.Error(w, "authentication service unavailable", http.StatusServiceUnavailable)
		return
	}
	principal := PrincipalFromContext(r.Context())
	if principal == nil || principal.User == nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	if err := h.Auth.RevokeAllForUser(r.Context(), principal.User.ID); err != nil {
		securityAudit(r, "logout_all_failed", http.StatusInternalServerError, principal)
		http.Error(w, "logout failed", http.StatusInternalServerError)
		return
	}
	h.Auth.ClearSessionCookies(w)
	securityAudit(r, "logout_all_succeeded", http.StatusOK, principal)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true}`))
}

func (h *Handler) CreateRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	if h.Users == nil || h.Auth == nil {
		http.Error(w, "database not configured (DATABASE_URL)", http.StatusServiceUnavailable)
		return
	}
	if allowed, wait := h.Auth.AllowRegistration(r); !allowed {
		setRetryAfter(w, wait)
		securityAudit(r, "registration_rate_limited", http.StatusTooManyRequests, nil)
		http.Error(w, "too many attempts", http.StatusTooManyRequests)
		return
	}
	var input registrationRequestInput
	if !decodeAuthJSON(w, r, &input) {
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
	err := h.Users.CreateRegistrationRequest(r.Context(), &req)
	if err != nil && !errors.Is(err, service.ErrAccountAlreadyExists) {
		if errors.Is(err, service.ErrInvalidRegistration) || errors.Is(err, service.ErrWeakPassword) {
			http.Error(w, "registration data or password policy requirements are not satisfied", http.StatusBadRequest)
			return
		}
		http.Error(w, "registration service unavailable", http.StatusInternalServerError)
		return
	}
	securityAudit(r, "registration_received", http.StatusAccepted, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(`{"success":true}`))
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	if h.Users == nil {
		http.Error(w, "database not configured (DATABASE_URL)", http.StatusServiceUnavailable)
		return
	}
	users, err := h.Users.List(r.Context())
	if err != nil {
		http.Error(w, "failed to list users", http.StatusInternalServerError)
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
	if principal := PrincipalFromContext(r.Context()); principal != nil && principal.User != nil && principal.User.ID == id {
		http.Error(w, "cannot delete your own account", http.StatusConflict)
		return
	}
	principal := PrincipalFromContext(r.Context())
	targetRole, err := h.userRoleByID(r, id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if targetRole == "admin" && !principalIsAdmin(principal) {
		http.Error(w, "only an administrator can change an administrator account", http.StatusForbidden)
		return
	}
	if err := h.Users.Delete(r.Context(), principalUserID(principal), id); err != nil {
		writeUserManagementError(w, err)
		return
	}
	securityAudit(r, "user_deleted", http.StatusOK, principal)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true}`))
}

func (h *Handler) UpdateUserRole(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	if principal := PrincipalFromContext(r.Context()); principal != nil && principal.User != nil && principal.User.ID == id {
		http.Error(w, "cannot change your own role", http.StatusConflict)
		return
	}
	var input updateUserRoleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	principal := PrincipalFromContext(r.Context())
	targetRole, err := h.userRoleByID(r, id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if (targetRole == "admin" || input.Role == "admin") && !principalIsAdmin(principal) {
		http.Error(w, "only an administrator can grant or change the administrator role", http.StatusForbidden)
		return
	}
	user, err := h.Users.UpdateRole(r.Context(), principalUserID(principal), id, input.Role)
	if err != nil {
		writeUserManagementError(w, err)
		return
	}
	securityAudit(r, "user_role_updated", http.StatusOK, principal)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

func (h *Handler) ListRegistrationRequests(w http.ResponseWriter, r *http.Request) {
	requests, err := h.Users.ListRegistrationRequests(r.Context(), r.URL.Query().Get("status"))
	if err != nil {
		http.Error(w, "failed to list registration requests", http.StatusInternalServerError)
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
	if input.Role == "admin" && !principalIsAdmin(PrincipalFromContext(r.Context())) {
		http.Error(w, "only an administrator can grant the administrator role", http.StatusForbidden)
		return
	}
	principal := PrincipalFromContext(r.Context())
	user, err := h.Users.ApproveRegistrationRequest(r.Context(), principalUserID(principal), id, input.Role)
	if err != nil {
		writeUserManagementError(w, err)
		return
	}
	securityAudit(r, "registration_approved", http.StatusOK, principal)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(user)
}

func principalIsAdmin(principal *AuthPrincipal) bool {
	return principal != nil && principal.User != nil && principal.Role() == "admin"
}

func principalUserID(principal *AuthPrincipal) uint {
	if principal == nil || principal.User == nil {
		return 0
	}
	return principal.User.ID
}

func writeUserManagementError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, repository.ErrLastActiveAdmin):
		http.Error(w, "at least one active administrator must remain", http.StatusConflict)
	case errors.Is(err, repository.ErrAdminMutationForbidden), errors.Is(err, repository.ErrUserManagementForbidden):
		http.Error(w, "forbidden", http.StatusForbidden)
	case errors.Is(err, repository.ErrSelfMutation):
		http.Error(w, "cannot change your own access", http.StatusConflict)
	case errors.Is(err, gorm.ErrRecordNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, repository.ErrRegistrationAlreadyProcessed):
		http.Error(w, "registration request is already processed", http.StatusConflict)
	default:
		http.Error(w, "user management operation failed", http.StatusInternalServerError)
	}
}

func (h *Handler) userRoleByID(r *http.Request, id uint) (string, error) {
	if h.Users == nil {
		return "", errors.New("user service unavailable")
	}
	users, err := h.Users.List(r.Context())
	if err != nil {
		return "", err
	}
	for _, user := range users {
		if user.ID == id {
			return user.Role, nil
		}
	}
	return "", errors.New("user not found")
}

func (h *Handler) RejectRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	principal := PrincipalFromContext(r.Context())
	if err := h.Users.RejectRegistrationRequest(r.Context(), principalUserID(principal), id); err != nil {
		writeUserManagementError(w, err)
		return
	}
	securityAudit(r, "registration_rejected", http.StatusOK, principal)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"success":true}`))
}

func (h *Handler) RevokeUserSessions(w http.ResponseWriter, r *http.Request) {
	if h.Auth == nil {
		http.Error(w, "authentication service unavailable", http.StatusServiceUnavailable)
		return
	}
	principal := PrincipalFromContext(r.Context())
	if !principalIsAdmin(principal) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	id, ok := parseUintParam(w, r, "id")
	if !ok {
		return
	}
	if err := h.Auth.RevokeAllForUser(r.Context(), id); err != nil {
		securityAudit(r, "user_sessions_revoke_failed", http.StatusInternalServerError, principal)
		http.Error(w, "session revocation failed", http.StatusInternalServerError)
		return
	}
	if principal.User.ID == id {
		h.Auth.ClearSessionCookies(w)
	}
	securityAudit(r, "user_sessions_revoked", http.StatusOK, principal)
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

func decodeAuthJSON(w http.ResponseWriter, r *http.Request, destination interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(w, "invalid request", http.StatusBadRequest)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return false
	}
	return true
}
