package tenderplus

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

// ParticipateLotHandler обрабатывает нажатие "Подходит" / "Не подходит"
func ParticipateLotHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input SavedLot
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, `{"error":"Неверный формат данных"}`, http.StatusBadRequest)
			return
		}

		if !isSavedLotStatus(input.Status) {
			input.Status = "participating"
		}
		rawPriority := strings.TrimSpace(input.Priority)
		rawRiskLevel := strings.TrimSpace(input.RiskLevel)
		now := time.Now()
		if input.ID != 0 {
			var existing SavedLot
			if err := db.Select("created_at", "priority", "risk_level", "next_step").First(&existing, input.ID).Error; err == nil && validSavedLotTime(existing.CreatedAt) {
				input.CreatedAt = existing.CreatedAt
				if rawPriority == "" {
					input.Priority = normalizeSavedLotChoice(existing.Priority, "normal")
				}
				if rawRiskLevel == "" {
					input.RiskLevel = normalizeSavedLotChoice(existing.RiskLevel, "medium")
				}
				if strings.TrimSpace(input.NextStep) == "" {
					input.NextStep = existing.NextStep
				}
			}
		}
		input.Priority = normalizeSavedLotChoice(input.Priority, "normal")
		input.RiskLevel = normalizeSavedLotChoice(input.RiskLevel, "medium")
		if !validSavedLotTime(input.CreatedAt) {
			input.CreatedAt = now
		}
		input.UpdatedAt = now
		entry := map[string]string{
			"status":     input.Status,
			"comment":    input.Comment,
			"assignedTo": input.AssignedTo,
			"reviewer":   input.Reviewer,
			"at":         time.Now().Format(time.RFC3339),
		}
		historyEntries := []map[string]string{}
		if input.ActionHistory != "" {
			_ = json.Unmarshal([]byte(input.ActionHistory), &historyEntries)
		}
		historyEntries = append(historyEntries, entry)
		history, _ := json.Marshal(historyEntries)
		input.ActionHistory = string(history)

		if err := db.Save(&input).Error; err != nil {
			http.Error(w, `{"error":"Ошибка сохранения лота"}`, http.StatusInternalServerError)
			return
		}
		_ = db.Create(&TenderActivity{
			SavedLotID: input.ID,
			Action:     "status_changed",
			Status:     input.Status,
			Actor:      firstNonEmpty(input.Reviewer, input.AssignedTo),
			Message:    input.Comment,
			CreatedAt:  now,
		}).Error

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(input)
	}
}

func isSavedLotStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "active", "review", "assignment_requested", "in_work", "participating", "submitted", "waiting_result", "won", "lost", "rejected", "archived":
		return true
	default:
		return false
	}
}

func normalizeSavedLotChoice(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func validSavedLotTime(value time.Time) bool {
	return !value.IsZero() && value.Year() >= 2000
}

// GetSavedLotsHandler возвращает список сохраненных лотов для вкладки "Заявки"
func GetSavedLotsHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var lots []SavedLot
		q := db.Order("created_at desc")
		if status := r.URL.Query().Get("status"); status != "" {
			q = q.Where("status = ?", status)
		}
		if err := q.Find(&lots).Error; err != nil {
			http.Error(w, `{"error":"Ошибка получения лотов"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lots)
	}
}

// DeleteSavedLotHandler удаляет сохраненный лот из вкладки "Заявки"
func DeleteSavedLotHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, `{"error":"ID не указан"}`, http.StatusBadRequest)
			return
		}
		if err := db.Delete(&SavedLot{}, id).Error; err != nil {
			http.Error(w, `{"error":"Ошибка удаления лота"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
	}
}
