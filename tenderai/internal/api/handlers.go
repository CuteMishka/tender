package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/dauren/tender/internal/service"
	"github.com/dauren/tender/internal/tenderplus"
)

const hardcodedTendersKeywords = "IaaS,сервер"

type Handler struct {
	TP              *tenderplus.Client
	TendersKeywords string
	Users           *service.UserService // nil, если нет DATABASE_URL
	FetchDoc        *FetchDocumentProxy  // nil — POST /api/v1/fetch-document отдаёт 503
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// LotDTO — плоский JSON для React.
type LotDTO struct {
	ID          int                      `json:"id"`
	Lot         *string                  `json:"lot"`
	LotSourceID *string                  `json:"lot_source_id"`
	Title       *string                  `json:"title"`
	Description *string                  `json:"description"`
	Cost        *float64                 `json:"cost"`
	PartnerLink *string                  `json:"partnerLink"`
	Place       *string                  `json:"place"`
	BuyID       *int                     `json:"buy_id"`
	Documents   []tenderplus.LotDocument `json:"documents"`
}

type TendersListResponse struct {
	Items []LotDTO               `json:"items"`
	Meta  map[string]interface{} `json:"meta,omitempty"`
}

// GET /api/v1/tenders?keywords=IaaS,сервер&limit=10&page=1
func (h *Handler) ListTenders(w http.ResponseWriter, r *http.Request) {
	if h.TP == nil {
		http.Error(w, "tenderplus client not configured", http.StatusServiceUnavailable)
		return
	}
	q := r.URL.Query().Get("keywords")
	if strings.TrimSpace(q) == "" {
		q = h.TendersKeywords
	}
	if strings.TrimSpace(q) == "" {
		q = hardcodedTendersKeywords
	}
	parts := strings.Split(q, ",")
	var keywords []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			keywords = append(keywords, p)
		}
	}
	if len(keywords) == 0 {
		http.Error(w, "at least one keyword is required", http.StatusBadRequest)
		return
	}
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}

	rows, ext, err := h.TP.ListLotsByKeywords(r.Context(), keywords, page, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	items := make([]LotDTO, 0, len(rows))
	for _, row := range rows {
		docs := row.AllDocuments()
		if docs == nil {
			docs = []tenderplus.LotDocument{}
		}
		items = append(items, LotDTO{
			ID:          row.ID,
			Lot:         row.Lot,
			LotSourceID: row.LotSourceID,
			Title:       row.Title,
			Description: row.Description,
			Cost:        row.Cost,
			PartnerLink: row.PartnerLink,
			Place:       row.Place,
			BuyID:       row.BuyID,
			Documents:   docs,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TendersListResponse{Items: items, Meta: ext})
}
