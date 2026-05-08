package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/dauren/tender/internal/config"
)

var (
	errFetchHTTPSOnly        = errors.New("only https URLs are allowed")
	errFetchHostNotAllowed   = errors.New("host is not allowed")
	errFetchPathNotAllowed   = errors.New("path is not allowed")
	errFetchTooManyRedirects = errors.New("too many redirects")
)

const fetchDocumentMaxRedirects = 10

// FetchDocumentProxy держит настройки и HTTP-клиент для POST /api/v1/fetch-document.
type FetchDocumentProxy struct {
	cfg    config.FetchDocumentConfig
	hosts  map[string]struct{}
	client *http.Client
}

// NewFetchDocumentProxy создаёт клиент с проверкой URL на каждом редиректе.
func NewFetchDocumentProxy(cfg config.FetchDocumentConfig) *FetchDocumentProxy {
	hosts := make(map[string]struct{}, len(cfg.AllowedHosts))
	for _, h := range cfg.AllowedHosts {
		hosts[strings.ToLower(strings.TrimSpace(h))] = struct{}{}
	}

	client := &http.Client{
		Timeout: cfg.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= fetchDocumentMaxRedirects {
				return errFetchTooManyRedirects
			}
			if err := validateFetchURL(req.URL, hosts, cfg.PathPrefix); err != nil {
				return err
			}
			return nil
		},
	}

	return &FetchDocumentProxy{cfg: cfg, hosts: hosts, client: client}
}

type fetchDocumentBody struct {
	URL string `json:"url"`
}

// FetchDocument POST /api/v1/fetch-document — проксирует GET по разрешённому URL, отдаёт тело файла.
func (h *Handler) FetchDocument(w http.ResponseWriter, r *http.Request) {
	if h.FetchDoc == nil {
		writeJSONDetail(w, http.StatusServiceUnavailable, "fetch-document proxy is not configured")
		return
	}
	if r.Method != http.MethodPost {
		writeJSONDetail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body fetchDocumentBody
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeJSONDetail(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	raw := strings.TrimSpace(body.URL)
	if raw == "" {
		writeJSONDetail(w, http.StatusBadRequest, "url is required")
		return
	}
	u, err := url.Parse(raw)
	if err != nil {
		logFetchDocumentReject("parse_error", nil, err)
		writeJSONDetail(w, http.StatusBadRequest, "invalid url")
		return
	}
	if err := validateFetchURL(u, h.FetchDoc.hosts, h.FetchDoc.cfg.PathPrefix); err != nil {
		logFetchDocumentReject("policy", u, err)
		writeJSONDetail(w, http.StatusBadRequest, err.Error())
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	if err != nil {
		writeJSONDetail(w, http.StatusBadRequest, "invalid request")
		return
	}
	req.Header.Set("User-Agent", "tender-back-fetch-document/1.0")
	req.Header.Set("Accept", "*/*")

	resp, err := h.FetchDoc.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(r.Context().Err(), context.Canceled) {
			writeJSONDetail(w, http.StatusGatewayTimeout, "upstream request timed out or canceled")
			return
		}
		switch {
		case errors.Is(err, errFetchHTTPSOnly),
			errors.Is(err, errFetchHostNotAllowed),
			errors.Is(err, errFetchPathNotAllowed),
			errors.Is(err, errFetchTooManyRedirects):
			writeJSONDetail(w, http.StatusBadRequest, err.Error())
			return
		}
		var netErr interface{ Timeout() bool }
		if errors.As(err, &netErr) && netErr.Timeout() {
			writeJSONDetail(w, http.StatusGatewayTimeout, "upstream request timed out")
			return
		}
		writeJSONDetail(w, http.StatusBadGateway, "failed to reach upstream")
		return
	}
	defer resp.Body.Close()

	if resp.ContentLength > h.FetchDoc.cfg.MaxBytes {
		writeJSONDetail(w, http.StatusBadRequest, "response too large")
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slurp, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(slurp))
		if len(msg) > 500 {
			msg = msg[:500] + "…"
		}
		if msg == "" {
			msg = fmt.Sprintf("upstream returned status %d", resp.StatusCode)
		}
		writeJSONDetail(w, http.StatusBadGateway, msg)
		return
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, h.FetchDoc.cfg.MaxBytes+1))
	if err != nil {
		writeJSONDetail(w, http.StatusBadGateway, "failed to read upstream body")
		return
	}
	if int64(len(data)) > h.FetchDoc.cfg.MaxBytes {
		writeJSONDetail(w, http.StatusBadRequest, "response too large")
		return
	}

	ctype := pickContentType(resp.Header.Get("Content-Type"), u.Path)
	if ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	if disp := resp.Header.Get("Content-Disposition"); disp != "" {
		w.Header().Set("Content-Disposition", disp)
	}

	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("fetch_document: write response: %v", err)
	}
}

func validateFetchURL(u *url.URL, hosts map[string]struct{}, pathPrefix string) error {
	if u.Scheme != "https" {
		return errFetchHTTPSOnly
	}
	if u.Hostname() == "" {
		return errFetchHostNotAllowed
	}
	host := strings.ToLower(u.Hostname())
	if _, ok := hosts[host]; !ok {
		return errFetchHostNotAllowed
	}
	if pathPrefix != "" {
		p := u.EscapedPath()
		if p == "" {
			p = "/"
		}
		if !strings.HasPrefix(p, pathPrefix) {
			return errFetchPathNotAllowed
		}
	}
	return nil
}

func logFetchDocumentReject(kind string, u *url.URL, cause error) {
	host := ""
	pathLen := 0
	if u != nil {
		host = strings.ToLower(u.Hostname())
		pathLen = len(u.Path)
	}
	log.Printf("fetch_document rejected: kind=%s host=%s path_len=%d: %v", kind, host, pathLen, cause)
}

func pickContentType(upstream, requestPath string) string {
	upstream = strings.TrimSpace(strings.Split(upstream, ";")[0])
	if upstream != "" && !strings.EqualFold(upstream, "application/octet-stream") &&
		!strings.EqualFold(upstream, "binary/octet-stream") {
		return upstream
	}
	ext := strings.ToLower(path.Ext(requestPath))
	switch ext {
	case ".pdf":
		return "application/pdf"
	case ".doc":
		return "application/msword"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xls":
		return "application/vnd.ms-excel"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".zip":
		return "application/zip"
	case ".txt":
		return "text/plain; charset=utf-8"
	default:
		if upstream != "" {
			return upstream
		}
		return "application/octet-stream"
	}
}

func writeJSONDetail(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"detail": detail})
}
