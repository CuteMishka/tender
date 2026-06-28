package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type NotificationDTO struct {
	ID        int    `json:"id"`
	Type      string `json:"type"`
	Category  string `json:"category"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
	Link      string `json:"link,omitempty"`
}

type notificationsListResponse struct {
	Items []NotificationDTO      `json:"items"`
	Meta  map[string]interface{} `json:"meta,omitempty"`
}

type parserNotificationRow struct {
	ID          int            `gorm:"column:id"`
	LotStableID sql.NullString `gorm:"column:lot_stable_id"`
	Type        string         `gorm:"column:type"`
	Category    string         `gorm:"column:category"`
	Title       string         `gorm:"column:title"`
	Message     string         `gorm:"column:message"`
	CreatedAt   time.Time      `gorm:"column:created_at"`
	TenderID    sql.NullInt64  `gorm:"column:tender_id"`
}

func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = min(parsed, 200)
		}
	}
	afterID := 0
	if raw := r.URL.Query().Get("after"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			afterID = parsed
		}
	}

	var exists bool
	if err := h.DB.Raw("SELECT to_regclass('parser_notifications') IS NOT NULL").Scan(&exists).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка проверки уведомлений")
		return
	}
	if !exists {
		writeNotifications(w, nil, 0)
		return
	}

	query := `
		SELECT n.id, n.lot_stable_id, n.type, n.category, n.title, n.message, n.created_at, l.id AS tender_id
		FROM parser_notifications n
		LEFT JOIN parser_lots l ON l.stable_id = n.lot_stable_id
		WHERE (? = 0 OR n.id > ?)
		ORDER BY n.id DESC
		LIMIT ?
	`
	var rows []parserNotificationRow
	if err := h.DB.Raw(query, afterID, afterID, limit).Scan(&rows).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка получения уведомлений")
		return
	}

	items := make([]NotificationDTO, 0, len(rows))
	maxID := afterID
	for _, row := range rows {
		if row.ID > maxID {
			maxID = row.ID
		}
		items = append(items, notificationDTO(row))
	}
	writeNotifications(w, items, maxID)
}

func writeNotifications(w http.ResponseWriter, items []NotificationDTO, maxID int) {
	if items == nil {
		items = []NotificationDTO{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(notificationsListResponse{
		Items: items,
		Meta:  map[string]interface{}{"maxId": maxID},
	})
}

func notificationDTO(row parserNotificationRow) NotificationDTO {
	link := ""
	if row.TenderID.Valid && row.TenderID.Int64 > 0 {
		link = "/tenders/" + strconv.FormatInt(row.TenderID.Int64, 10)
	}
	return NotificationDTO{
		ID:        row.ID,
		Type:      normalizeNotificationType(row.Type),
		Category:  normalizeNotificationCategory(row.Category),
		Title:     strings.TrimSpace(row.Title),
		Message:   strings.TrimSpace(row.Message),
		CreatedAt: row.CreatedAt.Format(time.RFC3339),
		Link:      link,
	}
}

func normalizeNotificationType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "success", "warning", "error", "info":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "info"
	}
}

func normalizeNotificationCategory(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "deadline", "appeal", "updates", "mentions", "review":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "updates"
	}
}
