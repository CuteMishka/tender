package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dauren/tender/internal/domain"
)

type ParserStatusDTO struct {
	Configured       bool             `json:"configured"`
	IntervalSeconds int              `json:"intervalSeconds"`
	NextRunAt       string           `json:"nextRunAt,omitempty"`
	LastRun         *ParserRunDTO    `json:"lastRun,omitempty"`
	LastRequest     *ParserRequestDTO `json:"lastRequest,omitempty"`
}

type ParserRunDTO struct {
	ID          int              `json:"id"`
	StartedAt   string           `json:"startedAt"`
	FinishedAt  string           `json:"finishedAt,omitempty"`
	Status      string           `json:"status"`
	Platforms   []string         `json:"platforms"`
	Keywords    []string         `json:"keywords"`
	LotsFound   int              `json:"lotsFound"`
	LotsChanged int              `json:"lotsChanged"`
	Errors      []map[string]any `json:"errors"`
}

type ParserRequestDTO struct {
	ID          uint   `json:"id"`
	RequestedAt string `json:"requestedAt"`
	RequestedBy string `json:"requestedBy"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt,omitempty"`
	FinishedAt  string `json:"finishedAt,omitempty"`
	Message     string `json:"message,omitempty"`
}

type parserRunRow struct {
	ID          int
	StartedAt   time.Time
	FinishedAt  sql.NullTime
	Status      string
	Platforms   json.RawMessage
	Keywords    json.RawMessage
	LotsFound   int
	LotsChanged int
	Errors      json.RawMessage
}

func (h *Handler) GetParserStatus(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	interval := parserIntervalSeconds()
	var exists bool
	if err := h.DB.Raw("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'parser_runs')").Scan(&exists).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка проверки статуса парсера")
		return
	}
	if !exists {
		writeParserStatus(w, ParserStatusDTO{Configured: false, IntervalSeconds: interval})
		return
	}
	var row parserRunRow
	if err := h.DB.Raw(`
		SELECT id, started_at, finished_at, status, platforms, keywords, lots_found, lots_changed, errors
		FROM parser_runs
		ORDER BY started_at DESC
		LIMIT 1
	`).Scan(&row).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка получения статуса парсера")
		return
	}
	if row.ID == 0 {
		writeParserStatus(w, ParserStatusDTO{Configured: true, IntervalSeconds: interval, LastRequest: h.lastParserRequest()})
		return
	}
	dto := ParserRunDTO{
		ID:          row.ID,
		StartedAt:   row.StartedAt.Format(time.RFC3339),
		Status:      row.Status,
		Platforms:   decodeStringList(row.Platforms),
		Keywords:    decodeStringList(row.Keywords),
		LotsFound:   row.LotsFound,
		LotsChanged: row.LotsChanged,
		Errors:      decodeErrorList(row.Errors),
	}
	if row.FinishedAt.Valid {
		dto.FinishedAt = row.FinishedAt.Time.Format(time.RFC3339)
	}
	next := row.StartedAt.Add(time.Duration(interval) * time.Second)
	writeParserStatus(w, ParserStatusDTO{
		Configured:       true,
		IntervalSeconds: interval,
		NextRunAt:       next.Format(time.RFC3339),
		LastRun:         &dto,
		LastRequest:     h.lastParserRequest(),
	})
}

func (h *Handler) RunParserNow(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	requestedBy := strings.TrimSpace(r.Header.Get("X-User-Email"))
	if requestedBy == "" {
		requestedBy = "admin"
	}
	var existing domain.ParserRunRequest
	if err := h.DB.Where("status IN ?", []string{"pending", "running"}).Order("requested_at DESC").First(&existing).Error; err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(parserRequestDTO(existing))
		return
	}
	req := domain.ParserRunRequest{RequestedBy: requestedBy, Status: "pending"}
	if err := h.DB.Create(&req).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "не удалось поставить парсер в очередь")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(parserRequestDTO(req))
}

func (h *Handler) lastParserRequest() *ParserRequestDTO {
	if h.DB == nil {
		return nil
	}
	var req domain.ParserRunRequest
	if err := h.DB.Order("requested_at DESC").First(&req).Error; err != nil {
		return nil
	}
	dto := parserRequestDTO(req)
	return &dto
}

func parserRequestDTO(req domain.ParserRunRequest) ParserRequestDTO {
	dto := ParserRequestDTO{
		ID:          req.ID,
		RequestedAt: req.RequestedAt.Format(time.RFC3339),
		RequestedBy: req.RequestedBy,
		Status:      req.Status,
		Message:     req.Message,
	}
	if req.StartedAt != nil {
		dto.StartedAt = req.StartedAt.Format(time.RFC3339)
	}
	if req.FinishedAt != nil {
		dto.FinishedAt = req.FinishedAt.Format(time.RFC3339)
	}
	return dto
}

func parserIntervalSeconds() int {
	for _, key := range []string{"PARSER_POLL_INTERVAL_SECONDS", "POLL_INTERVAL_SECONDS"} {
		value := os.Getenv(key)
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err == nil && parsed >= 30 {
			return parsed
		}
	}
	return 1800
}

func decodeStringList(raw json.RawMessage) []string {
	var out []string
	if len(raw) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

func decodeErrorList(raw json.RawMessage) []map[string]any {
	var out []map[string]any
	if len(raw) == 0 {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

func writeParserStatus(w http.ResponseWriter, payload ParserStatusDTO) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}
