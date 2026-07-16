package analytics

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxReportRequestBytes = 1 << 20

// ReportPreview returns the canonical report data used by both the UI preview
// and the DOCX renderer.
func (h *Handler) ReportPreview(w http.ResponseWriter, r *http.Request) {
	request, err := decodeReportRequest(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	report, err := h.buildLiveReport(r, request)
	if err != nil {
		writeReportBuildError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, report)
}

// ReportDOCX builds the exact same ReportData as ReportPreview and renders it
// into a downloadable Word document.
func (h *Handler) ReportDOCX(w http.ResponseWriter, r *http.Request) {
	request, err := decodeReportRequest(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	report, err := h.buildLiveReport(r, request)
	if err != nil {
		writeReportBuildError(w, err)
		return
	}
	content, err := BuildReportDOCX(report)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось сформировать Word-справку: "+err.Error())
		return
	}
	filename := ReportDOCXFileName(report)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, filename, filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (h *Handler) buildLiveReport(r *http.Request, request ReportRequest) (ReportData, error) {
	normalized, err := normalizeReportRequest(request)
	if err != nil {
		return ReportData{}, err
	}
	intelligence, err := h.loadCompanyTenderIntelligence(r.Context(), normalized.request.OrganizationQuery, companyDisplayLimitMax)
	if err != nil {
		return ReportData{}, err
	}
	dataAsOf := intelligence.GeneratedAt
	if dataAsOf.IsZero() {
		dataAsOf = time.Now().In(reportLocation)
	}
	warnings := append([]string(nil), intelligence.Warnings...)
	if intelligence.Summary.PublishedCount > len(intelligence.Published) {
		warnings = append(warnings, fmt.Sprintf(
			"TenderPlus вернул %d из %d найденных строк; расчёты справки охватывают только полученные строки.",
			len(intelligence.Published),
			intelligence.Summary.PublishedCount,
		))
	}
	return BuildReport(intelligence.Published, normalized.request, ReportBuildMeta{
		Source:      intelligence.Source,
		DataAsOf:    dataAsOf,
		GeneratedAt: time.Now().In(reportLocation),
		Matches:     intelligence.Matches,
		Warnings:    warnings,
	})
}

func decodeReportRequest(w http.ResponseWriter, r *http.Request) (ReportRequest, error) {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxReportRequestBytes))
	decoder.DisallowUnknownFields()
	var request ReportRequest
	if err := decoder.Decode(&request); err != nil {
		if errors.Is(err, io.EOF) {
			return ReportRequest{}, errors.New("тело запроса не может быть пустым")
		}
		return ReportRequest{}, fmt.Errorf("неверный JSON запроса: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return ReportRequest{}, errors.New("тело запроса должно содержать один JSON-объект")
	}
	return request, nil
}

func writeReportBuildError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrTenderPlusNotConfigured):
		writeError(w, http.StatusServiceUnavailable, ErrTenderPlusNotConfigured.Error())
	case errors.Is(err, ErrCompanyQueryRequired), errors.Is(err, errReportQueryRequired), isReportValidationError(err):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

func isReportValidationError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "date_from") ||
		strings.Contains(message, "date_to") ||
		strings.Contains(message, "top_n")
}
