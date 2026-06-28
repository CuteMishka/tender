package api

import (
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/service"
	"github.com/dauren/tender/internal/tenderplus"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type Handler struct {
	DB         *gorm.DB
	Users      *service.UserService
	FetchDoc   *FetchDocumentProxy
	TP         *tenderplus.Client
	RagAPIBase string
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
	ID               int              `json:"id"`
	Lot              *string          `json:"lot"`
	LotSourceID      *string          `json:"lot_source_id"`
	Source           *string          `json:"source"`
	SourceLabel      *string          `json:"sourceLabel"`
	Title            *string          `json:"title"`
	Description      *string          `json:"description"`
	Cost             *float64         `json:"cost"`
	OneCost          *float64         `json:"one_cost,omitempty"`
	Counts           *int             `json:"counts,omitempty"`
	PartnerLink      *string          `json:"partnerLink"`
	Place            *string          `json:"place"`
	BuyID            *int             `json:"buy_id"`
	EndDate          *string          `json:"endDate,omitempty"`
	StartDate        *string          `json:"startDate,omitempty"`
	Region           *string          `json:"region,omitempty"`
	Partner          *string          `json:"partner,omitempty"`
	OrganizerName    *string          `json:"organizer_name,omitempty"`
	CustomerName     *string          `json:"customer_name,omitempty"`
	Status           *string          `json:"status,omitempty"`
	PurchaseType     *string          `json:"purchaseType,omitempty"`
	IsSuitable       *bool            `json:"isSuitable,omitempty"`
	MatchedKeyword   *string          `json:"matchedKeyword,omitempty"`
	MatchScore       *float64         `json:"matchScore,omitempty"`
	AIScore          *int             `json:"aiScore,omitempty"`
	AIStatus         *string          `json:"aiStatus,omitempty"`
	AIProvider       *string          `json:"aiProvider,omitempty"`
	Documents        []LotDocumentDTO `json:"documents"`
	TechnicalSpec    *string          `json:"technical_specification,omitempty"`
	AIAnalysis       *string          `json:"ai_analysis,omitempty"`
	RequiredServices []string         `json:"requiredServices,omitempty"`
	DocumentsDebug   *string          `json:"documentsDebug,omitempty"`
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
const tendersMaxPageLimit = 50

var parserTenderSources = []string{"zakup", "goszakup", "samruk", "tenderplus"}

func strPtr(v string) *string { return &v }

func intPtr(v int) *int { return &v }

func floatPtr(v float64) *float64 { return &v }

func intPtrFromFloatPtr(v *float64) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func timePtrRFC3339(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.RFC3339)
	return &formatted
}

func sourceLabel(source string) string {
	switch source {
	case "tenderplus":
		return "TenderPlus API"
	case "zakup":
		return "Госзакупки"
	case "goszakup":
		return "Госзакупки"
	case "samruk":
		return "Самрук.kz"
	default:
		return source
	}
}

func tenderPlusLotToDTO(row tenderplus.Lot) LotDTO {
	source := "tenderplus"
	label := sourceLabel(source)
	lotSourceID := strconv.Itoa(row.ID)
	if row.LotSourceID != nil && strings.TrimSpace(*row.LotSourceID) != "" {
		lotSourceID = strings.TrimSpace(*row.LotSourceID)
	}
	partnerLink := derefString(row.PartnerLink)
	documents := tenderPlusDocuments(row.Documents, nil)
	var startDate, endDate, status, partner, purchaseType, organizerName *string
	if row.LotBuy != nil {
		startDate = tenderPlusDate(row.LotBuy.BeginDate)
		endDate = tenderPlusDate(row.LotBuy.EndDate)
		if row.LotBuy.Partner != nil {
			partner = row.LotBuy.Partner.Name
		}
		documents = tenderPlusDocuments(row.Documents, row.LotBuy.Documents)
	}
	status = strPtrOrNil(tenderplus.LotStatusName(row))
	organizerName = strPtrOrNil(tenderplus.LotOrganizationName(row))
	purchaseType = strPtrOrNil(tenderplus.LotPurchaseType(row))
	region := ""
	if row.Region != nil && row.Region.Name != nil {
		region = *row.Region.Name
	}
	amount := tenderplus.LotAmount(row)
	return LotDTO{
		ID:            row.ID,
		Lot:           row.Lot,
		LotSourceID:   strPtr(lotSourceID),
		Source:        &source,
		SourceLabel:   &label,
		Title:         row.Title,
		Description:   row.Description,
		Cost:          floatPtr(amount),
		OneCost:       row.OneCost,
		Counts:        intPtrFromFloatPtr(row.Counts),
		PartnerLink:   strPtr(partnerLink),
		Place:         row.Place,
		BuyID:         row.BuyID,
		EndDate:       endDate,
		StartDate:     startDate,
		Region:        nullableString(region),
		Partner:       partner,
		OrganizerName: organizerName,
		CustomerName:  organizerName,
		Status:        status,
		PurchaseType:  purchaseType,
		Documents:     documents,
	}
}

func tenderPlusOrganizationName(row tenderplus.Lot) string {
	if row.LotBuy == nil {
		return ""
	}
	if row.LotBuy.Organization != nil {
		if value := strings.TrimSpace(derefString(row.LotBuy.Organization.ShortName)); value != "" {
			return value
		}
	}
	if value := strings.TrimSpace(derefString(row.LotBuy.Organizer)); value != "" {
		return value
	}
	if row.LotBuy.Partner != nil {
		return strings.TrimSpace(derefString(row.LotBuy.Partner.Name))
	}
	return ""
}

func tenderPlusPurchaseType(row tenderplus.Lot) string {
	if row.LotBuy != nil && row.LotBuy.TenderTypePartner != nil {
		if value := strings.TrimSpace(derefString(row.LotBuy.TenderTypePartner.Name)); value != "" {
			return value
		}
	}
	if row.SubjectType != nil {
		if value := strings.TrimSpace(derefString(row.SubjectType.Name)); value != "" {
			return value
		}
	}
	if row.LotBuy != nil {
		return strings.TrimSpace(derefString(row.LotBuy.TitleBuy))
	}
	return ""
}

func tenderPlusDocuments(primary []tenderplus.LotDocument, secondary []tenderplus.LotDocument) []LotDocumentDTO {
	out := make([]LotDocumentDTO, 0, len(primary)+len(secondary))
	seen := map[string]bool{}
	appendDocs := func(docs []tenderplus.LotDocument) {
		for _, doc := range docs {
			name := strings.TrimSpace(derefString(doc.Name))
			link := strings.TrimSpace(derefString(doc.DownloadLink))
			if name == "" || link == "" {
				continue
			}
			key := name + "\n" + link
			if seen[key] {
				continue
			}
			seen[key] = true
			n, l := name, link
			out = append(out, LotDocumentDTO{Name: &n, DownloadLink: &l})
		}
	}
	appendDocs(primary)
	appendDocs(secondary)
	return out
}

func tenderPlusDate(value *string) *string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	raw := strings.TrimSpace(*value)
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if parsed, err := time.ParseInLocation(layout, raw, time.Local); err == nil {
			formatted := parsed.Format(time.RFC3339)
			return &formatted
		}
	}
	return &raw
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func nullableString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func parserLotSelectExpr() string {
	return "parser_lots.*"
}

func parserLotToDTO(row ParserLot, docs []ParserDocument) LotDTO {
	return parserLotToDTOWithDetails(row, docs, true)
}

func parserLotToListDTO(row ParserLot) LotDTO {
	dto := parserLotToDTOWithDetails(row, nil, false)
	dto.Title = strPtr(truncateForList(row.Title, 180))
	dto.Description = strPtr("")
	dto.LotSourceID = nil
	dto.Place = nil
	dto.StartDate = nil
	dto.Partner = nil
	dto.Documents = nil
	dto.TechnicalSpec = nil
	dto.AIAnalysis = nil
	dto.RequiredServices = nil
	return dto
}

func truncateForList(value string, maxRunes int) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if maxRunes <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return strings.TrimSpace(string(runes[:maxRunes-1])) + "…"
}

func parserLotToDTOWithDetails(row ParserLot, docs []ParserDocument, includeDetails bool) LotDTO {
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
	if includeDetails {
		documents = mergeLotDocuments(documents, rawLotDocuments(row.Raw))
	}
	source := row.Source
	label := displaySourceLabel(row)
	partnerLink := concreteLotURL(row)
	technicalSpec := ""
	aiAnalysis := ""
	requiredServices := []string(nil)
	if includeDetails {
		technicalSpec = rawStringValue(row.Raw, "spec_text_sample")
		aiAnalysis = rawAIAnalysis(row.Raw)
		requiredServices = rawRequiredServices(row.Raw)
	}
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
		ID:               row.ID,
		Lot:              strPtr(row.ExternalID),
		LotSourceID:      strPtr(row.StableID),
		Source:           &source,
		SourceLabel:      &label,
		Title:            strPtr(row.Title),
		Description:      strPtr(row.Description),
		Cost:             floatPtr(amount),
		PartnerLink:      strPtr(partnerLink),
		Place:            row.Place,
		BuyID:            intPtr(rawIntValue(row.Raw, "buy_id", row.ID)),
		EndDate:          timePtrRFC3339(row.EndDate),
		StartDate:        timePtrRFC3339(row.StartDate),
		Partner:          &label,
		OrganizerName:    row.OrganizerName,
		CustomerName:     row.CustomerName,
		Status:           strPtr(row.Status),
		PurchaseType:     row.PurchaseType,
		IsSuitable:       isSuitable,
		MatchedKeyword:   matchedKeyword,
		MatchScore:       matchScore,
		AIScore:          aiScore,
		AIStatus:         aiStatus,
		AIProvider:       aiProvider,
		Documents:        documents,
		TechnicalSpec:    strPtrOrNil(technicalSpec),
		AIAnalysis:       strPtrOrNil(aiAnalysis),
		RequiredServices: requiredServices,
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
	recommendation := strings.TrimSpace(stringFromAny(filter["recommendation"]))
	positive := stringSliceFromAny(filter["positive_reasons"])
	negative := stringSliceFromAny(filter["negative_reasons"])
	services := rawRequiredServices(raw)
	parts := make([]string, 0, 8)
	if score != "" {
		parts = append(parts, "Оценка пригодности: "+score+"%")
	}
	if theme != "" {
		parts = append(parts, "Найденная тема: "+theme)
	}
	if len(services) > 0 {
		parts = append(parts, "Услуги по ТС: "+strings.Join(services, "; "))
	}
	if reason != "" {
		parts = append(parts, "Обоснование: "+reason)
	}
	if len(positive) > 0 {
		parts = append(parts, "Почему может подходить: "+strings.Join(positive, "; "))
	}
	if len(negative) > 0 {
		parts = append(parts, "Почему может не подходить: "+strings.Join(negative, "; "))
	}
	if recommendation != "" {
		parts = append(parts, "Рекомендация: "+recommendation)
	}
	return strings.Join(parts, "\n")
}

func rawRequiredServices(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	filter, _ := payload["ai_filter"].(map[string]interface{})
	candidates := []interface{}{
		filter["required_services"],
		filter["requiredServices"],
		filter["services"],
		payload["spec_services"],
		payload["required_services"],
	}
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, candidate := range candidates {
		for _, value := range stringSliceFromAny(candidate) {
			key := strings.ToLower(strings.TrimSpace(value))
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, value)
			if len(out) >= 12 {
				return out
			}
		}
	}
	return out
}

func stringSliceFromAny(value interface{}) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text := strings.TrimSpace(stringFromAny(item)); text != "" {
				out = append(out, text)
				continue
			}
			if obj, ok := item.(map[string]interface{}); ok {
				for _, key := range []string{"name", "title", "service", "category"} {
					if text := strings.TrimSpace(stringFromAny(obj[key])); text != "" {
						out = append(out, text)
						break
					}
				}
			}
		}
		return out
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		parts := strings.FieldsFunc(v, func(r rune) bool {
			return r == '\n' || r == ';' || r == '•'
		})
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if text := strings.TrimSpace(part); text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
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
	if h.TP == nil {
		http.Error(w, `{"error":"TenderPlus API не настроен"}`, http.StatusServiceUnavailable)
		return
	}
	if h.DB == nil {
		http.Error(w, `{"error":"database is not configured"}`, http.StatusServiceUnavailable)
		return
	}
	h.listParserTenders(w, r, parseBoolQuery(r.URL.Query().Get("suitable")), map[string]interface{}{
		"source":   "tenderplus",
		"apiOnly":  true,
		"pipeline": "tenderplus_api_local_llm",
	})
}

func (h *Handler) listParserTenders(w http.ResponseWriter, r *http.Request, suitable bool, extraMeta map[string]interface{}) {
	if h.DB == nil && h.TP != nil {
		h.listTenderPlusTenders(w, r)
		return
	}
	if h.DB == nil {
		http.Error(w, `{"error":"database is not configured"}`, http.StatusServiceUnavailable)
		return
	}
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = min(n, tendersMaxPageLimit)
		}
	}
	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}

	query := h.DB.Model(&ParserLot{}).Where("source = ?", "tenderplus")
	keywords, keywordSource := h.parserListKeywords(r, suitable)
	if len(keywords) > 0 {
		query = applyKeywordFilter(query, keywords)
	}
	query = applyTenderPlusServiceFilter(query)
	if !parseBoolQuery(r.URL.Query().Get("includeExpired")) {
		query = query.Where("(end_date IS NULL OR end_date >= ?)", time.Now().UTC())
	}
	if !parseBoolQuery(r.URL.Query().Get("includeExcluded")) {
		query = applyExcludedTenderTextFilter(query, h.activeDictionaryValues("stop_words"))
	}
	aiScoreExpr := "COALESCE(ai_score, CASE WHEN (raw->>'ai_score') ~ '^[0-9]+$' THEN (raw->>'ai_score')::int ELSE 0 END)"
	if suitable {
		query = query.
			Where("(is_suitable IS TRUE OR raw::jsonb @> ?::jsonb)", `{"is_suitable": true}`).
			Where(aiScoreExpr+" > 50").
			Where("(raw::jsonb @> ?::jsonb OR COALESCE(raw->>'ai_passed', '') = ?)", `{"ai_passed": true}`, "true").
			Where("COALESCE(ai_provider, raw->>'ai_provider', '') = ?", "local-llm").
			Where("COALESCE(raw->>'manual_suitable_removed', 'false') != ?", "true")
	} else {
		query = query.
			Where(aiScoreExpr+" > 0").
			Where("COALESCE(ai_provider, raw->>'ai_provider', '') = ?", "local-llm")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		if h.TP != nil {
			log.Printf("parser tenders count failed, falling back to TenderPlus API: %v", err)
			h.listTenderPlusTenders(w, r)
			return
		}
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

	items := make([]LotDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, parserLotToListDTO(row))
	}

	meta := map[string]interface{}{
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
		"keywordSource":    keywordSource,
		"keywordsCount":    len(keywords),
	}
	if len(keywords) > 0 {
		meta["keywords"] = keywords
	}
	for key, value := range extraMeta {
		meta[key] = value
	}
	writeJSON(w, http.StatusOK, TendersListResponse{Items: items, Meta: meta})
}

func (h *Handler) listTenderPlusTenders(w http.ResponseWriter, r *http.Request) {
	if err := h.writeTenderPlusTenders(w, r); err != nil {
		http.Error(w, `{"error":"TenderPlus API недоступен: `+escapeJSONError(err)+`"}`, http.StatusBadGateway)
	}
}

func (h *Handler) writeTenderPlusTenders(w http.ResponseWriter, r *http.Request) error {
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = min(n, 100)
		}
	}
	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	keywords, keywordSource := h.tenderPlusListKeywords(r)
	apiKeywords := tenderPlusAPIQueryKeywords(keywords, keywordSource)
	endDateFrom := time.Now().Format("2006-01-02")
	if parseBoolQuery(r.URL.Query().Get("includeExpired")) {
		endDateFrom = ""
	}

	const maxScanPages = 10
	scanLimit := 50
	stopWords := h.activeDictionaryValues("stop_words")
	filteredLots := make([]tenderplus.Lot, 0, limit)
	fetchedCount := 0
	filteredOutCount := 0
	scannedPages := 0
	var meta map[string]interface{}

	for apiPage := 1; apiPage <= maxScanPages; apiPage++ {
		lots, pageMeta, err := h.TP.ListActiveLots(r.Context(), apiKeywords, apiPage, scanLimit, endDateFrom)
		if err != nil {
			return err
		}
		if pageMeta != nil {
			meta = pageMeta
		}
		scannedPages++
		fetchedCount += len(lots)
		for _, lot := range lots {
			if tenderPlusLotPassesDictionaryFilter(lot, keywords, stopWords) {
				filteredLots = append(filteredLots, lot)
			} else {
				filteredOutCount++
			}
		}
		if len(lots) < scanLimit {
			break
		}
	}

	start := (page - 1) * limit
	if start > len(filteredLots) {
		start = len(filteredLots)
	}
	end := start + limit
	if end > len(filteredLots) {
		end = len(filteredLots)
	}

	items := make([]LotDTO, 0, end-start)
	for _, lot := range filteredLots[start:end] {
		items = append(items, tenderPlusLotToDTO(lot))
	}
	if meta == nil {
		meta = map[string]interface{}{}
	}
	pageCount := 1
	if len(filteredLots) > 0 {
		pageCount = int(math.Ceil(float64(len(filteredLots)) / float64(limit)))
	}
	meta["source"] = "tenderplus"
	meta["apiOnly"] = true
	meta["filtered"] = true
	meta["keywordSource"] = keywordSource
	meta["keywordsCount"] = len(keywords)
	meta["apiKeywordsCount"] = len(apiKeywords)
	meta["stopWordsCount"] = len(stopWords)
	meta["fetchedCount"] = fetchedCount
	meta["filteredOutCount"] = filteredOutCount
	meta["scanPages"] = scannedPages
	meta["page"] = page
	meta["pageCount"] = pageCount
	meta["totalCount"] = len(filteredLots)
	meta["firstId"] = firstItemID(items)
	meta["lastId"] = lastItemID(items)
	if len(keywords) > 0 {
		meta["keywords"] = keywords
	}
	if len(apiKeywords) > 0 && len(apiKeywords) != len(keywords) {
		meta["apiKeywords"] = apiKeywords
	}
	if _, ok := meta["limitPage"]; !ok {
		meta["limitPage"] = limit
	}
	writeJSON(w, http.StatusOK, TendersListResponse{Items: items, Meta: meta})
	return nil
}

func tenderPlusAPIQueryKeywords(keywords []string, keywordSource string) []string {
	if keywordSource != "dictionary" || len(keywords) == 0 {
		return keywords
	}
	out := make([]string, 0, len(keywords))
	seen := map[string]bool{}
	for _, keyword := range tenderPlusCoreAPIKeywords {
		normalized := normalizeSearchText(keyword)
		if normalized == "" || seen[normalized] {
			continue
		}
		for _, candidate := range keywords {
			if normalizeSearchText(candidate) == normalized {
				out = append(out, strings.TrimSpace(candidate))
				seen[normalized] = true
				break
			}
		}
	}
	for _, keyword := range keywords {
		normalized := normalizeSearchText(keyword)
		if normalized == "" || seen[normalized] || !isTenderPlusAPIKeywordCandidate(normalized) {
			continue
		}
		out = append(out, strings.TrimSpace(keyword))
		seen[normalized] = true
		if len(out) >= 80 {
			break
		}
	}
	if len(out) == 0 {
		return keywords
	}
	return out
}

var tenderPlusCoreAPIKeywords = []string{
	"VPS",
	"co-location",
	"Backup",
	"Vmware",
	"VDC",
	"OpenNebula",
	"IaaS",
	"DRaaS",
	"colocation",
	"Tender services",
	"BaaS",
}

func isTenderPlusAPIKeywordCandidate(normalized string) bool {
	if normalized == "" {
		return false
	}
	if tenderPlusBroadAPIKeyword(normalized) {
		return false
	}
	for _, marker := range []string{
		"аренда серверных мощност",
		"серверных мощност",
		"вычислительн",
		"инфраструктура как услуга",
		"облач",
		"tender",
		"цод",
		"центр обработки данных",
		"дата центр",
		"резервное копирован",
		"бэкап",
		"backup",
		"vps",
		"vds",
		"vdc",
		"iaas",
		"paas",
		"saas",
		"baas",
		"draas",
		"vmware",
		"vsphere",
		"openstack",
		"виртуализац",
		"схд",
		"хранилище данных",
		"кибербезопас",
		"информационная безопасность",
		"оц иб",
		"оциб",
		"soc",
		"siem",
		"dlp",
		"zero trust",
		"threat intelligence",
		"пентест",
		"аудит безопасности",
		"антивирус",
		"скзи",
		"криптозащита",
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func tenderPlusBroadAPIKeyword(normalized string) bool {
	switch normalized {
	case "сервер", "dc", "kvm", "sap", "erp", "hana", "s3", "nfs", "san", "nas",
		"ha", "sla", "dns", "vpn", "rto", "rpo", "гис", "gis", "mdr", "ndr",
		"edr", "xdr", "pam", "iam", "waf", "ngfw", "pki", "пдн", "cdn",
		"1c облако", "1с облако":
		return true
	default:
		return false
	}
}

func tenderPlusLotPassesDictionaryFilter(lot tenderplus.Lot, keywords []string, stopWords []string) bool {
	normalized := normalizeSearchText(tenderPlusLotSearchText(lot))
	if normalized == "" {
		return false
	}
	if tenderPlusSubjectType(lot) == "товар" {
		return false
	}
	if containsExcludedTenderTerm(normalized, stopWords) {
		return false
	}
	matched := matchedTenderPlusKeywords(normalized, keywords)
	if len(keywords) == 0 {
		return true
	}
	if len(matched) == 0 {
		return false
	}
	if tenderPlusLooksLikeNoise(normalized, matched) {
		return false
	}
	return true
}

func tenderPlusLotSearchText(lot tenderplus.Lot) string {
	parts := make([]string, 0, 32)
	appendValue := func(value *string) {
		if value != nil && strings.TrimSpace(*value) != "" {
			parts = append(parts, *value)
		}
	}
	appendValue(lot.Lot)
	appendValue(lot.LotSourceID)
	appendValue(lot.Title)
	appendValue(lot.Description)
	appendValue(lot.Place)
	if lot.SubjectType != nil {
		appendValue(lot.SubjectType.Name)
	}
	if lot.Category != nil {
		appendValue(lot.Category.Name)
	}
	if lot.Enstru != nil {
		appendValue(lot.Enstru.Code)
		appendValue(lot.Enstru.Title)
		appendValue(lot.Enstru.Description)
	}
	if lot.Region != nil {
		appendValue(lot.Region.Name)
	}
	if lot.LotBuy != nil {
		appendValue(lot.LotBuy.Buy)
		appendValue(lot.LotBuy.SourceID)
		appendValue(lot.LotBuy.TitleBuy)
		appendValue(lot.LotBuy.Organizer)
		if lot.LotBuy.Partner != nil {
			appendValue(lot.LotBuy.Partner.Name)
		}
		if lot.LotBuy.Organization != nil {
			appendValue(lot.LotBuy.Organization.ShortName)
			appendValue(lot.LotBuy.Organization.BinIIN)
		}
		if lot.LotBuy.TenderTypePartner != nil {
			appendValue(lot.LotBuy.TenderTypePartner.Name)
		}
		if lot.LotBuy.LotStatus != nil {
			appendValue(lot.LotBuy.LotStatus.Name)
		}
		for _, doc := range lot.LotBuy.Documents {
			appendValue(doc.Name)
		}
	}
	for _, doc := range lot.Documents {
		appendValue(doc.Name)
	}
	return strings.Join(parts, " ")
}

func tenderPlusSubjectType(lot tenderplus.Lot) string {
	if lot.SubjectType == nil || lot.SubjectType.Name == nil {
		return ""
	}
	return normalizeSearchText(*lot.SubjectType.Name)
}

func normalizeSearchText(value string) string {
	value = strings.ToLower(strings.ReplaceAll(value, "ё", "е"))
	replacer := strings.NewReplacer(
		"\u00a0", " ",
		"\r", " ",
		"\n", " ",
		"\t", " ",
		".", " ",
		",", " ",
		";", " ",
		":", " ",
		"(", " ",
		")", " ",
		"[", " ",
		"]", " ",
		"{", " ",
		"}", " ",
		"\"", " ",
		"'", " ",
		"/", " ",
		"\\", " ",
		"-", " ",
		"_", " ",
	)
	value = replacer.Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

func containsExcludedTenderTerm(normalized string, terms []string) bool {
	for _, term := range terms {
		for _, pattern := range excludedTermPatterns(term) {
			pattern = normalizeSearchText(pattern)
			if pattern != "" && strings.Contains(normalized, pattern) {
				if exceptions := excludedTermExceptions(pattern); len(exceptions) > 0 && containsAnySearchTerm(normalized, exceptions) {
					continue
				}
				return true
			}
		}
	}
	return false
}

func matchedTenderPlusKeywords(normalized string, keywords []string) []string {
	matched := make([]string, 0, len(keywords))
	seen := map[string]bool{}
	for _, keyword := range keywords {
		pattern := normalizeSearchText(keyword)
		if pattern == "" || seen[pattern] {
			continue
		}
		if strings.Contains(normalized, pattern) {
			seen[pattern] = true
			matched = append(matched, pattern)
		}
	}
	return matched
}

func tenderPlusLooksLikeNoise(normalized string, matchedKeywords []string) bool {
	hasHighConfidenceProfileContext := containsAnySearchTerm(normalized, []string{
		"vps", "iaas", "цод", "центр обработки данных", "вычислительн",
		"мощност", "облачн", "tender", "colocation", "co location",
		"стойко мест", "схд", "opennebula", "vmware", "дата центр",
		"серверных мощностей", "аренда сервер",
	})
	if containsAnySearchTerm(normalized, []string{
		"пожарн", "сигнализац", "катетер", "кардиостим", "реагент",
		"презерватив", "викрил", "канцеляр", "ручка", "видеокамер",
		"камера цифров", "актуатор", "датчик скорости", "медицин",
		"кровян", "артериальн", "пациент", "манжет", "станок",
		"видеопроектор", "проектор", "dlp проектор", "кабель канал",
		"кабель", "модем", "маршрутизатор", "коммутатор", "принтер",
		"сканер", "монитор", "компьютер", "ноутбук", "планшет",
		"канюл", "научно технической обработке документов",
		"обработке документов", "экспертизе образовательных программ",
		"образовательных программ", "по специальности", "учебн",
	}) && !hasHighConfidenceProfileContext {
		return true
	}
	if len(matchedKeywords) == 1 {
		switch matchedKeywords[0] {
		case "vdc":
			return !containsAnySearchTerm(normalized, []string{
				"виртуаль", "virtual", "цод", "центр обработки данных",
				"data center", "tender", "облач",
			})
		case "backup":
			return !containsAnySearchTerm(normalized, []string{
				"резерв", "копирован", "veeam", "сервер", "данн",
				"услуг", "схд", "tender", "облач", "репликац",
			})
		case "сервер":
			return !containsAnySearchTerm(normalized, []string{
				"аренда", "виртуаль", "выделенн", "мощност", "цод",
				"хостинг", "размещени", "данн",
			})
		}
	}
	return false
}

func containsAnySearchTerm(normalized string, terms []string) bool {
	for _, term := range terms {
		pattern := normalizeSearchText(term)
		if pattern != "" && strings.Contains(normalized, pattern) {
			return true
		}
	}
	return false
}

func (h *Handler) GetTender(w http.ResponseWriter, r *http.Request) {
	if h.TP == nil {
		http.Error(w, `{"error":"TenderPlus API не настроен"}`, http.StatusServiceUnavailable)
		return
	}
	if h.DB != nil {
		h.getParserTender(w, r)
		return
	}
	h.getTenderPlusTender(w, r)
}

func (h *Handler) getParserTender(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "tenderId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		http.Error(w, `{"error":"некорректный ID"}`, http.StatusBadRequest)
		return
	}

	var row ParserLot
	err = h.DB.Select(parserLotSelectExpr()).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if h.TP != nil {
			h.getTenderPlusTender(w, r)
			return
		}
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
	if row.Source == "tenderplus" && h.TP != nil && parseBoolQuery(r.URL.Query().Get("live")) {
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
	} else if len(dto.Documents) == 0 && row.Source == "tenderplus" && h.TP == nil {
		reason := "TenderPlus client is disabled: TENDERPLUS_TOKEN is empty"
		dto.DocumentsDebug = &reason
	}
	if !parseBoolQuery(r.URL.Query().Get("includeFullText")) {
		dto = compactTenderDetailDTO(dto)
	}

	writeJSON(w, http.StatusOK, dto)
}

func compactTenderDetailDTO(dto LotDTO) LotDTO {
	dto.TechnicalSpec = nil
	dto.AIAnalysis = nil
	return dto
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

func (h *Handler) getTenderPlusTender(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "tenderId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		http.Error(w, `{"error":"некорректный ID"}`, http.StatusBadRequest)
		return
	}
	lot, err := h.TP.LotByID(r.Context(), id)
	if err != nil {
		http.Error(w, `{"error":"тендер не найден"}`, http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, tenderPlusLotToDTO(*lot))
}

func escapeJSONError(err error) string {
	body, marshalErr := json.Marshal(err.Error())
	if marshalErr != nil {
		return "ошибка запроса"
	}
	trimmed := strings.Trim(string(body), `"`)
	return trimmed
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
	if err := h.DB.Where("id = ?", id).First(&row).Error; err != nil {
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

func (h *Handler) tenderPlusListKeywords(r *http.Request) ([]string, string) {
	if keywords := splitKeywords(r.URL.Query().Get("keywords")); len(keywords) > 0 {
		return keywords, "request"
	}
	if keywords := h.activeDictionaryValues("keywords"); len(keywords) > 0 {
		return keywords, "dictionary"
	}
	return nil, "empty"
}

func (h *Handler) parserListKeywords(r *http.Request, suitable bool) ([]string, string) {
	if keywords := splitKeywords(r.URL.Query().Get("keywords")); len(keywords) > 0 {
		return keywords, "request"
	}
	if keywords := h.activeDictionaryValues("keywords"); len(keywords) > 0 {
		return keywords, "dictionary"
	}
	return nil, "empty"
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
	args := make([]interface{}, 0, len(keywords)*12)
	for _, keyword := range keywords {
		like := "%" + keyword + "%"
		conditions = append(conditions, `(
			title ILIKE ?
			OR description ILIKE ?
			OR customer_name ILIKE ?
			OR organizer_name ILIKE ?
			OR purchase_type ILIKE ?
			OR external_id ILIKE ?
			OR COALESCE(matched_keyword, '') ILIKE ?
			OR COALESCE(raw->>'matched_keyword', '') ILIKE ?
			OR COALESCE(raw->>'keyword_match_keyword', '') ILIKE ?
			OR COALESCE(raw->>'match_text', '') ILIKE ?
			OR COALESCE(raw->>'enstru_title', '') ILIKE ?
			OR COALESCE(raw->>'enstru_description', '') ILIKE ?
		)`)
		args = append(args, like, like, like, like, like, like, like, like, like, like, like, like)
	}
	return query.Where(strings.Join(conditions, " OR "), args...)
}

func applyTenderPlusServiceFilter(query *gorm.DB) *gorm.DB {
	subjectType := "LOWER(COALESCE(raw->>'subject_type', ''))"
	text := "LOWER(COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(purchase_type, '') || ' ' || COALESCE(raw->>'match_text', ''))"
	serviceMarkers := []string{
		"аренда сервер",
		"аренде сервер",
		"аренду сервер",
		"аренда виртуаль",
		"аренде виртуаль",
		"аренду виртуаль",
		"аренда вычислительн",
		"предоставление вычислительных мощностей",
		"вычислительных мощностей",
		"физического размещения информации на сервере",
		"хостинг",
		"colocation",
		"co-location",
		"стойко-мест",
		"стойко мест",
		"облач",
		"tender service",
		"резервное копирован",
		"backup",
		"baas",
		"draas",
		"iaas",
		"vps",
		"vds",
		"vdc",
		"виртуальный цод",
		"центр обработки данных",
		"хранение данных",
		"система хранения данных",
		"схд",
		"opennebula",
		"vmware",
		"информационная безопасность",
		"информационной безопасности",
		"услуга информационной безопасности",
		"услуги информационной безопасности",
		"кибербезопас",
		"защита от ddos",
		"защита от внешних кибератак",
		"тестирование на проникновение",
		"тестированию на проникновение",
		"пентест",
		"аудит безопасности",
		"аудиту безопасности",
		"soc",
		"siem",
		"dlp",
		"edr",
		"xdr",
		"soar",
		"ngfw",
		"fortigate",
		"fortinet",
		"антивирус",
		"скзи",
		"криптозащита",
	}
	subjectConditions := "(" + subjectType + " = '' OR " + subjectType + " LIKE ? OR " + subjectType + " LIKE ?)"
	args := []interface{}{"%услуг%", "%service%"}
	conditions := make([]string, 0, len(serviceMarkers))
	for _, marker := range serviceMarkers {
		conditions = append(conditions, text+" LIKE ?")
		args = append(args, "%"+marker+"%")
	}
	query = query.Where(subjectConditions+" AND ("+strings.Join(conditions, " OR ")+")", args...)
	for _, marker := range []string{
		"ssl",
		"сертификат",
		"доменное имя",
		"регистрация домена",
		"станок",
		"видеопроектор",
		"проектор",
		"dlp-проектор",
		"кабель-канал",
		"кабель",
		"модем",
		"маршрутизатор",
		"коммутатор",
		"принтер",
		"сканер",
		"монитор",
		"компьютер",
		"ноутбук",
		"планшет",
		"камера",
		"видеокамер",
		"видеорегистратор",
		"канюл",
		"катетер",
		"медицин",
		"реагент",
		"раствор",
		"кардиостим",
		"презерватив",
		"викрил",
		"научно-технической обработке документов",
		"научно технической обработке документов",
		"обработке документов",
		"экспертизе образовательных программ",
		"образовательных программ",
		"по специальности",
		"учебн",
	} {
		query = query.Where(text+" NOT LIKE ?", "%"+marker+"%")
	}
	return query
}

func parserLotIsServiceCandidate(row ParserLot) bool {
	subjectType := normalizeSearchText(rawStringValue(row.Raw, "subject_type"))
	if subjectType != "" && !strings.Contains(subjectType, "услуг") && !strings.Contains(subjectType, "service") {
		return false
	}
	text := normalizeSearchText(strings.Join([]string{
		row.Title,
		row.Description,
		derefString(row.PurchaseType),
		rawStringValue(row.Raw, "match_text"),
	}, " "))
	for _, marker := range []string{"ssl", "сертификат", "доменное имя", "регистрация домена"} {
		if strings.Contains(text, normalizeSearchText(marker)) {
			return false
		}
	}
	for _, marker := range []string{
		"станок",
		"видеопроектор",
		"проектор",
		"dlp-проектор",
		"кабель-канал",
		"кабель",
		"модем",
		"маршрутизатор",
		"коммутатор",
		"принтер",
		"сканер",
		"монитор",
		"компьютер",
		"ноутбук",
		"планшет",
		"камера",
		"видеокамер",
		"видеорегистратор",
		"канюл",
		"катетер",
		"медицин",
		"реагент",
		"раствор",
		"кардиостим",
		"презерватив",
		"викрил",
		"научно-технической обработке документов",
		"научно технической обработке документов",
		"обработке документов",
		"экспертизе образовательных программ",
		"образовательных программ",
		"по специальности",
		"учебн",
	} {
		if strings.Contains(text, normalizeSearchText(marker)) {
			return false
		}
	}
	for _, marker := range []string{
		"аренда сервер",
		"аренде сервер",
		"аренду сервер",
		"аренда виртуаль",
		"аренде виртуаль",
		"аренду виртуаль",
		"аренда вычислительн",
		"предоставление вычислительных мощностей",
		"вычислительных мощностей",
		"физического размещения информации на сервере",
		"хостинг",
		"colocation",
		"co location",
		"стойко мест",
		"облач",
		"tender service",
		"резервное копирован",
		"backup",
		"baas",
		"draas",
		"iaas",
		"vps",
		"vds",
		"vdc",
		"виртуальный цод",
		"центр обработки данных",
		"хранение данных",
		"система хранения данных",
		"схд",
		"opennebula",
		"vmware",
		"информационная безопасность",
		"информационной безопасности",
		"услуга информационной безопасности",
		"услуги информационной безопасности",
		"кибербезопас",
		"защита от ddos",
		"защита от внешних кибератак",
		"тестирование на проникновение",
		"тестированию на проникновение",
		"пентест",
		"аудит безопасности",
		"аудиту безопасности",
		"soc",
		"siem",
		"dlp",
		"edr",
		"xdr",
		"soar",
		"ngfw",
		"fortigate",
		"fortinet",
		"антивирус",
		"скзи",
		"криптозащита",
	} {
		if strings.Contains(text, normalizeSearchText(marker)) {
			return true
		}
	}
	return false
}

func (h *Handler) activeDictionaryValues(kind string) []string {
	if h.DB == nil {
		return nil
	}
	var rows []domain.DictionaryItem
	if err := h.DB.
		Where("kind = ? AND active IS TRUE", normalizeDictionaryKind(kind)).
		Order("value asc, id asc").
		Find(&rows).Error; err != nil {
		return nil
	}
	values := make([]string, 0, len(rows))
	for _, row := range rows {
		if value := normalizeDictionaryValue(row.Value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func applyExcludedTenderTextFilter(query *gorm.DB, terms []string) *gorm.DB {
	textExpr := "LOWER(COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(purchase_type, '') || ' ' || COALESCE(customer_name, '') || ' ' || COALESCE(organizer_name, ''))"
	seen := map[string]bool{}
	for _, term := range terms {
		for _, pattern := range excludedTermPatterns(term) {
			if pattern == "" || seen[pattern] {
				continue
			}
			seen[pattern] = true
			if exceptions := excludedTermExceptions(pattern); len(exceptions) > 0 {
				parts := []string{textExpr + " LIKE ?"}
				args := []interface{}{"%" + pattern + "%"}
				for _, exception := range exceptions {
					parts = append(parts, textExpr+" NOT LIKE ?")
					args = append(args, "%"+exception+"%")
				}
				query = query.Where("NOT ("+strings.Join(parts, " AND ")+")", args...)
				continue
			}
			query = query.Where(textExpr+" NOT LIKE ?", "%"+pattern+"%")
		}
	}
	return query
}

func excludedTermExceptions(pattern string) []string {
	switch pattern {
	case "аудит":
		return []string{"аудит безопасности", "аудиту безопасности", "аудита информационной безопасности", "аудиту информационной безопасности"}
	case "тест", "тестирование", "тестирован", "тестиров":
		return []string{"тестирование на проникновение", "тестированию на проникновение", "пентест"}
	case "лиценз", "лицензия":
		return []string{"лицензий на право использования программного обеспечения dlp", "лицензий на право использования программного обеспечения siem", "fortigate", "fortinet", "антивирус"}
	default:
		return nil
	}
}

func excludedTermPatterns(term string) []string {
	normalized := strings.Join(strings.Fields(strings.ToLower(strings.ReplaceAll(term, "ё", "е"))), " ")
	if normalized == "" {
		return nil
	}
	patterns := []string{normalized}
	if strings.Contains(normalized, " ") {
		return patterns
	}
	if strings.HasSuffix(normalized, "ия") && len([]rune(normalized)) > 5 {
		base := strings.TrimSuffix(normalized, "ия")
		patterns = append(patterns, base, base+"ион")
	}
	for _, ending := range []string{
		"иями", "ями", "ами", "ого", "ему", "ыми", "ими", "ией", "иям", "иях",
		"ение", "ание", "ия", "ие", "ий", "ый", "ой", "ая", "ое", "ые", "ую", "юю",
		"ом", "ем", "ам", "ям", "ах", "ях", "ов", "ев", "ей", "ии", "ью",
		"а", "я", "ы", "и", "у", "ю", "е", "о",
	} {
		if strings.HasSuffix(normalized, ending) {
			stem := strings.TrimSuffix(normalized, ending)
			if len([]rune(stem)) >= 5 {
				patterns = append(patterns, stem)
			}
			break
		}
	}
	return patterns
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
