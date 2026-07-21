package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                    string
	TenderPlusURL           string
	TenderPlusToken         string
	TendersKeywords         string
	CORSAllowedOrigins      []string
	DatabaseURL             string
	RagAPIBase              string
	RAGInternalServiceToken string
	FetchDocument           FetchDocumentConfig
	Auth                    AuthConfig
}

type AuthConfig struct {
	CookieName                  string
	CSRFCookieName              string
	CookieSecure                bool
	CookieSameSite              string
	SessionTTL                  time.Duration
	SessionTouchInterval        time.Duration
	AllowedHosts                []string
	AllowedOrigins              []string
	TrustedProxyCIDRs           []string
	BackendInternalServiceToken string
	LoginAccountLimit           int
	LoginIPLimit                int
	LoginWindow                 time.Duration
	RegisterLimit               int
	RegisterWindow              time.Duration
}

// FetchDocumentConfig — ограниченный прокси скачивания вложений (обход CORS у площадки).
type FetchDocumentConfig struct {
	AllowedHosts []string
	MaxBytes     int64
	Timeout      time.Duration
	PathPrefix   string
}

func FromEnv() (Config, error) {
	if strings.TrimSpace(os.Getenv("INTERNAL_SERVICE_TOKEN")) != "" {
		return Config{}, fmt.Errorf("INTERNAL_SERVICE_TOKEN is no longer supported; configure distinct BACKEND_INTERNAL_SERVICE_TOKEN and RAG_INTERNAL_SERVICE_TOKEN values")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}
	tpTok := strings.TrimSpace(os.Getenv("TENDERPLUS_TOKEN"))
	tpTok = strings.TrimPrefix(tpTok, "\ufeff")
	c := Config{
		Addr:                    ":" + port,
		TenderPlusURL:           getEnv("TENDERPLUS_URL", "https://api.tenderplus.kz/graphql"),
		TenderPlusToken:         tpTok,
		TendersKeywords:         strings.TrimSpace(os.Getenv("TENDERS_KEYWORDS")),
		CORSAllowedOrigins:      mergeCORSOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")),
		DatabaseURL:             strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RagAPIBase:              strings.TrimRight(getEnv("RAG_API_BASE", "http://127.0.0.1:8083"), "/"),
		RAGInternalServiceToken: strings.TrimSpace(os.Getenv("RAG_INTERNAL_SERVICE_TOKEN")),
		FetchDocument:           fetchDocumentFromEnv(),
	}
	var err error
	c.Auth, err = authFromEnv(c.CORSAllowedOrigins)
	if err != nil {
		return c, err
	}
	if err := validateInternalServiceToken("BACKEND_INTERNAL_SERVICE_TOKEN", c.Auth.BackendInternalServiceToken); err != nil {
		return c, err
	}
	if err := validateInternalServiceToken("RAG_INTERNAL_SERVICE_TOKEN", c.RAGInternalServiceToken); err != nil {
		return c, err
	}
	if c.Auth.BackendInternalServiceToken != "" && c.Auth.BackendInternalServiceToken == c.RAGInternalServiceToken {
		return c, fmt.Errorf("BACKEND_INTERNAL_SERVICE_TOKEN and RAG_INTERNAL_SERVICE_TOKEN must be distinct")
	}
	if _, err := strconv.Atoi(port); err != nil {
		return c, fmt.Errorf("PORT must be a number: %s", port)
	}
	return c, nil
}

func authFromEnv(corsOrigins []string) (AuthConfig, error) {
	secure, err := parseBoolEnv("AUTH_COOKIE_SECURE", true)
	if err != nil {
		return AuthConfig{}, err
	}
	ttl, err := positiveDurationEnv("AUTH_SESSION_TTL", 12*time.Hour)
	if err != nil {
		return AuthConfig{}, err
	}
	touch, err := positiveDurationEnv("AUTH_SESSION_TOUCH_INTERVAL", 5*time.Minute)
	if err != nil {
		return AuthConfig{}, err
	}
	loginWindow, err := positiveDurationEnv("AUTH_LOGIN_RATE_WINDOW", 15*time.Minute)
	if err != nil {
		return AuthConfig{}, err
	}
	registerWindow, err := positiveDurationEnv("AUTH_REGISTER_RATE_WINDOW", time.Hour)
	if err != nil {
		return AuthConfig{}, err
	}
	loginAccountLimit, err := positiveIntEnv("AUTH_LOGIN_ACCOUNT_RATE_LIMIT", 5)
	if err != nil {
		return AuthConfig{}, err
	}
	loginIPLimit, err := positiveIntEnv("AUTH_LOGIN_IP_RATE_LIMIT", 60)
	if err != nil {
		return AuthConfig{}, err
	}
	registerLimit, err := positiveIntEnv("AUTH_REGISTER_RATE_LIMIT", 10)
	if err != nil {
		return AuthConfig{}, err
	}
	sameSite := strings.ToLower(strings.TrimSpace(getEnv("AUTH_COOKIE_SAMESITE", "strict")))
	if sameSite != "strict" && sameSite != "lax" && sameSite != "none" {
		return AuthConfig{}, fmt.Errorf("AUTH_COOKIE_SAMESITE must be strict, lax, or none")
	}
	if sameSite == "none" && !secure {
		return AuthConfig{}, fmt.Errorf("AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true")
	}
	hosts := splitCSV(os.Getenv("AUTH_ALLOWED_HOSTS"))
	if len(hosts) == 0 {
		hosts = []string{"localhost", "127.0.0.1", "[::1]"}
	}
	origins := splitCSV(os.Getenv("AUTH_ALLOWED_ORIGINS"))
	if len(origins) == 0 {
		origins = append([]string(nil), corsOrigins...)
	}
	return AuthConfig{
		CookieName:                  strings.TrimSpace(getEnv("AUTH_COOKIE_NAME", "tender_session")),
		CSRFCookieName:              strings.TrimSpace(getEnv("AUTH_CSRF_COOKIE_NAME", "tender_csrf")),
		CookieSecure:                secure,
		CookieSameSite:              sameSite,
		SessionTTL:                  ttl,
		SessionTouchInterval:        touch,
		AllowedHosts:                hosts,
		AllowedOrigins:              origins,
		TrustedProxyCIDRs:           splitCSV(getEnv("AUTH_TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")),
		BackendInternalServiceToken: strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_SERVICE_TOKEN")),
		LoginAccountLimit:           loginAccountLimit,
		LoginIPLimit:                loginIPLimit,
		LoginWindow:                 loginWindow,
		RegisterLimit:               registerLimit,
		RegisterWindow:              registerWindow,
	}, nil
}

func validateInternalServiceToken(name, value string) error {
	if value != "" && len(value) < 32 {
		return fmt.Errorf("%s must contain at least 32 characters", name)
	}
	return nil
}

func parseBoolEnv(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return value, nil
}

func positiveDurationEnv(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration", key)
	}
	return value, nil
}

func positiveIntEnv(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return value, nil
}

func splitCSV(raw string) []string {
	out := make([]string, 0)
	seen := make(map[string]bool)
	for _, part := range strings.Split(raw, ",") {
		value := strings.TrimSpace(part)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

// HasTenderPlus true, если настроен вызов внешнего API.
func (c Config) HasTenderPlus() bool { return c.TenderPlusToken != "" }

// HasDatabase true, если задана строка подключения для GORM.
func (c Config) HasDatabase() bool { return c.DatabaseURL != "" }

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func defaultCORSOrigins() []string {
	return []string{
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"http://localhost:8081",
		"http://127.0.0.1:8081",
		"http://localhost:8082",
		"http://127.0.0.1:8082",
	}
}

// mergeCORSOrigins uses local development origins only when no explicit list is
// configured. Production allowlists must not silently retain localhost origins.
func mergeCORSOrigins(extra string) []string {
	out := make([]string, 0)
	for _, p := range strings.Split(extra, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return defaultCORSOrigins()
	}
	return out
}

func fetchDocumentFromEnv() FetchDocumentConfig {
	var hosts []string
	for _, p := range strings.Split(os.Getenv("FETCH_DOCUMENT_ALLOWED_HOSTS"), ",") {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			hosts = append(hosts, p)
		}
	}
	if len(hosts) == 0 {
		hosts = []string{"v3bl.goszakup.gov.kz", "goszakup.gov.kz", "zakup.gov.kz", "ows.goszakup.gov.kz", "api.tenderplus.kz", ".tenderplus.kz", "eep.mitwork.kz", "zakup.sk.kz", ".zakup.sk.kz"}
	}
	maxB := int64(50 * 1024 * 1024)
	if v := strings.TrimSpace(os.Getenv("FETCH_DOCUMENT_MAX_BYTES")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			maxB = n
		}
	}
	timeout := 60 * time.Second
	if v := strings.TrimSpace(os.Getenv("FETCH_DOCUMENT_TIMEOUT_SEC")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			timeout = time.Duration(n) * time.Second
		}
	}
	pathPrefix := strings.TrimSpace(os.Getenv("FETCH_DOCUMENT_PATH_PREFIX"))
	return FetchDocumentConfig{
		AllowedHosts: hosts,
		MaxBytes:     maxB,
		Timeout:      timeout,
		PathPrefix:   pathPrefix,
	}
}
