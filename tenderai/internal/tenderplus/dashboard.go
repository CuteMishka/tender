package tenderplus

import (
	"encoding/json"
	"net/http"

	"gorm.io/gorm"
)

// DashboardStats описывает структуру ответа для фронтенда
type DashboardStats struct {
	ActiveCount         int64   `json:"active_count"`          // Активные тендера = кол-во
	ParticipatingCount  int64   `json:"participating_count"`   // Участвуем тендеров = кол-во
	TotalAmount         float64 `json:"total_amount"`          // Объём контрактов = всего сумма
	ParticipatingAmount float64 `json:"participating_amount"`  // Объём контрактов участвуем = сумма
}

// GetDashboardStats делает один эффективный запрос к PostgreSQL для сбора всей статистики
func GetDashboardStats(db *gorm.DB) (*DashboardStats, error) {
	var stats DashboardStats

	// Используем PostgreSQL конструкцию FILTER (WHERE ...) для подсчета всех метрик за один проход.
	// ВАЖНО: замени 'lots' на реальное имя твоей таблицы (например, 'tenders'), 
	// а 'amount' и 'status' на реальные названия колонок.
	query := `
		SELECT 
			COUNT(*) FILTER (WHERE status = 'active') AS active_count,
			COUNT(*) FILTER (WHERE status = 'participating') AS participating_count,
			COALESCE(SUM(amount), 0) AS total_amount,
			COALESCE(SUM(amount) FILTER (WHERE status = 'participating'), 0) AS participating_amount
		FROM saved_lots
	`

	err := db.Raw(query).Scan(&stats).Error
	if err != nil {
		return nil, err
	}

	return &stats, nil
}

// DashboardHandler обрабатывает GET /api/v1/dashboard
func DashboardHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := GetDashboardStats(db)
		if err != nil {
			http.Error(w, `{"error": "Не удалось загрузить статистику"}`, http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	}
}