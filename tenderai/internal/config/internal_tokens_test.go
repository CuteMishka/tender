package config

import (
	"strings"
	"testing"
)

func TestInternalServiceTokensAreDistinctAndExplicit(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_TOKEN", "")
	t.Setenv("BACKEND_INTERNAL_SERVICE_TOKEN", strings.Repeat("b", 48))
	t.Setenv("RAG_INTERNAL_SERVICE_TOKEN", strings.Repeat("r", 48))

	cfg, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if cfg.Auth.BackendInternalServiceToken != strings.Repeat("b", 48) {
		t.Fatal("backend service token was not mapped independently")
	}
	if cfg.RAGInternalServiceToken != strings.Repeat("r", 48) {
		t.Fatal("RAG service token was not mapped independently")
	}
}

func TestLegacyOrSharedInternalServiceTokenFailsClosed(t *testing.T) {
	t.Run("legacy variable", func(t *testing.T) {
		t.Setenv("INTERNAL_SERVICE_TOKEN", strings.Repeat("l", 48))
		t.Setenv("BACKEND_INTERNAL_SERVICE_TOKEN", "")
		t.Setenv("RAG_INTERNAL_SERVICE_TOKEN", "")
		if _, err := FromEnv(); err == nil || !strings.Contains(err.Error(), "no longer supported") {
			t.Fatalf("legacy token error = %v", err)
		}
	})

	t.Run("same token reused", func(t *testing.T) {
		t.Setenv("INTERNAL_SERVICE_TOKEN", "")
		shared := strings.Repeat("s", 48)
		t.Setenv("BACKEND_INTERNAL_SERVICE_TOKEN", shared)
		t.Setenv("RAG_INTERNAL_SERVICE_TOKEN", shared)
		if _, err := FromEnv(); err == nil || !strings.Contains(err.Error(), "must be distinct") {
			t.Fatalf("shared token error = %v", err)
		}
	})

	t.Run("short RAG token", func(t *testing.T) {
		t.Setenv("INTERNAL_SERVICE_TOKEN", "")
		t.Setenv("BACKEND_INTERNAL_SERVICE_TOKEN", strings.Repeat("b", 48))
		t.Setenv("RAG_INTERNAL_SERVICE_TOKEN", "too-short")
		if _, err := FromEnv(); err == nil || !strings.Contains(err.Error(), "RAG_INTERNAL_SERVICE_TOKEN") {
			t.Fatalf("short token error = %v", err)
		}
	})
}
