package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/dauren/tender/internal/service"
	"github.com/dauren/tender/internal/tenderplus"
	"github.com/go-chi/chi/v5"
)

const hardcodedTendersKeywords = "IaaS,сервер"

type Handler struct {
	TP              *tenderplus.Client
	TendersKeywords string
	Users           *service.UserService
	FetchDoc        *FetchDocumentProxy
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// LotDTO — плоский JSON для React.
type LotDTO struct {
	ID           int                      `json:"id"`
	Lot          *string                  `json:"lot"`
	LotSourceID  *string                  `json:"lot_source_id"`
	Title        *string                  `json:"title"`
	Description  *string                  `json:"description"`
	Cost         *float64                 `json:"cost"`
	OneCost      *float64                 `json:"one_cost,omitempty"`
	Counts       *int                     `json:"counts,omitempty"`
	PartnerLink  *string                  `json:"partnerLink"`
	Place        *string                  `json:"place"`
	BuyID        *int                     `json:"buy_id"`
	EndDate      *string                  `json:"endDate,omitempty"`
	StartDate    *string                  `json:"startDate,omitempty"`
	Region       *string                  `json:"region,omitempty"`
	Partner      *string                  `json:"partner,omitempty"`
	Status       *string                  `json:"status,omitempty"`
	PurchaseType *string                  `json:"purchaseType,omitempty"`
	Documents    []tenderplus.LotDocument `json:"documents"`
}

type TendersListResponse struct {
	Items []LotDTO               `json:"items"`
	Meta  map[string]interface{} `json:"meta,omitempty"`
}

func lotToDTO(row tenderplus.Lot) LotDTO {
	docs := row.AllDocuments()
	dto := LotDTO{
		ID:          row.ID,
		Lot:         row.Lot,
		LotSourceID: row.LotSourceID,
		Title:       row.Title,
		Description: row.Description,
		Cost:        row.Cost,
		OneCost:     row.OneCost,
		Counts:      row.Counts,
		PartnerLink: row.PartnerLink,
		Place:       row.Place,
		BuyID:       row.BuyID,
		Documents:   docs,
	}
	if row.Region != nil {
		dto.Region = row.Region.Name
	}
	if row.LotBuy != nil {
		lb := row.LotBuy
		dto.EndDate = lb.EndDate
		dto.StartDate = lb.BeginDate
		if lb.Partner != nil {
			dto.Partner = lb.Partner.Name
		}
		if lb.LotStatus != nil {
			dto.Status = lb.LotStatus.Name
			dto.PurchaseType = lb.LotStatus.Name
		}
	}
	return dto
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
		items = append(items, lotToDTO(row))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TendersListResponse{Items: items, Meta: ext})
}

// GET /api/v1/tenders/{tenderId}
func (h *Handler) GetTender(w http.ResponseWriter, r *http.Request) {
	if h.TP == nil {
		http.Error(w, "tenderplus client not configured", http.StatusServiceUnavailable)
		return
	}
	idStr := chi.URLParam(r, "tenderId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		http.Error(w, `{"error":"некорректный ID"}`, http.StatusBadRequest)
		return
	}

	q := h.TendersKeywords
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

	lot, err := h.TP.GetLotByID(r.Context(), id, keywords)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(lotToDTO(*lot))
}
