package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type SpecSummaryAutoResponse struct {
	RagLotID      string                 `json:"ragLotId"`
	Source        string                 `json:"source"`
	Document      *LotDocumentDTO        `json:"document,omitempty"`
	ExtractedText string                 `json:"extractedText,omitempty"`
	SpecSummary   map[string]interface{} `json:"spec_summary"`
}

type ragIndexResponse struct {
	Indexed       bool                   `json:"indexed"`
	TextChars     int                    `json:"text_chars,omitempty"`
	ExtractedText string                 `json:"extracted_text,omitempty"`
	SpecSummary   map[string]interface{} `json:"spec_summary,omitempty"`
}

var fetchDocumentRetryDelays = []time.Duration{750 * time.Millisecond, 2 * time.Second}

func (h *Handler) AutoExtractTenderSpecSummary(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	ragBase := strings.TrimRight(h.RagAPIBase, "/")
	if ragBase == "" {
		ragBase = "http://127.0.0.1:8083"
	}

	id, err := strconv.Atoi(chi.URLParam(r, "tenderId"))
	if err != nil || id < 1 {
		writeJSONError(w, http.StatusBadRequest, "некорректный ID")
		return
	}

	row, docs, ok := h.loadParserLotForSpec(w, id)
	if !ok {
		return
	}
	dto := parserLotToDTO(row, docs)
	dto.Documents = h.documentsForSpec(r.Context(), row, dto)

	ragLotID := specRagLotID(dto)
	if ragLotID == "" {
		writeJSONError(w, http.StatusBadRequest, "не удалось определить идентификатор лота для RAG")
		return
	}

	if summary, found, err := getRAGSpecSummary(r.Context(), ragBase, ragLotID); err == nil && found {
		writeSpecSummaryAuto(w, SpecSummaryAutoResponse{
			RagLotID:    ragLotID,
			Source:      "cached",
			SpecSummary: summary,
		})
		return
	} else if err != nil {
		writeJSONError(w, http.StatusBadGateway, "RAG недоступен: "+err.Error())
		return
	}

	if text := specTextFromRow(row); text != "" {
		indexed, err := indexRAGText(r.Context(), ragBase, ragLotID, text, fmt.Sprintf("%s;backend_auto_spec_text", derefString(dto.Source)))
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, err.Error())
			return
		}
		if len(indexed.SpecSummary) == 0 {
			writeJSONError(w, http.StatusBadGateway, "ТС обработана, но AI не выделил услуги")
			return
		}
		writeSpecSummaryAuto(w, SpecSummaryAutoResponse{
			RagLotID:      ragLotID,
			Source:        "text",
			ExtractedText: text,
			SpecSummary:   indexed.SpecSummary,
		})
		return
	}

	doc := pickSpecDocumentDTO(dto.Documents)
	if doc == nil {
		writeJSONError(w, http.StatusUnprocessableEntity, "в документах лота нет PDF/DOCX для автоматического разбора ТС")
		return
	}
	data, err := h.fetchAllowedDocumentBytes(r.Context(), derefString(doc.DownloadLink))
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "не удалось скачать документ ТС: "+err.Error())
		return
	}
	indexed, err := indexRAGDocument(r.Context(), ragBase, ragLotID, derefString(doc.Name), data, fmt.Sprintf("%s;backend_auto_spec_document;%s", derefString(dto.Source), derefString(doc.Name)))
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	if len(indexed.SpecSummary) == 0 {
		writeJSONError(w, http.StatusBadGateway, "документ обработан, но AI не выделил услуги")
		return
	}
	writeSpecSummaryAuto(w, SpecSummaryAutoResponse{
		RagLotID:      ragLotID,
		Source:        "document",
		Document:      doc,
		ExtractedText: indexed.ExtractedText,
		SpecSummary:   indexed.SpecSummary,
	})
}

func (h *Handler) loadParserLotForSpec(w http.ResponseWriter, id int) (ParserLot, []ParserDocument, bool) {
	var row ParserLot
	err := h.DB.Select(parserLotSelectExpr()).Where("id = ? AND source IN ?", id, parserTenderSources).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeJSONError(w, http.StatusNotFound, "тендер не найден")
		return ParserLot{}, nil, false
	}
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка получения тендера")
		return ParserLot{}, nil, false
	}
	var docs []ParserDocument
	_ = h.DB.Where("lot_stable_id = ?", row.StableID).Order("updated_at desc, id desc").Find(&docs).Error
	return row, docs, true
}

func (h *Handler) documentsForSpec(ctx context.Context, row ParserLot, dto LotDTO) []LotDocumentDTO {
	out := dto.Documents
	if row.Source == "tenderplus" && h.TP != nil {
		if lot, err := h.TP.FindLot(ctx, tenderPlusLookups(row)); err == nil && lot != nil {
			out = mergeLotDocuments(out, tenderPlusDocumentsToDTO(lot.AllDocuments()))
		}
	}
	return out
}

func writeSpecSummaryAuto(w http.ResponseWriter, payload SpecSummaryAutoResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func specRagLotID(dto LotDTO) string {
	for _, candidate := range []string{derefString(dto.LotSourceID), derefString(dto.Lot), fmt.Sprintf("tender:%d", dto.ID)} {
		if value := strings.TrimSpace(candidate); value != "" {
			return value
		}
	}
	return ""
}

func specTextFromRow(row ParserLot) string {
	for _, key := range []string{"spec_text_sample", "technical_specification", "technicalSpecification", "specification"} {
		if value := rawStringValue(row.Raw, key); value != "" {
			return value
		}
	}
	return ""
}

func pickSpecDocumentDTO(docs []LotDocumentDTO) *LotDocumentDTO {
	var first *LotDocumentDTO
	var preferred *LotDocumentDTO
	for i := range docs {
		doc := &docs[i]
		ext := specDocumentExt(derefString(doc.Name), derefString(doc.DownloadLink))
		if ext != ".pdf" && ext != ".docx" {
			continue
		}
		if first == nil {
			first = doc
		}
		name := strings.ToLower(derefString(doc.Name))
		if strings.Contains(name, "спецификац") || strings.Contains(name, "технич") || strings.Contains(name, "тз") || strings.Contains(name, "tech") {
			preferred = doc
			break
		}
	}
	if preferred != nil {
		return preferred
	}
	return first
}

func specDocumentExt(name string, rawURL string) string {
	if ext := strings.ToLower(path.Ext(strings.TrimSpace(name))); ext != "" {
		return ext
	}
	if u, err := url.Parse(strings.TrimSpace(rawURL)); err == nil {
		return strings.ToLower(path.Ext(u.Path))
	}
	return ""
}

func (h *Handler) fetchAllowedDocumentBytes(ctx context.Context, raw string) ([]byte, error) {
	if h.FetchDoc == nil {
		return nil, errors.New("fetch-document proxy is not configured")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, errors.New("invalid url")
	}
	if err := validateFetchURL(u, h.FetchDoc.hosts, h.FetchDoc.cfg.PathPrefix); err != nil {
		return nil, err
	}
	cacheKey := u.String()
	if cached, ok := docBytesCache.get(cacheKey); ok {
		return cached, nil
	}

	var lastErr error
	for attempt := 0; attempt <= len(fetchDocumentRetryDelays); attempt++ {
		data, retry, err := h.fetchAllowedDocumentBytesOnce(ctx, u)
		if err == nil {
			docBytesCache.set(cacheKey, data)
			return data, nil
		}
		lastErr = err
		if !retry || attempt == len(fetchDocumentRetryDelays) || ctx.Err() != nil {
			return nil, err
		}
		timer := time.NewTimer(fetchDocumentRetryDelays[attempt])
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("failed to fetch document")
}

func (h *Handler) fetchAllowedDocumentBytesOnce(ctx context.Context, u *url.URL) ([]byte, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, false, errors.New("invalid request")
	}
	req.Header.Set("User-Agent", "tender-back-fetch-document/1.0")
	req.Header.Set("Accept", "*/*")
	resp, err := h.FetchDoc.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.Canceled) {
			return nil, false, errors.New("upstream request timed out or canceled")
		}
		switch {
		case errors.Is(err, errFetchHTTPSOnly),
			errors.Is(err, errFetchHostNotAllowed),
			errors.Is(err, errFetchPathNotAllowed),
			errors.Is(err, errFetchTooManyRedirects):
			return nil, false, err
		}
		var netErr interface{ Timeout() bool }
		if errors.As(err, &netErr) && netErr.Timeout() {
			return nil, true, errors.New("upstream request timed out")
		}
		return nil, true, errors.New("failed to reach upstream")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slurp, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		msg := strings.TrimSpace(string(slurp))
		if msg == "" {
			msg = fmt.Sprintf("upstream returned status %d", resp.StatusCode)
		}
		return nil, isRetryableDocumentStatus(resp.StatusCode), errors.New(msg)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, h.FetchDoc.cfg.MaxBytes+1))
	if err != nil {
		return nil, true, errors.New("failed to read upstream body")
	}
	if int64(len(data)) > h.FetchDoc.cfg.MaxBytes {
		return nil, false, errors.New("response too large")
	}
	return data, false, nil
}

func isRetryableDocumentStatus(status int) bool {
	switch status {
	case http.StatusRequestTimeout,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func getRAGSpecSummary(ctx context.Context, ragBase string, lotID string) (map[string]interface{}, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ragBase+"/v1/lots/"+url.PathEscape(lotID)+"/spec-summary", nil)
	if err != nil {
		return nil, false, err
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false, fmt.Errorf("spec-summary HTTP %d: %s", resp.StatusCode, ragErrorDetail(body))
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, false, err
	}
	return out, true, nil
}

func indexRAGText(ctx context.Context, ragBase string, lotID string, text string, sourceHint string) (ragIndexResponse, error) {
	payload := map[string]interface{}{
		"text":                text,
		"source_hint":         sourceHint,
		"extract_spec_points": true,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ragBase+"/v1/lots/"+url.PathEscape(lotID)+"/index", bytes.NewReader(body))
	if err != nil {
		return ragIndexResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	return doRAGIndexRequest(req)
}

func indexRAGDocument(ctx context.Context, ragBase string, lotID string, filename string, data []byte, sourceHint string) (ragIndexResponse, error) {
	if strings.TrimSpace(filename) == "" {
		filename = "technical-specification.pdf"
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return ragIndexResponse{}, err
	}
	if _, err := part.Write(data); err != nil {
		return ragIndexResponse{}, err
	}
	_ = writer.WriteField("source_hint", sourceHint)
	_ = writer.WriteField("extract_spec_points", "true")
	_ = writer.WriteField("include_extracted_text", "true")
	if err := writer.Close(); err != nil {
		return ragIndexResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ragBase+"/v1/lots/"+url.PathEscape(lotID)+"/index-document", &body)
	if err != nil {
		return ragIndexResponse{}, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return doRAGIndexRequest(req)
}

func doRAGIndexRequest(req *http.Request) (ragIndexResponse, error) {
	resp, err := (&http.Client{Timeout: 150 * time.Second}).Do(req)
	if err != nil {
		return ragIndexResponse{}, fmt.Errorf("RAG недоступен: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ragIndexResponse{}, fmt.Errorf("RAG HTTP %d: %s", resp.StatusCode, ragErrorDetail(body))
	}
	var out ragIndexResponse
	if len(body) > 0 {
		if err := json.Unmarshal(body, &out); err != nil {
			return ragIndexResponse{}, fmt.Errorf("RAG вернул некорректный JSON: %w", err)
		}
	}
	return out, nil
}

func ragErrorDetail(body []byte) string {
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err == nil {
		if detail, ok := parsed["detail"]; ok {
			return strings.TrimSpace(fmt.Sprint(detail))
		}
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 500 {
		return text[:500] + "..."
	}
	if text == "" {
		return "без деталей"
	}
	return text
}
