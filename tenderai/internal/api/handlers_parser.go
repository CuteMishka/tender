package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	lastRequest := h.currentParserRequest()
	var exists bool
	if err := h.DB.Raw("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'parser_runs')").Scan(&exists).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка проверки статуса парсера")
		return
	}
	if !exists {
		writeParserStatus(w, ParserStatusDTO{Configured: lastRequest != nil || githubParserConfigured(), IntervalSeconds: interval, LastRequest: lastRequest})
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
		writeParserStatus(w, ParserStatusDTO{Configured: true, IntervalSeconds: interval, LastRequest: lastRequest})
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
		LastRequest:     lastRequest,
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
	if githubParserConfigured() {
		if active := h.currentParserRequest(); active != nil && isActiveParserStatus(active.Status) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(active)
			return
		}
		req := domain.ParserRunRequest{RequestedBy: requestedBy, Status: "pending", Message: "GitHub Actions workflow dispatch requested"}
		if err := h.DB.Create(&req).Error; err != nil {
			writeJSONError(w, http.StatusInternalServerError, "не удалось создать запрос запуска парсера")
			return
		}
		if err := dispatchGitHubParserWorkflow(); err != nil {
			now := time.Now()
			h.DB.Model(&req).Updates(map[string]interface{}{"status": "failed", "finished_at": now, "message": err.Error()})
			writeJSONError(w, http.StatusBadGateway, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(parserRequestDTO(req))
		return
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

func (h *Handler) currentParserRequest() *ParserRequestDTO {
	dbRequest := h.lastParserRequest()
	githubRequest := latestGitHubParserRequest()
	if githubRequest == nil {
		return dbRequest
	}
	if dbRequest == nil {
		return githubRequest
	}
	dbRequestedAt, dbErr := time.Parse(time.RFC3339, dbRequest.RequestedAt)
	ghRequestedAt, ghErr := time.Parse(time.RFC3339, githubRequest.RequestedAt)
	if dbErr == nil && ghErr == nil && isActiveParserStatus(dbRequest.Status) && dbRequestedAt.After(ghRequestedAt) {
		return dbRequest
	}
	return githubRequest
}

func isActiveParserStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending", "queued", "running", "in_progress", "requested":
		return true
	default:
		return false
	}
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

type githubWorkflowRunsResponse struct {
	WorkflowRuns []githubWorkflowRun `json:"workflow_runs"`
}

type githubWorkflowRun struct {
	ID          uint      `json:"id"`
	Name        string    `json:"name"`
	HTMLURL     string    `json:"html_url"`
	Event       string    `json:"event"`
	Status      string    `json:"status"`
	Conclusion  string    `json:"conclusion"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	RunStartedAt time.Time `json:"run_started_at"`
}

func githubParserConfigured() bool {
	return githubActionsToken() != "" && githubRepository() != ""
}

func githubActionsToken() string {
	for _, key := range []string{"GITHUB_ACTIONS_TOKEN", "GITHUB_TOKEN_FOR_ACTIONS", "GITHUB_TOKEN"} {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

func githubRepository() string {
	return strings.Trim(strings.TrimSpace(os.Getenv("GITHUB_REPOSITORY")), "/")
}

func githubParserWorkflow() string {
	value := strings.TrimSpace(os.Getenv("GITHUB_PARSER_WORKFLOW"))
	if value == "" {
		return "parser-cron.yml"
	}
	return value
}

func githubParserRef() string {
	value := strings.TrimSpace(os.Getenv("GITHUB_PARSER_REF"))
	if value == "" {
		return "main"
	}
	return value
}

func dispatchGitHubParserWorkflow() error {
	token := githubActionsToken()
	repo := githubRepository()
	if token == "" || repo == "" {
		return fmt.Errorf("GitHub Actions не настроен: задайте GITHUB_ACTIONS_TOKEN и GITHUB_REPOSITORY")
	}
	payload := map[string]interface{}{
		"ref": githubParserRef(),
		"inputs": map[string]string{
			"max_pages": getEnvDefault("GITHUB_PARSER_MAX_PAGES", "1"),
			"max_lots":  getEnvDefault("GITHUB_PARSER_MAX_LOTS", "100"),
		},
	}
	body, _ := json.Marshal(payload)
	endpoint := fmt.Sprintf(
		"https://api.github.com/repos/%s/actions/workflows/%s/dispatches",
		repo,
		url.PathEscape(githubParserWorkflow()),
	)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("GitHub Actions API недоступен: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1000))
		return fmt.Errorf("GitHub Actions не запустил workflow: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return nil
}

func latestGitHubParserRequest() *ParserRequestDTO {
	token := githubActionsToken()
	repo := githubRepository()
	if token == "" || repo == "" {
		return nil
	}
	endpoint := fmt.Sprintf(
		"https://api.github.com/repos/%s/actions/workflows/%s/runs?per_page=1&branch=%s",
		repo,
		url.PathEscape(githubParserWorkflow()),
		url.QueryEscape(githubParserRef()),
	)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	var payload githubWorkflowRunsResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil || len(payload.WorkflowRuns) == 0 {
		return nil
	}
	run := payload.WorkflowRuns[0]
	startedAt := run.RunStartedAt
	if startedAt.IsZero() {
		startedAt = run.CreatedAt
	}
	dto := ParserRequestDTO{
		ID:          run.ID,
		RequestedAt: run.CreatedAt.Format(time.RFC3339),
		RequestedBy: "GitHub Actions",
		Status:      githubRunStatus(run),
		StartedAt:   startedAt.Format(time.RFC3339),
		Message:     githubRunMessage(run),
	}
	if strings.EqualFold(run.Status, "completed") && !run.UpdatedAt.IsZero() {
		dto.FinishedAt = run.UpdatedAt.Format(time.RFC3339)
	}
	return &dto
}

func githubRunStatus(run githubWorkflowRun) string {
	switch strings.ToLower(strings.TrimSpace(run.Status)) {
	case "queued", "requested", "waiting", "pending":
		return "pending"
	case "in_progress":
		return "running"
	case "completed":
		switch strings.ToLower(strings.TrimSpace(run.Conclusion)) {
		case "", "success":
			return "completed"
		case "cancelled", "skipped":
			return strings.ToLower(strings.TrimSpace(run.Conclusion))
		default:
			return "failed"
		}
	default:
		if run.Status != "" {
			return run.Status
		}
		return "unknown"
	}
}

func githubRunMessage(run githubWorkflowRun) string {
	parts := []string{"GitHub Actions"}
	if run.Event != "" {
		parts = append(parts, run.Event)
	}
	if run.Conclusion != "" {
		parts = append(parts, run.Conclusion)
	}
	if run.HTMLURL != "" {
		parts = append(parts, run.HTMLURL)
	}
	return strings.Join(parts, " · ")
}

func getEnvDefault(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
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
