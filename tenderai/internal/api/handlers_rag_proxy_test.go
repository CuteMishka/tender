package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func withLotID(request *http.Request, value string) *http.Request {
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("lotId", value)
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}

func TestRAGProxyUsesOnlyAllowlistedPathAndHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.EscapedPath() != "/v1/lots/lot:123/index" {
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.EscapedPath())
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("proxy forwarded browser credentials to RAG")
		}
		if r.Header.Get(InternalTokenHeader) != "0123456789abcdef0123456789abcdef" {
			t.Error("proxy did not authenticate itself to RAG")
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"text":"spec"}` {
			t.Errorf("body = %q", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "upstream=must-not-pass")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"indexed":true}`))
	}))
	defer upstream.Close()

	handler := &Handler{RagAPIBase: upstream.URL, RAGInternalServiceToken: "0123456789abcdef0123456789abcdef"}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/rag/lots/lot:123/index", strings.NewReader(`{"text":"spec"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cookie", "tender_session=secret")
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set(InternalTokenHeader, "secret")
	request = withLotID(request, "lot:123")
	recorder := httptest.NewRecorder()
	handler.RAGIndexLot(recorder, request)

	if recorder.Code != http.StatusCreated || recorder.Body.String() != `{"indexed":true}` {
		t.Fatalf("unexpected proxy response: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Type") != "application/json" || recorder.Header().Get("Set-Cookie") != "" {
		t.Fatalf("unexpected forwarded response headers: %v", recorder.Header())
	}
}

func TestRAGProxyRejectsInvalidLotIDAndMediaType(t *testing.T) {
	handler := &Handler{RagAPIBase: "http://127.0.0.1:1"}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/rag/lots/bad/index", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request = withLotID(request, "../admin")
	recorder := httptest.NewRecorder()
	handler.RAGIndexLot(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid lot ID status = %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/v1/rag/lot/analyze", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "text/plain")
	recorder = httptest.NewRecorder()
	handler.RAGAnalyzeLot(recorder, request)
	if recorder.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("invalid media type status = %d", recorder.Code)
	}
}

func TestRAGProxyRejectsOversizedKnownBody(t *testing.T) {
	handler := &Handler{RagAPIBase: "http://127.0.0.1:1"}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/rag/lot/analyze", strings.NewReader("{}"))
	request.Header.Set("Content-Type", "application/json")
	request.ContentLength = ragJSONRequestLimit + 1
	recorder := httptest.NewRecorder()
	handler.RAGAnalyzeLot(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestRAGProxyRejectsOversizedResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(make([]byte, ragResponseLimit+1))
	}))
	defer upstream.Close()

	handler := &Handler{RagAPIBase: upstream.URL}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/rag/lot/analyze", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.RAGAnalyzeLot(recorder, request)
	if recorder.Code != http.StatusBadGateway || recorder.Body.String() != "RAG response too large\n" {
		t.Fatalf("unexpected oversized response handling: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}
