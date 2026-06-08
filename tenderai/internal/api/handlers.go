package api

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dauren/tender/internal/service"
	"github.com/dauren/tender/internal/tenderplus"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type Handler struct {
	DB       *gorm.DB
	Users    *service.UserService
	FetchDoc *FetchDocumentProxy
	TP       *tenderplus.Client
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type LotDocumentDTO struct {
	Name         *string `json:"name"`
	DownloadLink *string `json:"downloadLink"`
}

type LotDTO struct {
	ID             int              `json:"id"`
	Lot            *string          `json:"lot"`
	LotSourceID    *string          `json:"lot_source_id"`
	Source         *string          `json:"source"`
	SourceLabel    *string          `json:"sourceLabel"`
	Title          *string          `json:"title"`
	Description    *string          `json:"description"`
	Cost           *float64         `json:"cost"`
	OneCost        *float64         `json:"one_cost,omitempty"`
	Counts         *int             `json:"counts,omitempty"`
	PartnerLink    *string          `json:"partnerLink"`
	Place          *string          `json:"place"`
	BuyID          *int             `json:"buy_id"`
	EndDate        *string          `json:"endDate,omitempty"`
	StartDate      *string          `json:"startDate,omitempty"`
	Region         *string          `json:"region,omitempty"`
	Partner        *string          `json:"partner,omitempty"`
	OrganizerName  *string          `json:"organizer_name,omitempty"`
	CustomerName   *string          `json:"customer_name,omitempty"`
	Status         *string          `json:"status,omitempty"`
	PurchaseType   *string          `json:"purchaseType,omitempty"`
	IsSuitable     *bool            `json:"isSuitable,omitempty"`
	MatchedKeyword *string          `json:"matchedKeyword,omitempty"`
	MatchScore     *float64         `json:"matchScore,omitempty"`
	AIScore        *int             `json:"aiScore,omitempty"`
	AIStatus       *string          `json:"aiStatus,omitempty"`
	AIProvider     *string          `json:"aiProvider,omitempty"`
	Documents      []LotDocumentDTO `json:"documents"`
	TechnicalSpec  *string          `json:"technical_specification,omitempty"`
	AIAnalysis     *string          `json:"ai_analysis,omitempty"`
	DocumentsDebug *string          `json:"documentsDebug,omitempty"`
}

type TendersListResponse struct {
	Items []LotDTO               `json:"items"`
	Meta  map[string]interface{} `json:"meta,omitempty"`
}

type ParserLot struct {
	ID             int        `gorm:"column:id"`
	StableID       string     `gorm:"column:stable_id"`
	Source         string     `gorm:"column:source"`
	ExternalID     string     `gorm:"column:external_id"`
	URL            string     `gorm:"column:url"`
	Title          string     `gorm:"column:title"`
	Description    string     `gorm:"column:description"`
	Amount         *float64   `gorm:"column:amount"`
	StartDate      *time.Time `gorm:"column:start_date"`
	EndDate        *time.Time `gorm:"column:end_date"`
	Place          *string    `gorm:"column:place"`
	CustomerName   *string    `gorm:"column:customer_name"`
	OrganizerName  *string    `gorm:"column:organizer_name"`
	PurchaseType   *string    `gorm:"column:purchase_type"`
	Status         string     `gorm:"column:status"`
	UpdatedAt      time.Time  `gorm:"column:updated_at"`
	IsSuitable     *bool      `gorm:"column:is_suitable"`
	MatchedKeyword *string    `gorm:"column:matched_keyword"`
	MatchScore     *float64   `gorm:"column:match_score"`
	AIScore        *int       `gorm:"column:ai_score"`
	AIStatus       *string    `gorm:"column:ai_status"`
	AIProvider     *string    `gorm:"column:ai_provider"`
	Raw            []byte     `gorm:"column:raw"`
}

func (ParserLot) TableName() string {
	return "parser_lots"
}

type ParserDocument struct {
	LotStableID string  `gorm:"column:lot_stable_id"`
	Name        string  `gorm:"column:name"`
	URL         string  `gorm:"column:url"`
	LocalPath   *string `gorm:"column:local_path"`
}

func (ParserDocument) TableName() string {
	return "parser_documents"
}

const tendersMaxResultWindow int64 = 500

var parserTenderSources = []string{"zakup", "goszakup", "samruk", "tenderplus"}

func strPtr(v string) *string { return &v }

func intPtr(v int) *int { return &v }

func floatPtr(v float64) *float64 { return &v }

func timePtrRFC3339(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.RFC3339)
	return &formatted
}

func sourceLabel(source string) string {
	switch source {
	case "zakup":
		return "Госзакупки"
	case "goszakup":
		return "Госзакупки"
	case "samruk":
		return "Самрук.kz"
	case "tenderplus":
		return "TenderPlus API"
	default:
		return source
	}
}

func parserLotSelectExpr() string {
	return "parser_lots.*"
}

func parserLotToDTO(row ParserLot, docs []ParserDocument) LotDTO {
	amount := 0.0
	if row.Amount != nil {
		amount = *row.Amount
	}
	documents := make([]LotDocumentDTO, 0, len(docs))
	for _, doc := range docs {
		name := doc.Name
		url := doc.URL
		documents = append(documents, LotDocumentDTO{Name: &name, DownloadLink: &url})
	}
	documents = mergeLotDocuments(documents, rawLotDocuments(row.Raw))
	source := row.Source
	label := displaySourceLabel(row)
	partnerLink := concreteLotURL(row)
	technicalSpec := rawStringValue(row.Raw, "spec_text_sample")
	aiAnalysis := rawAIAnalysis(row.Raw)
	isSuitable := row.IsSuitable
	if isSuitable == nil {
		isSuitable = rawBoolPtr(row.Raw, "is_suitable")
	}
	matchedKeyword := row.MatchedKeyword
	if matchedKeyword == nil {
		matchedKeyword = strPtrOrNil(rawStringValue(row.Raw, "matched_keyword"))
	}
	matchScore := row.MatchScore
	if matchScore == nil {
		matchScore = rawFloatPtr(row.Raw, "match_score")
	}
	aiScore := row.AIScore
	if aiScore == nil {
		aiScore = rawIntPtr(row.Raw, "ai_score")
	}
	aiStatus := row.AIStatus
	if aiStatus == nil {
		aiStatus = strPtrOrNil(rawStringValue(row.Raw, "ai_filter_status"))
	}
	aiProvider := row.AIProvider
	if aiProvider == nil {
		aiProvider = strPtrOrNil(rawStringValue(row.Raw, "ai_provider"))
	}
	return LotDTO{
		ID:             row.ID,
		Lot:            strPtr(row.ExternalID),
		LotSourceID:    strPtr(row.StableID),
		Source:         &source,
		SourceLabel:    &label,
		Title:          strPtr(row.Title),
		Description:    strPtr(row.Description),
		Cost:           floatPtr(amount),
		PartnerLink:    strPtr(partnerLink),
		Place:          row.Place,
		BuyID:          intPtr(rawIntValue(row.Raw, "buy_id", row.ID)),
		EndDate:        timePtrRFC3339(row.EndDate),
		StartDate:      timePtrRFC3339(row.StartDate),
		Partner:        &label,
		OrganizerName:  row.OrganizerName,
		CustomerName:   row.CustomerName,
		Status:         strPtr(row.Status),
		PurchaseType:   row.PurchaseType,
		IsSuitable:     isSuitable,
		MatchedKeyword: matchedKeyword,
		MatchScore:     matchScore,
		AIScore:        aiScore,
		AIStatus:       aiStatus,
		AIProvider:     aiProvider,
		Documents:      documents,
		TechnicalSpec:  strPtrOrNil(technicalSpec),
		AIAnalysis:     strPtrOrNil(aiAnalysis),
	}
}

func strPtrOrNil(v string) *string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return &v
}

func displaySourceLabel(row ParserLot) string {
	if rawLabel := rawStringValue(row.Raw, "source_label"); rawLabel != "" && !isGenericTenderPlusLabel(rawLabel) {
		return rawLabel
	}
	for _, key := range []string{"published_platform", "partner"} {
		if value := rawStringValue(row.Raw, key); value != "" && !isGenericTenderPlusLabel(value) {
			return value
		}
	}
	if row.Source == "tenderplus" {
		if row.CustomerName != nil && looksLikeProcurementPlatform(*row.CustomerName) {
			return strings.TrimSpace(*row.CustomerName)
		}
		if row.OrganizerName != nil && looksLikeProcurementPlatform(*row.OrganizerName) {
			return strings.TrimSpace(*row.OrganizerName)
		}
	}
	return sourceLabel(row.Source)
}

func isGenericTenderPlusLabel(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "" || normalized == "tenderplus api" || normalized == "tenderplus"
}

func looksLikeProcurementPlatform(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return false
	}
	markers := []string{"samruk", "самрук", "goszakup", "госзак", "государственные закуп", "mp.kz", "omarket", "tizilim", "kazyna", "store"}
	for _, marker := range markers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func mergeLotDocuments(base []LotDocumentDTO, extra []LotDocumentDTO) []LotDocumentDTO {
	seen := make(map[string]bool, len(base)+len(extra))
	out := make([]LotDocumentDTO, 0, len(base)+len(extra))
	for _, doc := range append(base, extra...) {
		if doc.DownloadLink == nil || strings.TrimSpace(*doc.DownloadLink) == "" {
			continue
		}
		key := strings.TrimSpace(*doc.DownloadLink)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, doc)
	}
	return out
}

func rawLotDocuments(raw []byte) []LotDocumentDTO {
	if len(raw) == 0 {
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	var out []LotDocumentDTO
	for _, key := range []string{"documents", "api_documents", "lot_documents"} {
		items, ok := payload[key].([]interface{})
		if !ok {
			continue
		}
		for _, item := range items {
			obj, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			name := strings.TrimSpace(stringFromAny(obj["name"]))
			url := strings.TrimSpace(stringFromAny(obj["downloadLink"]))
			if url == "" {
				url = strings.TrimSpace(stringFromAny(obj["url"]))
			}
			if url == "" {
				continue
			}
			if name == "" {
				name = "document"
			}
			out = append(out, LotDocumentDTO{Name: &name, DownloadLink: &url})
		}
	}
	return out
}

func rawAIAnalysis(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	filter, ok := payload["ai_filter"].(map[string]interface{})
	if !ok {
		return ""
	}
	reason := strings.TrimSpace(stringFromAny(filter["reason"]))
	theme := strings.TrimSpace(stringFromAny(filter["matched_theme"]))
	score := strings.TrimSpace(stringFromAny(payload["ai_score"]))
	parts := make([]string, 0, 3)
	if score != "" {
		parts = append(parts, "Оценка: "+score+"%")
	}
	if theme != "" {
		parts = append(parts, "Тема: "+theme)
	}
	if reason != "" {
		parts = append(parts, reason)
	}
	return strings.Join(parts, "\n")
}

func stringFromAny(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	default:
		return ""
	}
}

func intFromAny(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case float64:
		return int(v), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		return n, err == nil
	default:
		return 0, false
	}
}

func rawIntValue(raw []byte, key string, fallback int) int {
	if len(raw) == 0 {
		return fallback
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fallback
	}
	if value, ok := intFromAny(payload[key]); ok {
		return value
	}
	return fallback
}

func rawIntPtr(raw []byte, key string) *int {
	if len(raw) == 0 {
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	if value, ok := intFromAny(payload[key]); ok {
		return &value
	}
	return nil
}

func rawFloatPtr(raw []byte, key string) *float64 {
	if len(raw) == 0 {
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	switch v := payload[key].(type) {
	case float64:
		return &v
	case int:
		f := float64(v)
		return &f
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err == nil {
			return &f
		}
	}
	return nil
}

func rawBoolPtr(raw []byte, key string) *bool {
	if len(raw) == 0 {
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	if value, ok := payload[key].(bool); ok {
		return &value
	}
	return nil
}

func concreteLotURL(row ParserLot) string {
	if row.Source == "zakup" && row.ExternalID != "" && (row.URL == "" || strings.Contains(row.URL, "/home/lots")) {
		return "https://zakup.gov.kz/?lotId=" + row.ExternalID
	}
	if row.Source == "goszakup" && strings.Contains(row.URL, "/subpriceoffer/") {
		if announceURL := rawStringValue(row.Raw, "announce_url"); announceURL != "" {
			return announceURL
		}
	}
	return row.URL
}

func rawStringValue(raw []byte, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	value, ok := payload[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func (h *Handler) ListTenders(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		http.Error(w, `{"error":"database is not configured"}`, http.StatusServiceUnavailable)
		return
	}
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = min(n, 50)
		}
	}
	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}

	query := h.DB.Model(&ParserLot{}).Where("source IN ?", parserTenderSources)
	keywords := splitKeywords(r.URL.Query().Get("keywords"))
	if len(keywords) > 0 {
		query = applyKeywordFilter(query, keywords)
	}
	if !parseBoolQuery(r.URL.Query().Get("includeExpired")) {
		query = query.Where("(end_date IS NULL OR end_date >= ?)", time.Now().UTC())
	}
	if parseBoolQuery(r.URL.Query().Get("suitable")) {
		query = query.
			Where("raw @> ?::jsonb", `{"is_suitable": true}`).
			Where("raw @> ?::jsonb", `{"ai_passed": true}`).
			Where("COALESCE(raw->>'ai_filter_status', '') = ?", "ok").
			Where("COALESCE(raw->>'ai_provider', '') = ?", "local-llm").
			Where("COALESCE(raw->>'manual_suitable_removed', 'false') != ?", "true")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		http.Error(w, `{"error":"ошибка получения количества тендеров"}`, http.StatusInternalServerError)
		return
	}

	effectiveTotal := total
	limited := false
	if effectiveTotal > tendersMaxResultWindow {
		effectiveTotal = tendersMaxResultWindow
		limited = true
	}
	pageCount := 1
	if effectiveTotal > 0 {
		pageCount = int(math.Ceil(float64(effectiveTotal) / float64(limit)))
	}
	if page > pageCount {
		page = pageCount
	}

	var rows []ParserLot
	if err := query.Select(parserLotSelectExpr()).Order("end_date asc NULLS LAST, updated_at desc, id desc").Limit(limit).Offset((page - 1) * limit).Find(&rows).Error; err != nil {
		http.Error(w, `{"error":"ошибка получения тендеров"}`, http.StatusInternalServerError)
		return
	}

	docsByLot := h.documentsByStableID(rows)
	items := make([]LotDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, parserLotToDTO(row, docsByLot[row.StableID]))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TendersListResponse{
		Items: items,
		Meta: map[string]interface{}{
			"firstId":          firstItemID(items),
			"lastId":           lastItemID(items),
			"limitPage":        limit,
			"page":             page,
			"pageCount":        pageCount,
			"totalCount":       effectiveTotal,
			"actualTotalCount": total,
			"limited":          limited,
			"resultWindow":     tendersMaxResultWindow,
			"source":           "parser",
		},
	})
}

func (h *Handler) GetTender(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		http.Error(w, `{"error":"database is not configured"}`, http.StatusServiceUnavailable)
		return
	}
	idStr := chi.URLParam(r, "tenderId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		http.Error(w, `{"error":"некорректный ID"}`, http.StatusBadRequest)
		return
	}

	var row ParserLot
	err = h.DB.Select(parserLotSelectExpr()).Where("id = ? AND source IN ?", id, parserTenderSources).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		http.Error(w, `{"error":"тендер не найден"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"ошибка получения тендера"}`, http.StatusInternalServerError)
		return
	}

	var docs []ParserDocument
	_ = h.DB.Where("lot_stable_id = ?", row.StableID).Order("updated_at desc, id desc").Find(&docs).Error
	dto := parserLotToDTO(row, docs)
	if row.Source == "tenderplus" && h.TP != nil {
		if lot, lotErr := h.TP.FindLot(r.Context(), tenderPlusLookups(row)); lotErr == nil && lot != nil {
			dto.Documents = mergeLotDocuments(dto.Documents, tenderPlusDocumentsToDTO(lot.AllDocuments()))
			if link := strings.TrimSpace(derefString(lot.PartnerLink)); link != "" {
				dto.PartnerLink = &link
			}
			if platform := tenderPlusPlatformName(lot); platform != "" && (isGenericTenderPlusLabel(derefString(dto.SourceLabel)) || looksLikeProcurementPlatform(platform)) {
				dto.SourceLabel = &platform
				dto.Partner = &platform
			}
		} else if len(dto.Documents) == 0 {
			reason := "TenderPlus live lookup did not return documents"
			if lotErr != nil {
				reason = "TenderPlus live lookup failed: " + lotErr.Error()
			}
			dto.DocumentsDebug = &reason
		}
		if len(dto.Documents) == 0 {
			if attached, attachedErr := h.TP.AttachedFilesFromPage(r.Context(), tenderPlusPublicPageURL(row, dto)); attachedErr == nil {
				dto.Documents = mergeLotDocuments(dto.Documents, tenderPlusDocumentsToDTO(attached))
				dto.DocumentsDebug = nil
			} else if attachedErr != nil {
				reason := "TenderPlus attached files page lookup failed: " + attachedErr.Error()
				dto.DocumentsDebug = &reason
			}
		}
	} else if len(dto.Documents) == 0 && row.Source == "tenderplus" {
		reason := "TenderPlus client is disabled: TENDERPLUS_TOKEN is empty"
		dto.DocumentsDebug = &reason
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dto)
}

func tenderPlusPublicPageURL(row ParserLot, dto LotDTO) string {
	if rawURL := rawStringValue(row.Raw, "tenderplus_page_url"); rawURL != "" {
		return rawURL
	}
	if row.ExternalID != "" {
		return "https://tenderplus.kz/zakupki/" + row.ExternalID
	}
	if row.StableID != "" {
		stable := strings.TrimPrefix(row.StableID, "tenderplus:")
		if stable != "" {
			return "https://tenderplus.kz/zakupki/" + stable
		}
	}
	if dto.PartnerLink != nil && strings.Contains(*dto.PartnerLink, "tenderplus.kz/zakupki/") {
		return strings.TrimSpace(*dto.PartnerLink)
	}
	if strings.Contains(row.URL, "tenderplus.kz/zakupki/") {
		return row.URL
	}
	return ""
}

func tenderPlusLookups(row ParserLot) []tenderplus.LotLookup {
	raw := map[string]interface{}{}
	if len(row.Raw) > 0 {
		_ = json.Unmarshal(row.Raw, &raw)
	}
	values := []tenderplus.LotLookup{
		{Field: "lot_source_id", Value: stringFromAny(raw["lot_source_id"])},
		{Field: "lotNumber", Value: stringFromAny(raw["lot"])},
		{Field: "source_id", Value: stringFromAny(raw["buy_source_id"])},
		{Field: "buy", Value: stringFromAny(raw["buy"])},
	}
	if row.ExternalID != "" {
		values = append(values,
			tenderplus.LotLookup{Field: "lotNumOrSourceId", Value: row.ExternalID},
			tenderplus.LotLookup{Field: "lotNumber", Value: row.ExternalID},
			tenderplus.LotLookup{Field: "lot_source_id", Value: row.ExternalID},
		)
	}
	if row.StableID != "" {
		stable := strings.TrimPrefix(row.StableID, "tenderplus:")
		values = append(values, tenderplus.LotLookup{Field: "lotNumOrSourceId", Value: stable})
	}
	return values
}

func tenderPlusDocumentsToDTO(docs []tenderplus.LotDocument) []LotDocumentDTO {
	out := make([]LotDocumentDTO, 0, len(docs))
	for _, doc := range docs {
		name := strings.TrimSpace(derefString(doc.Name))
		url := strings.TrimSpace(derefString(doc.DownloadLink))
		if url == "" {
			continue
		}
		if name == "" {
			name = "document"
		}
		out = append(out, LotDocumentDTO{Name: &name, DownloadLink: &url})
	}
	return out
}

func tenderPlusPlatformName(lot *tenderplus.Lot) string {
	if lot == nil || lot.LotBuy == nil || lot.LotBuy.Partner == nil {
		return ""
	}
	return strings.TrimSpace(derefString(lot.LotBuy.Partner.Name))
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (h *Handler) RemoveTenderFromSuitable(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		http.Error(w, `{"error":"database is not configured"}`, http.StatusServiceUnavailable)
		return
	}
	idStr := chi.URLParam(r, "tenderId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		http.Error(w, `{"error":"некорректный ID"}`, http.StatusBadRequest)
		return
	}
	var row ParserLot
	if err := h.DB.Where("id = ? AND source IN ?", id, parserTenderSources).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			http.Error(w, `{"error":"тендер не найден"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"ошибка получения тендера"}`, http.StatusInternalServerError)
		return
	}
	payload := map[string]interface{}{}
	if len(row.Raw) > 0 {
		_ = json.Unmarshal(row.Raw, &payload)
	}
	payload["is_suitable"] = false
	payload["ai_passed"] = false
	payload["matched_keyword"] = ""
	payload["match_score"] = 0
	payload["match_method"] = "manual_removed"
	payload["match_reason"] = "Удалено пользователем из Подходящих"
	payload["manual_suitable_removed"] = true
	payload["manual_suitable_removed_at"] = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, `{"error":"ошибка подготовки обновления"}`, http.StatusInternalServerError)
		return
	}
	if err := h.DB.Model(&ParserLot{}).Where("id = ?", id).Update("raw", raw).Error; err != nil {
		http.Error(w, `{"error":"ошибка обновления тендера"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok": true,
		"id": id,
	})
}

func splitKeywords(raw string) []string {
	parts := strings.Split(raw, ",")
	keywords := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			keywords = append(keywords, part)
		}
	}
	return keywords
}

func parseBoolQuery(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func applyKeywordFilter(query *gorm.DB, keywords []string) *gorm.DB {
	conditions := make([]string, 0, len(keywords))
	args := make([]interface{}, 0, len(keywords)*6)
	for _, keyword := range keywords {
		like := "%" + keyword + "%"
		conditions = append(conditions, "(title ILIKE ? OR description ILIKE ? OR customer_name ILIKE ? OR organizer_name ILIKE ? OR purchase_type ILIKE ? OR external_id ILIKE ?)")
		args = append(args, like, like, like, like, like, like)
	}
	return query.Where(strings.Join(conditions, " OR "), args...)
}

func (h *Handler) documentsByStableID(rows []ParserLot) map[string][]ParserDocument {
	result := make(map[string][]ParserDocument)
	if len(rows) == 0 || h.DB == nil {
		return result
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.StableID)
	}
	var docs []ParserDocument
	if err := h.DB.Where("lot_stable_id IN ?", ids).Order("updated_at desc, id desc").Find(&docs).Error; err != nil {
		return result
	}
	for _, doc := range docs {
		result[doc.LotStableID] = append(result[doc.LotStableID], doc)
	}
	return result
}

func firstItemID(items []LotDTO) int {
	if len(items) == 0 {
		return 0
	}
	return items[0].ID
}

func lastItemID(items []LotDTO) int {
	if len(items) == 0 {
		return 0
	}
	return items[len(items)-1].ID
}
