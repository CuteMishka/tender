package tenderplus

import (
	"encoding/json"
	"net/http"
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

		if input.Status != "participating" && input.Status != "rejected" && input.Status != "active" && input.Status != "review" && input.Status != "in_work" {
			input.Status = "participating"
		}
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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(input)
	}
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