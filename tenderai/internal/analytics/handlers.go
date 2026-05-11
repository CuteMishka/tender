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

func fillCustomerFallback(lots []HistoricalLot) {
	for i := range lots {
		if strings.TrimSpace(lots[i].CustomerName) == "" {
			lots[i].CustomerName = lots[i].OrganizerName
		}
	}
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
		like := "%" + v + "%"
		q = q.Where(
			"customer_name ILIKE ? OR organizer_name ILIKE ? OR title ILIKE ? OR description ILIKE ? OR purchase_type ILIKE ? OR region ILIKE ? OR winner_name ILIKE ?",
			like, like, like, like, like, like, like,
		)
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
	if r.URL.Query().Get("participation") == "our" {
		q = q.Where("status IN ?", []string{"participating", "won", "lost", "submitted"})
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
	fillCustomerFallback(lots)

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

func (h *Handler) ListCustomerCandidates(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 && n <= 200 {
			limit = n
		}
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	rows := make([]CustomerCandidate, 0)
	q := h.DB.Model(&HistoricalLot{}).
		Select(`
			COALESCE(NULLIF(customer_name, ''), organizer_name) AS customer_name,
			MAX(customer_id) AS customer_id,
			COUNT(*) AS tender_count,
			MAX(end_date) AS last_tender_at,
			COALESCE(SUM(initial_amount),0) AS total_budget
		`).
		Where("customer_name != '' OR organizer_name != ''").
		Group("COALESCE(NULLIF(customer_name, ''), organizer_name)").
		Order("tender_count DESC, total_budget DESC").
		Limit(limit)
	if search != "" {
		q = q.Where("customer_name ILIKE ? OR organizer_name ILIKE ?", "%"+search+"%", "%"+search+"%")
	}
	q.Scan(&rows)

	tracked := make([]TrackedCustomer, 0)
	h.DB.Find(&tracked)
	byName := map[string]TrackedCustomer{}
	for _, c := range tracked {
		byName[strings.ToLower(strings.TrimSpace(c.CustomerName))] = c
	}
	for i := range rows {
		if c, ok := byName[strings.ToLower(strings.TrimSpace(rows[i].CustomerName))]; ok {
			rows[i].IsTracked = true
			rows[i].IsFavorite = c.IsFavorite
		}
	}
	writeJSON(w, rows)
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
		q := h.DB.Model(&HistoricalLot{})
		if strings.TrimSpace(customers[i].CustomerID) != "" {
			q = q.Where("customer_id = ? OR customer_name ILIKE ? OR organizer_name ILIKE ?", customers[i].CustomerID, "%"+customers[i].CustomerName+"%", "%"+customers[i].CustomerName+"%")
		} else {
			q = q.Where("customer_name ILIKE ? OR organizer_name ILIKE ?", "%"+customers[i].CustomerName+"%", "%"+customers[i].CustomerName+"%")
		}
		q.Count(&count)
		q.Select("COALESCE(SUM(initial_amount),0)").Scan(&total)
		q.Select("MAX(end_date)").Scan(&lastDate)
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
	input.IsFavorite = true
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

func (h *Handler) UpdateCustomer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input TrackedCustomer
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Неверный формат данных")
		return
	}
	var customer TrackedCustomer
	if err := h.DB.First(&customer, id).Error; err != nil {
		writeError(w, http.StatusNotFound, "Заказчик не найден")
		return
	}
	if strings.TrimSpace(input.CustomerName) != "" {
		customer.CustomerName = strings.TrimSpace(input.CustomerName)
	}
	customer.CustomerID = input.CustomerID
	customer.NotifyEmail = input.NotifyEmail
	customer.Notes = input.Notes
	customer.IsFavorite = input.IsFavorite
	if err := h.DB.Save(&customer).Error; err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, customer)
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
	q := h.DB.Where("customer_name ILIKE ? OR organizer_name ILIKE ?", "%"+customer.CustomerName+"%", "%"+customer.CustomerName+"%")
	if strings.TrimSpace(customer.CustomerID) != "" {
		q = h.DB.Where("customer_id = ? OR customer_name ILIKE ? OR organizer_name ILIKE ?", customer.CustomerID, "%"+customer.CustomerName+"%", "%"+customer.CustomerName+"%")
	}
	q.
		Order("end_date DESC NULLS LAST").
		Limit(200).
		Find(&lots)
	fillCustomerFallback(lots)
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
