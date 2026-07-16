package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dauren/tender/internal/config"
	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/service"
	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type memorySessionStore struct {
	mu       sync.Mutex
	nextID   uint
	sessions map[string]domain.AuthSession
	users    map[uint]domain.User
	touches  int
	purges   int
}

func newMemorySessionStore(users ...domain.User) *memorySessionStore {
	store := &memorySessionStore{sessions: make(map[string]domain.AuthSession), users: make(map[uint]domain.User)}
	for _, user := range users {
		store.users[user.ID] = user
	}
	return store
}

func (s *memorySessionStore) Create(_ context.Context, session *domain.AuthSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	session.ID = s.nextID
	copy := *session
	s.sessions[session.TokenHash] = copy
	return nil
}

func (s *memorySessionStore) FindByTokenHash(_ context.Context, tokenHash string) (*domain.AuthSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[tokenHash]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	session.User = s.users[session.UserID]
	copy := session
	return &copy, nil
}

func (s *memorySessionStore) Touch(_ context.Context, id uint, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, session := range s.sessions {
		if session.ID == id {
			session.LastSeenAt = at
			s.sessions[key] = session
			s.touches++
			return nil
		}
	}
	return gorm.ErrRecordNotFound
}

func (s *memorySessionStore) Revoke(_ context.Context, id uint, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, session := range s.sessions {
		if session.ID == id {
			session.RevokedAt = &at
			s.sessions[key] = session
			return nil
		}
	}
	return nil
}

func (s *memorySessionStore) RevokeAllForUser(_ context.Context, userID uint, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, session := range s.sessions {
		if session.UserID == userID && session.RevokedAt == nil {
			revokedAt := at
			session.RevokedAt = &revokedAt
			s.sessions[key] = session
		}
	}
	return nil
}

func (s *memorySessionStore) PurgeExpired(_ context.Context, expiredBefore time.Time, revokedBefore time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, session := range s.sessions {
		if session.ExpiresAt.Before(expiredBefore) || (session.RevokedAt != nil && session.RevokedAt.Before(revokedBefore)) {
			delete(s.sessions, key)
		}
	}
	s.purges++
	return nil
}

func testAuth(t *testing.T, store SessionStore, mutate func(*config.AuthConfig)) *AuthManager {
	t.Helper()
	cfg := config.AuthConfig{
		CookieName:                  "tender_session",
		CSRFCookieName:              "tender_csrf",
		CookieSecure:                true,
		CookieSameSite:              "strict",
		SessionTTL:                  time.Hour,
		SessionTouchInterval:        time.Minute,
		AllowedHosts:                []string{"api.example.com"},
		AllowedOrigins:              []string{"https://app.example.com"},
		TrustedProxyCIDRs:           []string{"127.0.0.0/8", "172.16.0.0/12"},
		BackendInternalServiceToken: "0123456789abcdef0123456789abcdef",
		LoginAccountLimit:           5,
		LoginIPLimit:                60,
		LoginWindow:                 15 * time.Minute,
		RegisterLimit:               3,
		RegisterWindow:              time.Hour,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	auth, err := NewAuthManager(store, cfg)
	if err != nil {
		t.Fatalf("NewAuthManager: %v", err)
	}
	return auth
}

type sessionCookies struct {
	session *http.Cookie
	csrf    *http.Cookie
}

func issueSession(t *testing.T, auth *AuthManager, user domain.User) sessionCookies {
	t.Helper()
	token, csrf, expires, err := auth.NewSession(context.Background(), &user)
	if err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	recorder := httptest.NewRecorder()
	auth.SetSessionCookies(recorder, token, csrf, expires)
	var result sessionCookies
	for _, cookie := range recorder.Result().Cookies() {
		switch cookie.Name {
		case auth.cookieName:
			result.session = cookie
		case auth.csrfCookie:
			result.csrf = cookie
		}
	}
	if result.session == nil || result.csrf == nil {
		t.Fatal("expected session and CSRF cookies")
	}
	return result
}

func securedRequest(method, path string, cookies sessionCookies) *http.Request {
	request := httptest.NewRequest(method, "https://api.example.com"+path, nil)
	request.Host = "api.example.com"
	request.Header.Set("Origin", "https://app.example.com")
	if cookies.session != nil {
		request.AddCookie(cookies.session)
	}
	if cookies.csrf != nil {
		request.AddCookie(cookies.csrf)
		request.Header.Set(CSRFHeaderName, cookies.csrf.Value)
	}
	return request
}

func TestAuthMiddlewareRejectsUnauthenticatedRequest(t *testing.T) {
	auth := testAuth(t, newMemorySessionStore(), nil)
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard", nil)
	request.Host = "api.example.com"
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestRouteRoleAndInternalServicePolicies(t *testing.T) {
	users := []domain.User{
		{ID: 1, Email: "admin@example.com", Role: "admin", Status: "active"},
		{ID: 2, Email: "director@example.com", Role: "director", Status: "active"},
		{ID: 3, Email: "specialist@example.com", Role: "tender_specialist", Status: "active"},
	}
	store := newMemorySessionStore(users...)
	auth := testAuth(t, store, nil)
	cookies := map[string]sessionCookies{}
	for _, user := range users {
		cookies[user.Role] = issueSession(t, auth, user)
	}
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	tests := []struct {
		name, role, method, path string
		service                  bool
		want                     int
	}{
		{"admin mutation", "admin", http.MethodPost, "/api/v1/parser/run", false, http.StatusNoContent},
		{"specialist cannot administer", "tender_specialist", http.MethodPost, "/api/v1/parser/run", false, http.StatusForbidden},
		{"director can read", "director", http.MethodGet, "/api/v1/dashboard", false, http.StatusNoContent},
		{"director can manage workflow", "director", http.MethodPost, "/api/v1/lots/participate", false, http.StatusNoContent},
		{"specialist can mutate lots", "tender_specialist", http.MethodPost, "/api/v1/lots/participate", false, http.StatusNoContent},
		{"specialist can revoke own sessions", "tender_specialist", http.MethodPost, "/api/v1/auth/logout-all", false, http.StatusNoContent},
		{"admin can revoke user sessions", "admin", http.MethodPost, "/api/v1/users/3/sessions/revoke", false, http.StatusNoContent},
		{"director cannot revoke user sessions", "director", http.MethodPost, "/api/v1/users/3/sessions/revoke", false, http.StatusForbidden},
		{"admin can index RAG text directly", "admin", http.MethodPost, "/api/v1/rag/lots/lot-1/index", false, http.StatusNoContent},
		{"director cannot index RAG text directly", "director", http.MethodPost, "/api/v1/rag/lots/lot-1/index", false, http.StatusForbidden},
		{"specialist cannot upload directly to RAG", "tender_specialist", http.MethodPost, "/api/v1/rag/lots/lot-1/index-document", false, http.StatusForbidden},
		{"specialist can run canonical auto spec summary", "tender_specialist", http.MethodPost, "/api/v1/tenders/42/spec-summary/auto", false, http.StatusNoContent},
		{"director can manage registrations", "director", http.MethodPost, "/api/v1/registration-requests/1/reject", false, http.StatusNoContent},
		{"service can trigger parser", "", http.MethodPost, "/api/v1/parser/run", true, http.StatusNoContent},
		{"service can read dictionaries", "", http.MethodGet, "/api/v1/dictionaries", true, http.StatusNoContent},
		{"backend service token cannot use browser RAG index proxy", "", http.MethodPost, "/api/v1/rag/lots/lot-1/index", true, http.StatusForbidden},
		{"backend service token cannot revoke browser sessions", "", http.MethodPost, "/api/v1/auth/logout-all", true, http.StatusForbidden},
		{"service cannot read user APIs", "", http.MethodGet, "/api/v1/users", true, http.StatusForbidden},
		{"unknown route is fail closed", "admin", http.MethodGet, "/api/v1/future-secret", false, http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var request *http.Request
			if test.service {
				request = httptest.NewRequest(test.method, test.path, nil)
				request.Host = "api.example.com"
				request.Header.Set(InternalTokenHeader, "0123456789abcdef0123456789abcdef")
			} else {
				request = securedRequest(test.method, test.path, cookies[test.role])
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
}

func TestRAGServiceTokenCannotAuthenticateToBackend(t *testing.T) {
	auth := testAuth(t, newMemorySessionStore(), nil)
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/dictionaries", nil)
	request.Host = "api.example.com"
	request.Header.Set(InternalTokenHeader, strings.Repeat("r", 48))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("RAG token authenticated to backend: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestClientIPTrustsForwardingHeadersOnlyFromPrivateProxy(t *testing.T) {
	privateProxy := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	privateProxy.RemoteAddr = "172.18.0.4:43122"
	privateProxy.Header.Set("X-Forwarded-For", "198.51.100.99, 172.18.0.2")
	privateProxy.Header.Set("X-Real-IP", "198.51.100.25")
	auth := testAuth(t, newMemorySessionStore(), nil)
	if got := auth.ClientIP(privateProxy); got != "198.51.100.25" {
		t.Fatalf("private proxy client IP = %q", got)
	}

	publicPeer := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	publicPeer.RemoteAddr = "203.0.113.9:43122"
	publicPeer.Header.Set("X-Forwarded-For", "198.51.100.99")
	publicPeer.Header.Set("X-Real-IP", "198.51.100.98")
	if got := auth.ClientIP(publicPeer); got != "203.0.113.9" {
		t.Fatalf("public peer spoofed client IP: %q", got)
	}
}

func TestCSRFMustMatchSessionAndTrustedSource(t *testing.T) {
	user := domain.User{ID: 1, Email: "user@example.com", Role: "tender_specialist", Status: "active"}
	auth := testAuth(t, newMemorySessionStore(user), nil)
	cookies := issueSession(t, auth, user)
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	tests := []struct {
		name   string
		mutate func(*http.Request)
		want   int
	}{
		{"valid", nil, http.StatusNoContent},
		{"missing header", func(r *http.Request) { r.Header.Del(CSRFHeaderName) }, http.StatusForbidden},
		{"mismatched header", func(r *http.Request) { r.Header.Set(CSRFHeaderName, "wrong") }, http.StatusForbidden},
		{"untrusted origin", func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, http.StatusForbidden},
		{"missing origin", func(r *http.Request) { r.Header.Del("Origin") }, http.StatusForbidden},
		{"untrusted host", func(r *http.Request) { r.Host = "evil.example" }, http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := securedRequest(http.MethodPost, "/api/v1/lots/participate", cookies)
			if test.mutate != nil {
				test.mutate(request)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d", recorder.Code, test.want)
			}
		})
	}
}

func TestLogoutAllRouteRequiresCSRF(t *testing.T) {
	user := domain.User{ID: 1, Email: "user@example.com", Role: "tender_specialist", Status: "active"}
	auth := testAuth(t, newMemorySessionStore(user), nil)
	cookies := issueSession(t, auth, user)
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	request := securedRequest(http.MethodPost, "/api/v1/auth/logout-all", cookies)
	request.Header.Del(CSRFHeaderName)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestExpiredSessionIsRejectedAndRevoked(t *testing.T) {
	user := domain.User{ID: 1, Email: "user@example.com", Role: "director", Status: "active"}
	store := newMemorySessionStore(user)
	auth := testAuth(t, store, func(cfg *config.AuthConfig) { cfg.SessionTTL = time.Minute })
	base := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	auth.now = func() time.Time { return base }
	cookies := issueSession(t, auth, user)
	auth.now = func() time.Time { return base.Add(2 * time.Minute) }
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, securedRequest(http.MethodGet, "/api/v1/dashboard", cookies))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	stored, err := store.FindByTokenHash(context.Background(), hashToken(cookies.session.Value))
	if err != nil || stored.RevokedAt == nil {
		t.Fatal("expired session was not revoked")
	}
}

func TestSessionTouchAndTokenHashStorage(t *testing.T) {
	user := domain.User{ID: 1, Email: "user@example.com", Role: "director", Status: "active"}
	store := newMemorySessionStore(user)
	auth := testAuth(t, store, nil)
	base := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	auth.now = func() time.Time { return base }
	cookies := issueSession(t, auth, user)
	stored, err := store.FindByTokenHash(context.Background(), hashToken(cookies.session.Value))
	if err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == cookies.session.Value || len(stored.TokenHash) != 64 {
		t.Fatal("session store must contain only a fixed-size token hash")
	}
	auth.now = func() time.Time { return base.Add(2 * time.Minute) }
	if _, err := auth.Authenticate(securedRequest(http.MethodGet, "/api/v1/dashboard", cookies)); err != nil {
		t.Fatal(err)
	}
	if store.touches != 1 {
		t.Fatalf("touches = %d, want 1", store.touches)
	}
}

func TestLogoutAllRevokesOnlyCurrentUserSessionsAndClearsCookies(t *testing.T) {
	user := domain.User{ID: 1, Email: "user@example.com", Role: "director", Status: "active"}
	other := domain.User{ID: 2, Email: "other@example.com", Role: "director", Status: "active"}
	store := newMemorySessionStore(user, other)
	auth := testAuth(t, store, nil)
	first := issueSession(t, auth, user)
	second := issueSession(t, auth, user)
	otherSession := issueSession(t, auth, other)

	request := securedRequest(http.MethodPost, "/api/v1/auth/logout-all", first)
	request = request.WithContext(context.WithValue(request.Context(), authContextKey{}, &AuthPrincipal{User: &user}))
	recorder := httptest.NewRecorder()
	(&Handler{Auth: auth}).LogoutAll(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Body.String() != `{"success":true}` {
		t.Fatalf("unexpected response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	cleared := 0
	for _, cookie := range recorder.Result().Cookies() {
		if (cookie.Name == auth.cookieName || cookie.Name == auth.csrfCookie) && cookie.MaxAge == -1 {
			cleared++
		}
	}
	if cleared != 2 {
		t.Fatalf("cleared cookies = %d, want 2", cleared)
	}
	for _, revoked := range []sessionCookies{first, second} {
		if _, err := auth.Authenticate(securedRequest(http.MethodGet, "/api/v1/dashboard", revoked)); err == nil {
			t.Fatal("revoked user session remained valid")
		}
	}
	if _, err := auth.Authenticate(securedRequest(http.MethodGet, "/api/v1/dashboard", otherSession)); err != nil {
		t.Fatalf("another user's session was revoked: %v", err)
	}
}

func TestAdminSessionRevocationIsGenericAndUserScoped(t *testing.T) {
	admin := domain.User{ID: 1, Email: "admin@example.com", Role: "admin", Status: "active"}
	target := domain.User{ID: 2, Email: "target@example.com", Role: "director", Status: "active"}
	store := newMemorySessionStore(admin, target)
	auth := testAuth(t, store, nil)
	adminSession := issueSession(t, auth, admin)
	targetSession := issueSession(t, auth, target)
	handler := &Handler{Auth: auth}

	invoke := func(id string) *httptest.ResponseRecorder {
		request := securedRequest(http.MethodPost, "/api/v1/users/"+id+"/sessions/revoke", adminSession)
		routeContext := chi.NewRouteContext()
		routeContext.URLParams.Add("id", id)
		ctx := context.WithValue(request.Context(), chi.RouteCtxKey, routeContext)
		ctx = context.WithValue(ctx, authContextKey{}, &AuthPrincipal{User: &admin})
		request = request.WithContext(ctx)
		recorder := httptest.NewRecorder()
		handler.RevokeUserSessions(recorder, request)
		return recorder
	}

	existing := invoke("2")
	missing := invoke("99999")
	if existing.Code != http.StatusOK || missing.Code != http.StatusOK || existing.Body.String() != missing.Body.String() {
		t.Fatalf("session revocation leaked account state: existing=%d/%q missing=%d/%q", existing.Code, existing.Body.String(), missing.Code, missing.Body.String())
	}
	if _, err := auth.Authenticate(securedRequest(http.MethodGet, "/api/v1/dashboard", targetSession)); err == nil {
		t.Fatal("target user session remained valid")
	}
	if _, err := auth.Authenticate(securedRequest(http.MethodGet, "/api/v1/dashboard", adminSession)); err != nil {
		t.Fatalf("administrator session was revoked: %v", err)
	}
}

func TestExpiredSessionPurgeIsThrottled(t *testing.T) {
	user := domain.User{ID: 1, Role: "admin", Status: "active"}
	store := newMemorySessionStore(user)
	auth := testAuth(t, store, nil)
	base := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	auth.now = func() time.Time { return base }
	_ = issueSession(t, auth, user)
	_ = issueSession(t, auth, user)
	if store.purges != 1 {
		t.Fatalf("purges = %d, want 1 within an hour", store.purges)
	}
	auth.now = func() time.Time { return base.Add(61 * time.Minute) }
	_ = issueSession(t, auth, user)
	if store.purges != 2 {
		t.Fatalf("purges = %d, want 2 after an hour", store.purges)
	}
}

func TestCookieSecurityFlags(t *testing.T) {
	user := domain.User{ID: 1, Role: "admin", Status: "active"}
	auth := testAuth(t, newMemorySessionStore(user), nil)
	cookies := issueSession(t, auth, user)
	if !cookies.session.HttpOnly || !cookies.session.Secure || cookies.session.SameSite != http.SameSiteStrictMode || cookies.session.Path != "/" || cookies.session.MaxAge <= 0 {
		t.Fatalf("unexpected session cookie flags: %+v", cookies.session)
	}
	if cookies.csrf.HttpOnly || !cookies.csrf.Secure || cookies.csrf.SameSite != http.SameSiteStrictMode || cookies.csrf.Path != "/" || cookies.csrf.MaxAge <= 0 {
		t.Fatalf("unexpected CSRF cookie flags: %+v", cookies.csrf)
	}
}

func TestCookieSecurityFlagsAllowExplicitLocalHTTPMode(t *testing.T) {
	user := domain.User{ID: 1, Role: "admin", Status: "active"}
	auth := testAuth(t, newMemorySessionStore(user), func(cfg *config.AuthConfig) {
		cfg.CookieSecure = false
		cfg.CookieSameSite = "lax"
	})
	cookies := issueSession(t, auth, user)
	if cookies.session.Secure || cookies.session.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected local cookie flags: %+v", cookies.session)
	}
}

func TestRateLimitsLoginAndRegistration(t *testing.T) {
	auth := testAuth(t, newMemorySessionStore(), func(cfg *config.AuthConfig) {
		cfg.LoginAccountLimit = 2
		cfg.LoginIPLimit = 60
		cfg.RegisterLimit = 1
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	request.RemoteAddr = "203.0.113.8:5000"
	for attempt := 1; attempt <= 2; attempt++ {
		if ok, _ := auth.AllowLogin(request, "same@example.com"); !ok {
			t.Fatalf("login attempt %d was unexpectedly limited", attempt)
		}
	}
	if ok, wait := auth.AllowLogin(request, "same@example.com"); ok || wait <= 0 {
		t.Fatal("third login attempt should be rate limited with Retry-After")
	}
	if ok, _ := auth.AllowRegistration(request); !ok {
		t.Fatal("first registration attempt was unexpectedly limited")
	}
	if ok, wait := auth.AllowRegistration(request); ok || wait <= 0 {
		t.Fatal("second registration attempt should be limited")
	}
}

func TestLoginIPLimitCoversDistributedAccountAttempts(t *testing.T) {
	auth := testAuth(t, newMemorySessionStore(), func(cfg *config.AuthConfig) {
		cfg.LoginAccountLimit = 5
		cfg.LoginIPLimit = 3
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	request.RemoteAddr = "203.0.113.8:5000"
	for _, email := range []string{"one@example.com", "two@example.com", "three@example.com"} {
		if ok, _ := auth.AllowLogin(request, email); !ok {
			t.Fatalf("distributed attempt for %s was unexpectedly limited", email)
		}
	}
	if ok, wait := auth.AllowLogin(request, "four@example.com"); ok || wait <= 0 {
		t.Fatal("fourth distributed attempt should hit the IP limit")
	}
}

type fakeUserRepository struct {
	users               map[string]domain.User
	registrationCreated bool
}

func (r *fakeUserRepository) List(context.Context) ([]domain.User, error) { return nil, nil }
func (r *fakeUserRepository) Create(context.Context, *domain.User) error  { return nil }
func (r *fakeUserRepository) GetByEmail(_ context.Context, email string) (*domain.User, error) {
	user, ok := r.users[strings.ToLower(email)]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	copy := user
	return &copy, nil
}
func (r *fakeUserRepository) Delete(context.Context, uint) error                 { return nil }
func (r *fakeUserRepository) Update(context.Context, *domain.User) error         { return nil }
func (r *fakeUserRepository) DeleteUserAtomic(context.Context, uint, uint) error { return nil }
func (r *fakeUserRepository) UpdateUserRoleAtomic(_ context.Context, _ uint, id uint, role string) (*domain.User, error) {
	for key, user := range r.users {
		if user.ID == id {
			user.Role = role
			r.users[key] = user
			return &user, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}
func (r *fakeUserRepository) ListRegistrationRequests(context.Context, string) ([]domain.RegistrationRequest, error) {
	return nil, nil
}
func (r *fakeUserRepository) CreateRegistrationRequest(context.Context, *domain.RegistrationRequest) error {
	return nil
}
func (r *fakeUserRepository) CreateRegistrationRequestExclusive(context.Context, *domain.RegistrationRequest) (bool, error) {
	return r.registrationCreated, nil
}

func TestRegistrationDoesNotRevealExistingAccount(t *testing.T) {
	validBody := `{"email":"new@example.com","name":"New User","password":"StrongPassword!123"}`
	responses := make([]*httptest.ResponseRecorder, 0, 2)
	for _, created := range []bool{true, false} {
		repo := &fakeUserRepository{users: map[string]domain.User{}, registrationCreated: created}
		auth := testAuth(t, newMemorySessionStore(), nil)
		handler := &Handler{Users: service.NewUserService(repo), Auth: auth}
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register-request", strings.NewReader(validBody))
		recorder := httptest.NewRecorder()
		handler.CreateRegistrationRequest(recorder, request)
		responses = append(responses, recorder)
	}
	for _, response := range responses {
		if response.Code != http.StatusAccepted || response.Body.String() != `{"success":true}` {
			t.Fatalf("registration response leaks account state: status=%d body=%q", response.Code, response.Body.String())
		}
	}
}

func TestRegistrationRejectsWeakPasswordWithoutAccountDetails(t *testing.T) {
	repo := &fakeUserRepository{users: map[string]domain.User{}, registrationCreated: true}
	auth := testAuth(t, newMemorySessionStore(), nil)
	handler := &Handler{Users: service.NewUserService(repo), Auth: auth}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register-request", strings.NewReader(`{"email":"new@example.com","name":"New User","password":"weak"}`))
	recorder := httptest.NewRecorder()
	handler.CreateRegistrationRequest(recorder, request)
	if recorder.Code != http.StatusBadRequest || strings.Contains(strings.ToLower(recorder.Body.String()), "exists") {
		t.Fatalf("unexpected weak-password response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestAuthJSONRejectsTrailingAndOversizedBodies(t *testing.T) {
	repo := &fakeUserRepository{users: map[string]domain.User{}}
	auth := testAuth(t, newMemorySessionStore(), nil)
	handler := &Handler{Users: service.NewUserService(repo), Auth: auth}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@example.com","password":"password"} {}`))
	recorder := httptest.NewRecorder()
	handler.Login(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("trailing JSON status = %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@example.com","password":"`+strings.Repeat("x", 70*1024)+`"}`))
	recorder = httptest.NewRecorder()
	handler.Login(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized JSON status = %d", recorder.Code)
	}
}

func TestGlobalHostValidationAppliesToSafeMethods(t *testing.T) {
	user := domain.User{ID: 1, Email: "user@example.com", Role: "director", Status: "active"}
	auth := testAuth(t, newMemorySessionStore(user), nil)
	cookies := issueSession(t, auth, user)
	handler := authMiddleware(auth)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	request := securedRequest(http.MethodGet, "/api/v1/auth/me", cookies)
	request.Host = "evil.example"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("untrusted GET Host status = %d", recorder.Code)
	}
}
func (r *fakeUserRepository) GetRegistrationRequest(context.Context, uint) (*domain.RegistrationRequest, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepository) UpdateRegistrationRequest(context.Context, *domain.RegistrationRequest) error {
	return nil
}
func (r *fakeUserRepository) ApproveRegistrationRequestAtomic(context.Context, uint, uint, string) (*domain.User, error) {
	return nil, errors.New("not implemented")
}
func (r *fakeUserRepository) RejectRegistrationRequestAtomic(context.Context, uint, uint) error {
	return errors.New("not implemented")
}

func TestLoginUsesGenericErrorsAndSetsSession(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("CorrectPassword!123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user := domain.User{ID: 7, Email: "active@example.com", PasswordHash: string(hash), Role: "admin", Status: "active"}
	inactive := domain.User{ID: 8, Email: "inactive@example.com", PasswordHash: string(hash), Role: "admin", Status: "disabled"}
	repo := &fakeUserRepository{users: map[string]domain.User{user.Email: user, inactive.Email: inactive}}
	store := newMemorySessionStore(user, inactive)
	auth := testAuth(t, store, func(cfg *config.AuthConfig) { cfg.LoginAccountLimit = 20 })
	handler := &Handler{Users: service.NewUserService(repo), Auth: auth}

	for _, body := range []string{
		`{"email":"missing@example.com","password":"WrongPassword!123"}`,
		`{"email":"active@example.com","password":"WrongPassword!123"}`,
		`{"email":"inactive@example.com","password":"CorrectPassword!123"}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
		recorder := httptest.NewRecorder()
		handler.Login(recorder, request)
		if recorder.Code != http.StatusUnauthorized || recorder.Body.String() != "invalid credentials\n" {
			t.Fatalf("unexpected generic login failure: status=%d body=%q", recorder.Code, recorder.Body.String())
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"active@example.com","password":"CorrectPassword!123"}`))
	recorder := httptest.NewRecorder()
	handler.Login(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var response domain.User
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.ID != user.ID {
		t.Fatalf("unexpected login response: %+v, err=%v", response, err)
	}
	if len(recorder.Result().Cookies()) != 2 {
		t.Fatal("successful login must set session and CSRF cookies")
	}
}

func TestAdminAliasSharesLoginAccountRateLimit(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("CorrectPassword!123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	admin := domain.User{ID: 1, Email: "admin@tender.local", PasswordHash: string(hash), Role: "admin", Status: "active"}
	repo := &fakeUserRepository{users: map[string]domain.User{admin.Email: admin}}
	auth := testAuth(t, newMemorySessionStore(admin), func(cfg *config.AuthConfig) {
		cfg.LoginAccountLimit = 2
		cfg.LoginIPLimit = 60
	})
	handler := &Handler{Users: service.NewUserService(repo), Auth: auth}

	for attempt, login := range []string{"admin", "ADMIN@TENDER.LOCAL", "admin"} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"`+login+`","password":"WrongPassword!123"}`))
		recorder := httptest.NewRecorder()
		handler.Login(recorder, request)
		want := http.StatusUnauthorized
		if attempt == 2 {
			want = http.StatusTooManyRequests
		}
		if recorder.Code != want {
			t.Fatalf("attempt %d with %q: status=%d, want=%d", attempt+1, login, recorder.Code, want)
		}
	}
}

func TestParserRequestedByUsesOnlyAuthenticatedPrincipal(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/parser/run", nil)
	request.Header.Set("X-User-Email", "attacker@example.com")
	user := domain.User{ID: 42, Email: "real@example.com", Role: "admin", Status: "active"}
	request = request.WithContext(context.WithValue(request.Context(), authContextKey{}, &AuthPrincipal{User: &user}))
	if got := parserRequestedBy(request); got != user.Email {
		t.Fatalf("requestedBy = %q, want authenticated email %q", got, user.Email)
	}
	serviceRequest := httptest.NewRequest(http.MethodPost, "/api/v1/parser/run", nil)
	serviceRequest.Header.Set("X-User-Email", "attacker@example.com")
	serviceRequest = serviceRequest.WithContext(context.WithValue(serviceRequest.Context(), authContextKey{}, &AuthPrincipal{Service: true}))
	if got := parserRequestedBy(serviceRequest); got != "internal-service" {
		t.Fatalf("service requestedBy = %q", got)
	}
	unauthenticated := httptest.NewRequest(http.MethodPost, "/api/v1/parser/run", nil)
	unauthenticated.Header.Set("X-User-Email", "attacker@example.com")
	if got := parserRequestedBy(unauthenticated); got == "attacker@example.com" {
		t.Fatal("untrusted X-User-Email header was accepted")
	}
}

func TestSecurityHeaders(t *testing.T) {
	handler := securityHeadersMiddleware(true)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	for _, header := range []string{"Cache-Control", "Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options"} {
		if recorder.Header().Get(header) == "" {
			t.Fatalf("security header %s is missing", header)
		}
	}
}

func TestSecurityAuditNeverLogsCredentials(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	}()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", strings.NewReader(`{"password":"top-secret"}`))
	request.Header.Set(InternalTokenHeader, "top-secret-service-token")
	request.Header.Set(CSRFHeaderName, "top-secret-csrf")
	request.AddCookie(&http.Cookie{Name: "tender_session", Value: "top-secret-session"})
	securityAudit(request, "logout_succeeded", http.StatusOK, &AuthPrincipal{User: &domain.User{ID: 7, Email: "private@example.com", Role: "admin"}})
	logged := output.String()
	for _, secret := range []string{"top-secret", "private@example.com"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("audit log contains sensitive value %q: %s", secret, logged)
		}
	}
	if !strings.Contains(logged, `"user_id":7`) || !strings.Contains(logged, `"path":"/api/v1/auth/logout"`) {
		t.Fatalf("audit log is missing required identity/route fields: %s", logged)
	}
}
