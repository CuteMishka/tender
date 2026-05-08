package analytics

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dauren/tender/internal/tenderplus"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type Handler struct {
	DB       *gorm.DB
	TP       *tenderplus.Client
	Keywords string
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// POST /api/v1/analytics/sync
func (h *Handler) Sync(w http.ResponseWriter, r *http.Request) {
	if h.TP == nil {
		writeError(w, http.StatusServiceUnavailable, "TenderPlus не настроен")
		return
	}
	result, err := SyncFromTenderPlus(r.Context(), h.DB, h.TP, h.Keywords)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, result)
}

// GET /api/v1/analytics/lots
func (h *Handler) ListLots(w http.ResponseWriter, r *http.Request) {
	q := h.DB.Model(&HistoricalLot{})

	if v := r.URL.Query().Get("customer"); v != "" {
		q = q.Where("customer_name ILIKE ?", "%"+v+"%")
	}
	if v := r.URL.Query().Get("purchase_type"); v != "" {
		q = q.Where("purchase_type = ?", v)
	}
	if v := r.URL.Query().Get("region"); v != "" {
		q = q.Where("region ILIKE ?", "%"+v+"%")
	}
	if v := r.URL.Query().Get("winner"); v != "" {
		q = q.Where("winner_name ILIKE ?", "%"+v+"%")
	}
	if v := r.URL.Query().Get("date_from"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			q = q.Where("end_date >= ?", t)
		}
	}
	if v := r.URL.Query().Get("date_to"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			q = q.Where("end_date <= ?", t.Add(24*time.Hour))
		}
	}
	if v := r.URL.Query().Get("amount_min"); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			q = q.Where("initial_amount >= ?", n)
		}
	}
	if v := r.URL.Query().Get("amount_max"); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			q = q.Where("initial_amount <= ?", n)
		}
	}

	var total int64
	q.Count(&total)

	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 {
			page = n
		}
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 && n <= 100 {
			limit = n
		}
	}

	lots := make([]HistoricalLot, 0)
	q.Order("end_date DESC NULLS LAST").Offset((page - 1) * limit).Limit(limit).Find(&lots)

	writeJSON(w, map[string]any{
		"items": lots,
		"meta": map[string]any{
			"total":     total,
			"page":      page,
			"limit":     limit,
			"pageCount": (total + int64(limit) - 1) / int64(limit),
		},
	})
}

// GET /api/v1/analytics/stats
func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	var stats Stats
	h.DB.Model(&HistoricalLot{}).Count(&stats.TotalLots)
	h.DB.Model(&HistoricalLot{}).Select("COALESCE(SUM(initial_amount),0)").Scan(&stats.TotalBudget)
	h.DB.Model(&HistoricalLot{}).Select("COALESCE(AVG(initial_amount),0)").Scan(&stats.AvgAmount)
	h.DB.Model(&HistoricalLot{}).Where("winner_name != ''").Count(&stats.WithWinner)
	h.DB.Model(&HistoricalLot{}).Where("contract_amount > 0").Count(&stats.WithContract)
	h.DB.Model(&HistoricalLot{}).
		Where("initial_amount > 0 AND contract_amount > 0").
		Select("COALESCE(AVG((initial_amount - contract_amount) / initial_amount * 100), 0)").
		Scan(&stats.AvgDiscount)
	writeJSON(w, stats)
}

// GET /api/v1/analytics/dynamics
func (h *Handler) GetDynamics(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Period string  `json:"period"`
		Count  int64   `json:"count"`
		Budget float64 `json:"budget"`
	}
	rows := make([]row, 0)
	h.DB.Model(&HistoricalLot{}).
		Select("TO_CHAR(COALESCE(end_date, created_at), 'YYYY-MM') AS period, COUNT(*) AS count, COALESCE(SUM(initial_amount),0) AS budget").
		Where("end_date IS NOT NULL OR created_at IS NOT NULL").
		Group("period").
		Order("period ASC").
		Limit(36).
		Scan(&rows)
	writeJSON(w, rows)
}

// GET /api/v1/analytics/filters  — уникальные значения для дропдаунов
func (h *Handler) GetFilters(w http.ResponseWriter, r *http.Request) {
	types := make([]string, 0)
	h.DB.Model(&HistoricalLot{}).
		Where("purchase_type != ''").
		Distinct("purchase_type").
		Pluck("purchase_type", &types)

	regions := make([]string, 0)
	h.DB.Model(&HistoricalLot{}).
		Where("region != ''").
		Distinct("region").
		Pluck("region", &regions)

	writeJSON(w, map[string]any{
		"purchase_types": types,
		"regions":        regions,
	})
}

// GET /api/v1/analytics/export?format=csv
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	lots := make([]HistoricalLot, 0)
	h.DB.Order("end_date DESC NULLS LAST").Limit(5000).Find(&lots)
	ExportCSV(w, lots)
}

// GET /api/v1/analytics/customers
func (h *Handler) ListCustomers(w http.ResponseWriter, r *http.Request) {
	customers := make([]TrackedCustomer, 0)
	h.DB.Order("created_at DESC").Find(&customers)

	for i := range customers {
		var count int64
		var total float64
		var lastDate *time.Time
		h.DB.Model(&HistoricalLot{}).
			Where("customer_name ILIKE ?", "%"+customers[i].CustomerName+"%").
			Count(&count)
		h.DB.Model(&HistoricalLot{}).
			Where("customer_name ILIKE ?", "%"+customers[i].CustomerName+"%").
			Select("COALESCE(SUM(initial_amount),0)").Scan(&total)
		h.DB.Model(&HistoricalLot{}).
			Where("customer_name ILIKE ?", "%"+customers[i].CustomerName+"%").
			Select("MAX(end_date)").Scan(&lastDate)
		customers[i].TenderCount = int(count)
		customers[i].TotalBudget = total
		customers[i].LastTenderAt = lastDate
	}

	writeJSON(w, customers)
}

// POST /api/v1/analytics/customers
func (h *Handler) AddCustomer(w http.ResponseWriter, r *http.Request) {
	var input TrackedCustomer
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Неверный формат данных")
		return
	}
	input.CustomerName = strings.TrimSpace(input.CustomerName)
	if input.CustomerName == "" {
		writeError(w, http.StatusBadRequest, "Имя заказчика обязательно")
		return
	}
	if err := h.DB.Create(&input).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			writeError(w, http.StatusConflict, "Заказчик уже отслеживается")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, input)
}

// DELETE /api/v1/analytics/customers/{id}
func (h *Handler) DeleteCustomer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.DB.Delete(&TrackedCustomer{}, id).Error; err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

// GET /api/v1/analytics/customers/{id}/lots
func (h *Handler) GetCustomerLots(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var customer TrackedCustomer
	if err := h.DB.First(&customer, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Заказчик не найден")
		return
	}
	lots := make([]HistoricalLot, 0)
	h.DB.Where("customer_name ILIKE ?", "%"+customer.CustomerName+"%").
		Order("end_date DESC NULLS LAST").
		Limit(200).
		Find(&lots)
	writeJSON(w, map[string]any{"customer": customer, "lots": lots})
}

// GET /api/v1/analytics/winners
func (h *Handler) GetWinners(w http.ResponseWriter, r *http.Request) {
	rows := make([]WinnerRow, 0)
	h.DB.Model(&HistoricalLot{}).
		Where("winner_name != ''").
		Select(`
			winner_name,
			COUNT(*) AS wins,
			COALESCE(SUM(contract_amount),0) AS total_amount,
			COALESCE(AVG(contract_amount),0) AS avg_amount,
			COALESCE(MAX(contract_amount),0) AS max_amount
		`).
		Group("winner_name").
		Order("wins DESC, total_amount DESC").
		Limit(50).
		Scan(&rows)

	// считаем общий объём для market_share
	var grandTotal float64
	for _, r := range rows {
		grandTotal += r.TotalAmount
	}
	if grandTotal > 0 {
		for i := range rows {
			rows[i].MarketSharePct = rows[i].TotalAmount / grandTotal * 100
		}
	}

	writeJSON(w, rows)
}

// GET /api/v1/analytics/prices
func (h *Handler) GetPrices(w http.ResponseWriter, r *http.Request) {
	var priceStats PriceStats
	h.DB.Model(&HistoricalLot{}).
		Where("initial_amount > 0 AND contract_amount > 0").
		Select(`
			COALESCE(AVG(initial_amount), 0) AS avg_initial,
			COALESCE(AVG(contract_amount), 0) AS avg_contract,
			COALESCE(AVG((initial_amount - contract_amount) / initial_amount * 100), 0) AS avg_discount_pct,
			COALESCE(MAX((initial_amount - contract_amount) / initial_amount * 100), 0) AS max_discount_pct,
			COALESCE(MIN((initial_amount - contract_amount) / initial_amount * 100), 0) AS min_discount_pct,
			COALESCE(SUM(initial_amount - contract_amount), 0) AS total_savings
		`).Scan(&priceStats)

	h.DB.Model(&HistoricalLot{}).
		Where("initial_amount > 0 AND contract_amount > 0 AND (initial_amount - contract_amount) / initial_amount > 0.4").
		Count(&priceStats.AnomalyCount)

	rows := make([]PriceRow, 0)
	h.DB.Model(&HistoricalLot{}).
		Where("initial_amount > 0 AND contract_amount > 0").
		Select(`
			lot_id, title, initial_amount, contract_amount,
			(initial_amount - contract_amount) AS discount_abs,
			ROUND(CAST((initial_amount - contract_amount) / initial_amount * 100 AS numeric), 2) AS discount_pct,
			purchase_type, customer_name, winner_name
		`).
		Order("discount_pct DESC").
		Limit(200).
		Scan(&rows)

	writeJSON(w, map[string]any{
		"stats": priceStats,
		"rows":  rows,
	})
}

// PUT /api/v1/analytics/lots/{id}
func (h *Handler) UpdateLot(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input UpdateLotInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Неверный формат данных")
		return
	}
	updates := map[string]any{}
	if input.WinnerName != "" {
		updates["winner_name"] = input.WinnerName
	}
	if input.WinnerID != "" {
		updates["winner_id"] = input.WinnerID
	}
	if input.ContractAmount > 0 {
		updates["contract_amount"] = input.ContractAmount
	}
	if input.Status != "" {
		updates["status"] = input.Status
	}
	if input.Region != "" {
		updates["region"] = input.Region
	}
	if err := h.DB.Model(&HistoricalLot{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}
