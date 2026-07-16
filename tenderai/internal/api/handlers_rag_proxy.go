package api

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

const (
	ragJSONRequestLimit     = int64(8 * 1024 * 1024)
	ragDocumentRequestLimit = int64(64 * 1024 * 1024)
	ragResponseLimit        = int64(16 * 1024 * 1024)
)

var ragProxyClient = &http.Client{
	Timeout: 3 * time.Minute,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func (h *Handler) RAGAnalyzeLot(w http.ResponseWriter, r *http.Request) {
	if !contentTypeIs(r, "application/json") {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return
	}
	h.proxyRAG(w, r, http.MethodPost, "/v1/lot/analyze", ragJSONRequestLimit)
}

func (h *Handler) RAGIndexLot(w http.ResponseWriter, r *http.Request) {
	if !contentTypeIs(r, "application/json") {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return
	}
	lotID, ok := validRAGLotID(r)
	if !ok {
		http.Error(w, "invalid lot ID", http.StatusBadRequest)
		return
	}
	h.proxyRAG(w, r, http.MethodPost, "/v1/lots/"+url.PathEscape(lotID)+"/index", ragJSONRequestLimit)
}

func (h *Handler) RAGIndexDocument(w http.ResponseWriter, r *http.Request) {
	if !contentTypeIs(r, "multipart/form-data") {
		http.Error(w, "Content-Type must be multipart/form-data", http.StatusUnsupportedMediaType)
		return
	}
	lotID, ok := validRAGLotID(r)
	if !ok {
		http.Error(w, "invalid lot ID", http.StatusBadRequest)
		return
	}
	h.proxyRAG(w, r, http.MethodPost, "/v1/lots/"+url.PathEscape(lotID)+"/index-document", ragDocumentRequestLimit)
}

func (h *Handler) RAGSpecSummary(w http.ResponseWriter, r *http.Request) {
	lotID, ok := validRAGLotID(r)
	if !ok {
		http.Error(w, "invalid lot ID", http.StatusBadRequest)
		return
	}
	h.proxyRAG(w, r, http.MethodGet, "/v1/lots/"+url.PathEscape(lotID)+"/spec-summary", 0)
}

func validRAGLotID(r *http.Request) (string, bool) {
	value := strings.TrimSpace(chi.URLParam(r, "lotId"))
	return value, value != "" && len(value) <= 256 && !strings.ContainsAny(value, "/\\?#\x00")
}

func contentTypeIs(r *http.Request, expected string) bool {
	value := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	return value == expected || strings.HasPrefix(value, expected+";")
}

func (h *Handler) proxyRAG(w http.ResponseWriter, r *http.Request, method, upstreamPath string, requestLimit int64) {
	base := strings.TrimRight(strings.TrimSpace(h.RagAPIBase), "/")
	if base == "" {
		http.Error(w, "RAG service unavailable", http.StatusServiceUnavailable)
		return
	}
	parsedBase, err := url.Parse(base)
	if err != nil || parsedBase.Scheme == "" || parsedBase.Host == "" || parsedBase.User != nil || parsedBase.RawQuery != "" || parsedBase.Fragment != "" || (parsedBase.Scheme != "http" && parsedBase.Scheme != "https") {
		http.Error(w, "RAG service unavailable", http.StatusServiceUnavailable)
		return
	}
	if requestLimit > 0 {
		if r.ContentLength > requestLimit {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, requestLimit)
	}
	upstreamURL := base + upstreamPath
	request, err := http.NewRequestWithContext(r.Context(), method, upstreamURL, r.Body)
	if err != nil {
		http.Error(w, "RAG request failed", http.StatusBadGateway)
		return
	}
	for _, header := range []string{"Accept", "Content-Type"} {
		if value := r.Header.Get(header); value != "" {
			request.Header.Set(header, value)
		}
	}
	if requestID := strings.TrimSpace(chimiddleware.GetReqID(r.Context())); requestID != "" {
		request.Header.Set("X-Request-ID", requestID)
	}
	if token := strings.TrimSpace(h.RAGInternalServiceToken); token != "" {
		request.Header.Set(InternalTokenHeader, token)
	}
	response, err := ragProxyClient.Do(request)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "RAG service unavailable", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, ragResponseLimit+1))
	if err != nil {
		http.Error(w, "RAG response failed", http.StatusBadGateway)
		return
	}
	if int64(len(body)) > ragResponseLimit {
		http.Error(w, "RAG response too large", http.StatusBadGateway)
		return
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(body)
}
