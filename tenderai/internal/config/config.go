package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr               string
	TenderPlusURL      string
	TenderPlusToken    string
	TendersKeywords    string
	CORSAllowedOrigins []string
	DatabaseURL        string
	FetchDocument      FetchDocumentConfig
}

// FetchDocumentConfig — ограниченный прокси скачивания вложений (обход CORS у площадки).
type FetchDocumentConfig struct {
	AllowedHosts []string
	MaxBytes     int64
	Timeout      time.Duration
	PathPrefix   string
}

func FromEnv() (Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}
	tpTok := strings.TrimSpace(os.Getenv("TENDERPLUS_TOKEN"))
	tpTok = strings.TrimPrefix(tpTok, "\ufeff")
	c := Config{
		Addr:               ":" + port,
		TenderPlusURL:      getEnv("TENDERPLUS_URL", "https://api.tenderplus.kz/graphql"),
		TenderPlusToken:    tpTok,
		TendersKeywords:    strings.TrimSpace(os.Getenv("TENDERS_KEYWORDS")),
		CORSAllowedOrigins: mergeCORSOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")),
		DatabaseURL:        strings.TrimSpace(os.Getenv("DATABASE_URL")),
		FetchDocument:      fetchDocumentFromEnv(),
	}
	if _, err := strconv.Atoi(port); err != nil {
		return c, fmt.Errorf("PORT must be a number: %s", port)
	}
	return c, nil
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

// mergeCORSOrigins: локальные порты + значения из CORS_ALLOWED_ORIGINS (через запятую).
func mergeCORSOrigins(extra string) []string {
	out := append([]string(nil), defaultCORSOrigins()...)
	for _, p := range strings.Split(extra, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
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
		hosts = []string{"v3bl.goszakup.gov.kz"}
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
