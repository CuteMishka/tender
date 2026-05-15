package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"
)

type ParserStatusDTO struct {
	Configured       bool             `json:"configured"`
	IntervalSeconds int              `json:"intervalSeconds"`
	NextRunAt       string           `json:"nextRunAt,omitempty"`
	LastRun         *ParserRunDTO    `json:"lastRun,omitempty"`
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
		writeParserStatus(w, ParserStatusDTO{Configured: true, IntervalSeconds: interval})
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
	})
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
