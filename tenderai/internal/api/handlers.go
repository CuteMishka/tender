package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

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
	ID            int                      `json:"id"`
	Lot           *string                  `json:"lot"`
	LotSourceID   *string                  `json:"lot_source_id"`
	Title         *string                  `json:"title"`
	Description   *string                  `json:"description"`
	Cost          *float64                 `json:"cost"`
	OneCost       *float64                 `json:"one_cost,omitempty"`
	Counts        *int                     `json:"counts,omitempty"`
	PartnerLink   *string                  `json:"partnerLink"`
	Place         *string                  `json:"place"`
	BuyID         *int                     `json:"buy_id"`
	EndDate       *string                  `json:"endDate,omitempty"`
	StartDate     *string                  `json:"startDate,omitempty"`
	Region        *string                  `json:"region,omitempty"`
	Partner       *string                  `json:"partner,omitempty"`
	OrganizerName *string                  `json:"organizer_name,omitempty"`
	CustomerName  *string                  `json:"customer_name,omitempty"`
	Status        *string                  `json:"status,omitempty"`
	PurchaseType  *string                  `json:"purchaseType,omitempty"`
	Documents     []tenderplus.LotDocument `json:"documents"`
}

type TendersListResponse struct {
	Items []LotDTO               `json:"items"`
	Meta  map[string]interface{} `json:"meta,omitempty"`
}

func strPtr(v string) *string     { return &v }
func intPtr(v int) *int           { return &v }
func floatPtr(v float64) *float64 { return &v }

func demoActiveLotsDTO() []LotDTO {
	now := time.Now()
	date := func(days int) *string {
		v := now.AddDate(0, 0, days).Format(time.RFC3339)
		return &v
	}
	return []LotDTO{
		{
			ID: 91001, Lot: strPtr("91001-1"), LotSourceID: strPtr("demo-active"), Title: strPtr("Аренда облачной IaaS инфраструктуры для eGov"),
			Description: strPtr("Виртуальные серверы, резервное копирование, мониторинг 24/7"), Cost: floatPtr(18500000), PartnerLink: strPtr("https://example.local/tenders/91001"),
			Place: strPtr("Астана"), BuyID: intPtr(91001), StartDate: date(-1), EndDate: date(14), Region: strPtr("Астана"), Partner: strPtr("АО Национальные информационные технологии"), OrganizerName: strPtr("АО Национальные информационные технологии"), CustomerName: strPtr("АО Национальные информационные технологии"), Status: strPtr("Активный"), PurchaseType: strPtr("Открытый конкурс"),
		},
		{
			ID: 91002, Lot: strPtr("91002-1"), LotSourceID: strPtr("demo-active"), Title: strPtr("Поставка серверов и СХД для резервного ЦОДа"),
			Description: strPtr("Серверное оборудование, дисковые массивы, монтаж и пусконаладка"), Cost: floatPtr(42700000), PartnerLink: strPtr("https://example.local/tenders/91002"),
			Place: strPtr("Алматы"), BuyID: intPtr(91002), StartDate: date(-2), EndDate: date(6), Region: strPtr("Алматы"), Partner: strPtr("ТОО Smart City Almaty"), OrganizerName: strPtr("ТОО Smart City Almaty"), CustomerName: strPtr("ТОО Smart City Almaty"), Status: strPtr("Активный"), PurchaseType: strPtr("Запрос ценовых предложений"),
		},
		{
			ID: 91003, Lot: strPtr("91003-1"), LotSourceID: strPtr("demo-active"), Title: strPtr("Техническая поддержка корпоративной виртуализации"),
			Description: strPtr("Поддержка VMware/Proxmox, SLA, реагирование на инциденты"), Cost: floatPtr(9600000), PartnerLink: strPtr("https://example.local/tenders/91003"),
			Place: strPtr("Астана"), BuyID: intPtr(91003), StartDate: date(-3), EndDate: date(3), Region: strPtr("Астана"), Partner: strPtr("ГУ Управление цифровизации Астаны"), OrganizerName: strPtr("ГУ Управление цифровизации Астаны"), CustomerName: strPtr("ГУ Управление цифровизации Астаны"), Status: strPtr("Активный"), PurchaseType: strPtr("Открытый конкурс"),
		},
	}
}

func findDemoLotDTO(id int) (LotDTO, bool) {
	for _, lot := range demoActiveLotsDTO() {
		if lot.ID == id {
			return lot, true
		}
	}
	return LotDTO{}, false
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
			dto.OrganizerName = lb.Partner.Name
			dto.CustomerName = lb.Partner.Name
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

	demoItems := []LotDTO{}
	if page == 1 {
		demoItems = demoActiveLotsDTO()
	}
	if h.TP == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(TendersListResponse{Items: demoItems, Meta: map[string]interface{}{"pageCount": 1, "totalCount": len(demoItems)}})
		return
	}
	rows, ext, err := h.TP.ListLotsByKeywords(r.Context(), keywords, page, limit)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(TendersListResponse{Items: demoItems, Meta: map[string]interface{}{"pageCount": 1, "totalCount": len(demoItems), "source": "demo_fallback"}})
		return
	}
	items := make([]LotDTO, 0, len(demoItems)+len(rows))
	items = append(items, demoItems...)
	for _, row := range rows {
		items = append(items, lotToDTO(row))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TendersListResponse{Items: items, Meta: ext})
}

// GET /api/v1/tenders/{tenderId}
func (h *Handler) GetTender(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "tenderId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		http.Error(w, `{"error":"некорректный ID"}`, http.StatusBadRequest)
		return
	}
	if demo, ok := findDemoLotDTO(id); ok {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(demo)
		return
	}
	if h.TP == nil {
		http.Error(w, "tenderplus client not configured", http.StatusServiceUnavailable)
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
