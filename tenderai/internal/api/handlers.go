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
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type Handler struct {
	DB       *gorm.DB
	Users    *service.UserService
	FetchDoc *FetchDocumentProxy
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
	ID            int              `json:"id"`
	Lot           *string          `json:"lot"`
	LotSourceID   *string          `json:"lot_source_id"`
	Source        *string          `json:"source"`
	SourceLabel   *string          `json:"sourceLabel"`
	Title         *string          `json:"title"`
	Description   *string          `json:"description"`
	Cost          *float64         `json:"cost"`
	OneCost       *float64         `json:"one_cost,omitempty"`
	Counts        *int             `json:"counts,omitempty"`
	PartnerLink   *string          `json:"partnerLink"`
	Place         *string          `json:"place"`
	BuyID         *int             `json:"buy_id"`
	EndDate       *string          `json:"endDate,omitempty"`
	StartDate     *string          `json:"startDate,omitempty"`
	Region        *string          `json:"region,omitempty"`
	Partner       *string          `json:"partner,omitempty"`
	OrganizerName *string          `json:"organizer_name,omitempty"`
	CustomerName  *string          `json:"customer_name,omitempty"`
	Status        *string          `json:"status,omitempty"`
	PurchaseType  *string          `json:"purchaseType,omitempty"`
	IsSuitable     *bool            `json:"isSuitable,omitempty"`
	MatchedKeyword *string          `json:"matchedKeyword,omitempty"`
	MatchScore     *float64         `json:"matchScore,omitempty"`
	Documents     []LotDocumentDTO `json:"documents"`
}

type TendersListResponse struct {
	Items []LotDTO               `json:"items"`
	Meta  map[string]interface{} `json:"meta,omitempty"`
}

type ParserLot struct {
	ID            int        `gorm:"column:id"`
	StableID      string     `gorm:"column:stable_id"`
	Source        string     `gorm:"column:source"`
	ExternalID    string     `gorm:"column:external_id"`
	URL           string     `gorm:"column:url"`
	Title         string     `gorm:"column:title"`
	Description   string     `gorm:"column:description"`
	Amount        *float64   `gorm:"column:amount"`
	StartDate     *time.Time `gorm:"column:start_date"`
	EndDate       *time.Time `gorm:"column:end_date"`
	Place         *string    `gorm:"column:place"`
	CustomerName  *string    `gorm:"column:customer_name"`
	OrganizerName *string    `gorm:"column:organizer_name"`
	PurchaseType  *string    `gorm:"column:purchase_type"`
	Status        string     `gorm:"column:status"`
	UpdatedAt     time.Time  `gorm:"column:updated_at"`
	IsSuitable     *bool      `gorm:"column:is_suitable"`
	MatchedKeyword *string    `gorm:"column:matched_keyword"`
	MatchScore     *float64   `gorm:"column:match_score"`
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
	default:
		return source
	}
}

func parserLotSelectExpr() string {
	return "parser_lots.*, CASE WHEN raw @> '{\"is_suitable\": true}'::jsonb OR (raw->'is_suitable' IS NULL AND NULLIF(raw->>'matched_keyword', '') IS NOT NULL) THEN true ELSE false END AS is_suitable, NULLIF(raw->>'matched_keyword', '') AS matched_keyword, NULLIF(raw->>'match_score', '')::double precision AS match_score"
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
	source := row.Source
	label := sourceLabel(row.Source)
	partnerLink := concreteLotURL(row)
	return LotDTO{
		ID:            row.ID,
		Lot:           strPtr(row.ExternalID),
		LotSourceID:   strPtr(row.StableID),
		Source:        &source,
		SourceLabel:   &label,
		Title:         strPtr(row.Title),
		Description:   strPtr(row.Description),
		Cost:          floatPtr(amount),
		PartnerLink:   strPtr(partnerLink),
		Place:         row.Place,
		BuyID:         intPtr(row.ID),
		EndDate:       timePtrRFC3339(row.EndDate),
		StartDate:     timePtrRFC3339(row.StartDate),
		Partner:       &label,
		OrganizerName: row.OrganizerName,
		CustomerName:  row.CustomerName,
		Status:        strPtr(row.Status),
		PurchaseType:  row.PurchaseType,
		IsSuitable:     row.IsSuitable,
		MatchedKeyword: row.MatchedKeyword,
		MatchScore:     row.MatchScore,
		Documents:     documents,
	}
}

func concreteLotURL(row ParserLot) string {
	if row.Source == "zakup" && row.ExternalID != "" && (row.URL == "" || strings.Contains(row.URL, "/home/lots")) {
		return "https://zakup.gov.kz/?lotId=" + row.ExternalID
	}
	return row.URL
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

	query := h.DB.Model(&ParserLot{}).Where("source IN ?", []string{"zakup", "goszakup", "samruk"})
	keywords := splitKeywords(r.URL.Query().Get("keywords"))
	if len(keywords) > 0 {
		query = applyKeywordFilter(query, keywords)
	}
	if parseBoolQuery(r.URL.Query().Get("suitable")) {
		query = query.Where("(raw @> ?::jsonb OR (raw->'is_suitable' IS NULL AND NULLIF(raw->>'matched_keyword', '') IS NOT NULL))", `{"is_suitable": true}`)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		http.Error(w, `{"error":"ошибка получения количества тендеров"}`, http.StatusInternalServerError)
		return
	}

	var rows []ParserLot
	if err := query.Select(parserLotSelectExpr()).Order("updated_at desc, id desc").Limit(limit).Offset((page - 1)*limit).Find(&rows).Error; err != nil {
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
			"firstId":    firstItemID(items),
			"lastId":     lastItemID(items),
			"limitPage":  limit,
			"pageCount":  int(math.Ceil(float64(total) / float64(limit))),
			"totalCount": total,
			"source":     "parser",
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
	err = h.DB.Select(parserLotSelectExpr()).Where("id = ? AND source IN ?", id, []string{"zakup", "goszakup", "samruk"}).First(&row).Error
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

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(parserLotToDTO(row, docs))
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
