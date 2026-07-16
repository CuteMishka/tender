package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dauren/tender/internal/config"
	"github.com/dauren/tender/internal/domain"
	"gorm.io/gorm"
)

const (
	CSRFHeaderName       = "X-CSRF-Token"
	InternalTokenHeader  = "X-Internal-Service-Token"
	minimumServiceSecret = 32
)

var ErrUnauthenticated = errors.New("authentication required")

type SessionStore interface {
	Create(context.Context, *domain.AuthSession) error
	FindByTokenHash(context.Context, string) (*domain.AuthSession, error)
	Touch(context.Context, uint, time.Time) error
	Revoke(context.Context, uint, time.Time) error
	RevokeAllForUser(context.Context, uint, time.Time) error
	PurgeExpired(context.Context, time.Time, time.Time) error
}

type gormSessionStore struct{ db *gorm.DB }

func NewGormSessionStore(db *gorm.DB) SessionStore { return &gormSessionStore{db: db} }

func (s *gormSessionStore) Create(ctx context.Context, session *domain.AuthSession) error {
	return s.db.WithContext(ctx).Create(session).Error
}

func (s *gormSessionStore) FindByTokenHash(ctx context.Context, tokenHash string) (*domain.AuthSession, error) {
	var session domain.AuthSession
	err := s.db.WithContext(ctx).Preload("User").Where("token_hash = ?", tokenHash).First(&session).Error
	return &session, err
}

func (s *gormSessionStore) Touch(ctx context.Context, id uint, at time.Time) error {
	return s.db.WithContext(ctx).Model(&domain.AuthSession{}).Where("id = ? AND revoked_at IS NULL", id).Update("last_seen_at", at).Error
}

func (s *gormSessionStore) Revoke(ctx context.Context, id uint, at time.Time) error {
	return s.db.WithContext(ctx).Model(&domain.AuthSession{}).Where("id = ? AND revoked_at IS NULL", id).Update("revoked_at", at).Error
}

func (s *gormSessionStore) RevokeAllForUser(ctx context.Context, userID uint, at time.Time) error {
	return s.db.WithContext(ctx).
		Model(&domain.AuthSession{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", at).Error
}

func (s *gormSessionStore) PurgeExpired(ctx context.Context, expiredBefore time.Time, revokedBefore time.Time) error {
	return s.db.WithContext(ctx).
		Where("expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", expiredBefore, revokedBefore).
		Delete(&domain.AuthSession{}).Error
}

type AuthPrincipal struct {
	User    *domain.User
	Session *domain.AuthSession
	Service bool
}

func (p *AuthPrincipal) Role() string {
	if p == nil {
		return ""
	}
	if p.Service {
		return "service"
	}
	if p.User == nil {
		return ""
	}
	return strings.TrimSpace(p.User.Role)
}

type authContextKey struct{}

func PrincipalFromContext(ctx context.Context) *AuthPrincipal {
	principal, _ := ctx.Value(authContextKey{}).(*AuthPrincipal)
	return principal
}

type AuthManager struct {
	store               SessionStore
	cookieName          string
	csrfCookie          string
	cookieSecure        bool
	sameSite            http.SameSite
	ttl                 time.Duration
	touchInterval       time.Duration
	allowedHosts        []string
	allowedOrigin       map[string]bool
	trustedProxy        []*net.IPNet
	serviceHash         [sha256.Size]byte
	hasService          bool
	loginAccountLimiter *slidingWindowLimiter
	loginIPLimiter      *slidingWindowLimiter
	regLimiter          *slidingWindowLimiter
	now                 func() time.Time
	random              io.Reader
	purgeMu             sync.Mutex
	lastPurge           time.Time
}

func NewAuthManager(store SessionStore, cfg config.AuthConfig) (*AuthManager, error) {
	if store == nil {
		return nil, errors.New("session store is required")
	}
	if strings.TrimSpace(cfg.CookieName) == "" || strings.TrimSpace(cfg.CSRFCookieName) == "" {
		return nil, errors.New("authentication cookie names are required")
	}
	for _, name := range []string{cfg.CookieName, cfg.CSRFCookieName} {
		if err := (&http.Cookie{Name: name, Value: "value", Path: "/"}).Valid(); err != nil {
			return nil, errors.New("invalid authentication cookie name")
		}
	}
	if cfg.SessionTTL <= 0 || cfg.SessionTouchInterval <= 0 {
		return nil, errors.New("authentication session durations must be positive")
	}
	sameSite, err := parseSameSite(cfg.CookieSameSite)
	if err != nil {
		return nil, err
	}
	if sameSite == http.SameSiteNoneMode && !cfg.CookieSecure {
		return nil, errors.New("SameSite=None session cookies must be Secure")
	}
	a := &AuthManager{
		store:               store,
		cookieName:          cfg.CookieName,
		csrfCookie:          cfg.CSRFCookieName,
		cookieSecure:        cfg.CookieSecure,
		sameSite:            sameSite,
		ttl:                 cfg.SessionTTL,
		touchInterval:       cfg.SessionTouchInterval,
		allowedHosts:        normalizeHosts(cfg.AllowedHosts),
		allowedOrigin:       make(map[string]bool),
		loginAccountLimiter: newSlidingWindowLimiter(cfg.LoginAccountLimit, cfg.LoginWindow),
		loginIPLimiter:      newSlidingWindowLimiter(cfg.LoginIPLimit, cfg.LoginWindow),
		regLimiter:          newSlidingWindowLimiter(cfg.RegisterLimit, cfg.RegisterWindow),
		now:                 time.Now,
		random:              rand.Reader,
	}
	if len(a.allowedHosts) == 0 {
		return nil, errors.New("at least one AUTH_ALLOWED_HOSTS entry is required")
	}
	for _, origin := range cfg.AllowedOrigins {
		normalized, ok := normalizeOrigin(origin)
		if !ok {
			return nil, errors.New("AUTH_ALLOWED_ORIGINS contains an invalid origin")
		}
		a.allowedOrigin[normalized] = true
	}
	if len(a.allowedOrigin) == 0 {
		return nil, errors.New("at least one AUTH_ALLOWED_ORIGINS entry is required")
	}
	for _, rawCIDR := range cfg.TrustedProxyCIDRs {
		_, network, err := net.ParseCIDR(strings.TrimSpace(rawCIDR))
		if err != nil {
			return nil, errors.New("AUTH_TRUSTED_PROXY_CIDRS contains an invalid CIDR")
		}
		a.trustedProxy = append(a.trustedProxy, network)
	}
	serviceToken := strings.TrimSpace(cfg.BackendInternalServiceToken)
	if serviceToken != "" {
		if len(serviceToken) < minimumServiceSecret {
			return nil, errors.New("BACKEND_INTERNAL_SERVICE_TOKEN must contain at least 32 characters")
		}
		a.serviceHash = sha256.Sum256([]byte(serviceToken))
		a.hasService = true
	}
	return a, nil
}

func parseSameSite(raw string) (http.SameSite, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "strict":
		return http.SameSiteStrictMode, nil
	case "lax", "":
		return http.SameSiteLaxMode, nil
	case "none":
		return http.SameSiteNoneMode, nil
	default:
		return 0, errors.New("invalid cookie SameSite value")
	}
}

func (a *AuthManager) NewSession(ctx context.Context, user *domain.User) (string, string, time.Time, error) {
	if user == nil || user.ID == 0 {
		return "", "", time.Time{}, errors.New("valid user is required")
	}
	token, err := randomToken(a.random)
	if err != nil {
		return "", "", time.Time{}, err
	}
	csrfToken, err := randomToken(a.random)
	if err != nil {
		return "", "", time.Time{}, err
	}
	now := a.now().UTC()
	expires := now.Add(a.ttl)
	session := &domain.AuthSession{
		UserID:        user.ID,
		TokenHash:     hashToken(token),
		CSRFTokenHash: hashToken(csrfToken),
		ExpiresAt:     expires,
		LastSeenAt:    now,
	}
	if err := a.store.Create(ctx, session); err != nil {
		return "", "", time.Time{}, err
	}
	a.maybePurge(ctx, now)
	return token, csrfToken, expires, nil
}

func (a *AuthManager) maybePurge(ctx context.Context, now time.Time) {
	a.purgeMu.Lock()
	defer a.purgeMu.Unlock()
	if !a.lastPurge.IsZero() && now.Sub(a.lastPurge) < time.Hour {
		return
	}
	if err := a.store.PurgeExpired(ctx, now, now.Add(-24*time.Hour)); err == nil {
		a.lastPurge = now
	}
}

func randomToken(source io.Reader) (string, error) {
	buffer := make([]byte, 32)
	if _, err := io.ReadFull(source, buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (a *AuthManager) Authenticate(r *http.Request) (*AuthPrincipal, error) {
	if supplied := strings.TrimSpace(r.Header.Get(InternalTokenHeader)); supplied != "" {
		if !a.hasService {
			return nil, ErrUnauthenticated
		}
		suppliedHash := sha256.Sum256([]byte(supplied))
		if subtle.ConstantTimeCompare(suppliedHash[:], a.serviceHash[:]) != 1 {
			return nil, ErrUnauthenticated
		}
		return &AuthPrincipal{Service: true}, nil
	}
	cookie, err := r.Cookie(a.cookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return nil, ErrUnauthenticated
	}
	session, err := a.store.FindByTokenHash(r.Context(), hashToken(cookie.Value))
	if err != nil {
		return nil, ErrUnauthenticated
	}
	now := a.now().UTC()
	if session.RevokedAt != nil || !session.ExpiresAt.After(now) || session.User.ID == 0 || !strings.EqualFold(session.User.Status, "active") {
		if session.ID != 0 && session.RevokedAt == nil {
			_ = a.store.Revoke(r.Context(), session.ID, now)
		}
		return nil, ErrUnauthenticated
	}
	if now.Sub(session.LastSeenAt) >= a.touchInterval {
		if err := a.store.Touch(r.Context(), session.ID, now); err != nil {
			return nil, ErrUnauthenticated
		}
		session.LastSeenAt = now
	}
	return &AuthPrincipal{User: &session.User, Session: session}, nil
}

func (a *AuthManager) ValidateCSRF(r *http.Request, principal *AuthPrincipal) bool {
	if principal == nil || principal.Service || principal.Session == nil {
		return principal != nil && principal.Service
	}
	if !a.ValidateRequestSource(r) {
		return false
	}
	cookie, err := r.Cookie(a.csrfCookie)
	if err != nil || cookie.Value == "" {
		return false
	}
	header := strings.TrimSpace(r.Header.Get(CSRFHeaderName))
	if header == "" || len(header) != len(cookie.Value) || subtle.ConstantTimeCompare([]byte(header), []byte(cookie.Value)) != 1 {
		return false
	}
	expected, err := hex.DecodeString(principal.Session.CSRFTokenHash)
	if err != nil || len(expected) != sha256.Size {
		return false
	}
	actual := sha256.Sum256([]byte(header))
	return subtle.ConstantTimeCompare(actual[:], expected) == 1
}

func (a *AuthManager) ValidateRequestSource(r *http.Request) bool {
	if !a.ValidateHost(r) {
		return false
	}
	origin, ok := normalizeOrigin(r.Header.Get("Origin"))
	return ok && a.allowedOrigin[origin]
}

func (a *AuthManager) ValidateHost(r *http.Request) bool {
	return hostAllowed(r.Host, a.allowedHosts)
}

func (a *AuthManager) SetSessionCookies(w http.ResponseWriter, sessionToken, csrfToken string, expires time.Time) {
	maxAge := int(expires.Sub(a.now()).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{
		Name: a.cookieName, Value: sessionToken, Path: "/", Expires: expires,
		MaxAge: maxAge, HttpOnly: true, Secure: a.cookieSecure, SameSite: a.sameSite,
	})
	http.SetCookie(w, &http.Cookie{
		Name: a.csrfCookie, Value: csrfToken, Path: "/", Expires: expires,
		MaxAge: maxAge, HttpOnly: false, Secure: a.cookieSecure, SameSite: a.sameSite,
	})
}

func (a *AuthManager) ClearSessionCookies(w http.ResponseWriter) {
	past := time.Unix(1, 0).UTC()
	for _, cookie := range []http.Cookie{
		{Name: a.cookieName, HttpOnly: true},
		{Name: a.csrfCookie, HttpOnly: false},
	} {
		cookie.Value = ""
		cookie.Path = "/"
		cookie.Expires = past
		cookie.MaxAge = -1
		cookie.Secure = a.cookieSecure
		cookie.SameSite = a.sameSite
		http.SetCookie(w, &cookie)
	}
}

func (a *AuthManager) Revoke(ctx context.Context, principal *AuthPrincipal) error {
	if principal == nil || principal.Session == nil || principal.Session.ID == 0 {
		return nil
	}
	return a.store.Revoke(ctx, principal.Session.ID, a.now().UTC())
}

func (a *AuthManager) RevokeAllForUser(ctx context.Context, userID uint) error {
	if userID == 0 {
		return nil
	}
	return a.store.RevokeAllForUser(ctx, userID, a.now().UTC())
}

func (a *AuthManager) RevokeRequestSession(ctx context.Context, r *http.Request) {
	cookie, err := r.Cookie(a.cookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return
	}
	session, err := a.store.FindByTokenHash(ctx, hashToken(cookie.Value))
	if err == nil && session.ID != 0 && session.RevokedAt == nil {
		_ = a.store.Revoke(ctx, session.ID, a.now().UTC())
	}
}

func (a *AuthManager) AllowLogin(r *http.Request, email string) (bool, time.Duration) {
	now := a.now()
	ipOK, ipWait := a.loginIPLimiter.Allow(a.ClientIP(r), now)
	if !ipOK {
		return false, ipWait
	}
	accountKey := hashToken(strings.ToLower(strings.TrimSpace(email)))
	accountOK, accountWait := a.loginAccountLimiter.Allow(accountKey, now)
	if !accountOK {
		return false, accountWait
	}
	return true, 0
}

func (a *AuthManager) ResetLoginAccountRate(email string) {
	a.loginAccountLimiter.Reset(hashToken(strings.ToLower(strings.TrimSpace(email))))
}

func (a *AuthManager) AllowRegistration(r *http.Request) (bool, time.Duration) {
	return a.regLimiter.Allow("ip:"+a.ClientIP(r), a.now())
}

type clientIPContextKey struct{}

func directClientIP(r *http.Request) string {
	if value, ok := r.Context().Value(clientIPContextKey{}).(string); ok && value != "" {
		return value
	}
	return immediatePeerIP(r)
}

func immediatePeerIP(r *http.Request) string {
	peer := strings.TrimSpace(r.RemoteAddr)
	host, _, err := net.SplitHostPort(peer)
	if err == nil && host != "" {
		peer = host
	}
	peer = strings.Trim(strings.ToLower(peer), "[]")
	if peer == "" {
		return "unknown"
	}
	return peer
}

func (a *AuthManager) ClientIP(r *http.Request) string {
	peer := immediatePeerIP(r)
	peerIP := net.ParseIP(peer)
	trusted := false
	if peerIP != nil {
		for _, network := range a.trustedProxy {
			if network.Contains(peerIP) {
				trusted = true
				break
			}
		}
	}
	if trusted {
		candidate := strings.Trim(strings.TrimSpace(r.Header.Get("X-Real-IP")), "[]")
		if parsed := net.ParseIP(candidate); parsed != nil {
			return strings.ToLower(parsed.String())
		}
	}
	return peer
}

func normalizeOrigin(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	return scheme + "://" + strings.ToLower(parsed.Host), true
}

func normalizeHosts(hosts []string) []string {
	out := make([]string, 0, len(hosts))
	for _, host := range hosts {
		host = strings.ToLower(strings.TrimSpace(host))
		if parsedHost, _, err := net.SplitHostPort(host); err == nil {
			host = parsedHost
		}
		host = strings.Trim(host, "[]")
		if host != "" {
			out = append(out, host)
		}
	}
	return out
}

func hostAllowed(rawHost string, allowed []string) bool {
	host := strings.ToLower(strings.TrimSpace(rawHost))
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	host = strings.Trim(host, "[]")
	for _, candidate := range allowed {
		if strings.HasPrefix(candidate, ".") {
			if strings.HasSuffix(host, candidate) && len(host) > len(candidate) {
				return true
			}
			continue
		}
		if host == candidate {
			return true
		}
	}
	return false
}

type rateEntry struct {
	attempts []time.Time
	lastSeen time.Time
}

type slidingWindowLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	entries map[string]rateEntry
	calls   uint64
}

func newSlidingWindowLimiter(limit int, window time.Duration) *slidingWindowLimiter {
	if limit <= 0 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &slidingWindowLimiter{limit: limit, window: window, entries: make(map[string]rateEntry)}
}

func (l *slidingWindowLimiter) Allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls++
	if l.calls%256 == 0 || len(l.entries) >= 10000 {
		cutoff := now.Add(-l.window)
		for entryKey, candidate := range l.entries {
			if !candidate.lastSeen.After(cutoff) {
				delete(l.entries, entryKey)
			}
		}
		if len(l.entries) >= 10000 {
			for entryKey := range l.entries {
				delete(l.entries, entryKey)
				if len(l.entries) < 9000 {
					break
				}
			}
		}
	}
	entry := l.entries[key]
	cutoff := now.Add(-l.window)
	kept := entry.attempts[:0]
	for _, attempt := range entry.attempts {
		if attempt.After(cutoff) {
			kept = append(kept, attempt)
		}
	}
	if len(kept) >= l.limit {
		wait := kept[0].Add(l.window).Sub(now)
		entry.attempts = kept
		entry.lastSeen = now
		l.entries[key] = entry
		return false, wait
	}
	entry.attempts = append(kept, now)
	entry.lastSeen = now
	l.entries[key] = entry
	return true, 0
}

func (l *slidingWindowLimiter) Reset(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

func setRetryAfter(w http.ResponseWriter, wait time.Duration) {
	seconds := int(wait.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
}
