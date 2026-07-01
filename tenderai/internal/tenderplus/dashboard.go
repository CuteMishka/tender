package tenderplus

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// DashboardStats описывает структуру ответа для фронтенда
type DashboardStats struct {
	ActiveCount         int64   `json:"active_count"`         // Активные тендера = кол-во
	ParticipatingCount  int64   `json:"participating_count"`  // Участвуем тендеров = кол-во
	TotalAmount         float64 `json:"total_amount"`         // Объём контрактов = всего сумма
	ParticipatingAmount float64 `json:"participating_amount"` // Объём контрактов участвуем = сумма
}

type DashboardDynamicsPoint struct {
	Date         string `json:"date"`
	Label        string `json:"label"`
	Count        int64  `json:"count"`
	CreatedCount int64  `json:"created_count"`
	UpdatedCount int64  `json:"updated_count"`
}

// GetDashboardStats делает один эффективный запрос к PostgreSQL для сбора всей статистики
func GetDashboardStats(db *gorm.DB) (*DashboardStats, error) {
	var stats DashboardStats

	query := `
		SELECT
			saved.active_count,
			saved.participating_count,
			monitoring.total_amount,
			saved.participating_amount
		FROM (
			SELECT
				COUNT(*) FILTER (WHERE status = 'active') AS active_count,
				COUNT(*) FILTER (WHERE status = 'participating') AS participating_count,
				COALESCE(SUM(amount) FILTER (WHERE status = 'participating'), 0) AS participating_amount
			FROM saved_lots
		) saved
		CROSS JOIN (
			SELECT COALESCE(SUM(contract_amount) FILTER (
				WHERE contract_amount > 0
				  AND COALESCE(excluded_from_analytics, false) = false
			), 0) AS total_amount
			FROM historical_lots
		) monitoring
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

func GetDashboardDynamics(db *gorm.DB, days int, allTime bool) ([]DashboardDynamicsPoint, error) {
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if !allTime {
		if days <= 0 {
			days = 7
		}
		if days > 3660 {
			days = 3660
		}
	}
	start := today.AddDate(0, 0, -(days - 1))
	if allTime {
		type minRow struct {
			First *time.Time `gorm:"column:first"`
		}
		var first minRow
		query := `
			WITH normalized AS (
				SELECT
					CASE
						WHEN created_at >= TIMESTAMP '2000-01-01' THEN created_at
						ELSE updated_at
					END AS created_effective,
					updated_at
				FROM saved_lots
			),
			events AS (
				SELECT created_effective AS event_at
				FROM normalized
				WHERE created_effective >= TIMESTAMP '2000-01-01'
				UNION ALL
				SELECT updated_at AS event_at
				FROM normalized
				WHERE updated_at >= TIMESTAMP '2000-01-01'
				  AND DATE(updated_at) <> DATE(created_effective)
			)
			SELECT MIN(event_at) AS first
			FROM events
		`
		if err := db.Raw(query).Scan(&first).Error; err != nil {
			return nil, err
		}
		if first.First == nil {
			return []DashboardDynamicsPoint{}, nil
		}
		start = time.Date(first.First.Year(), first.First.Month(), first.First.Day(), 0, 0, 0, 0, first.First.Location())
		days = int(today.Sub(start).Hours()/24) + 1
		if days < 1 {
			days = 1
		}
	}
	type row struct {
		Day          time.Time `gorm:"column:day"`
		Count        int64     `gorm:"column:count"`
		CreatedCount int64     `gorm:"column:created_count"`
		UpdatedCount int64     `gorm:"column:updated_count"`
	}
	rows := make([]row, 0, days)
	query := `
		WITH normalized AS (
			SELECT
				CASE
					WHEN created_at >= TIMESTAMP '2000-01-01' THEN created_at
					ELSE updated_at
				END AS created_effective,
				updated_at
			FROM saved_lots
		),
		events AS (
			SELECT created_effective AS event_at, 1 AS created_count, 0 AS updated_count
			FROM normalized
			WHERE created_effective >= TIMESTAMP '2000-01-01'
			UNION ALL
			SELECT updated_at AS event_at, 0 AS created_count, 1 AS updated_count
			FROM normalized
			WHERE updated_at >= TIMESTAMP '2000-01-01'
			  AND DATE(updated_at) <> DATE(created_effective)
		)
		SELECT
			DATE(event_at) AS day,
			COUNT(*) AS count,
			COALESCE(SUM(created_count), 0) AS created_count,
			COALESCE(SUM(updated_count), 0) AS updated_count
		FROM events
		WHERE event_at >= ?
		GROUP BY day
		ORDER BY day ASC
	`
	if err := db.Raw(query, start).Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	createdCounts := make(map[string]int64, len(rows))
	updatedCounts := make(map[string]int64, len(rows))
	for _, row := range rows {
		key := row.Day.Format("2006-01-02")
		counts[key] = row.Count
		createdCounts[key] = row.CreatedCount
		updatedCounts[key] = row.UpdatedCount
	}
	out := make([]DashboardDynamicsPoint, 0, days)
	for i := 0; i < days; i++ {
		day := start.AddDate(0, 0, i)
		key := day.Format("2006-01-02")
		out = append(out, DashboardDynamicsPoint{
			Date:         key,
			Label:        day.Format("02.01"),
			Count:        counts[key],
			CreatedCount: createdCounts[key],
			UpdatedCount: updatedCounts[key],
		})
	}
	return out, nil
}

func DashboardDynamicsHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days := 7
		allTime := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("range")), "all")
		if raw := r.URL.Query().Get("days"); raw != "" {
			if strings.EqualFold(strings.TrimSpace(raw), "all") {
				allTime = true
			} else if value, err := strconv.Atoi(raw); err == nil && value > 0 {
				days = value
			}
		}
		points, err := GetDashboardDynamics(db, days, allTime)
		if err != nil {
			http.Error(w, `{"error": "Не удалось загрузить динамику"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(points)
	}
}
