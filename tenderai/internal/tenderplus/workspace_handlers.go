package tenderplus

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type createCommentInput struct {
	Author string `json:"author"`
	Body   string `json:"body"`
}

type createTaskInput struct {
	Title    string `json:"title"`
	Assignee string `json:"assignee"`
	Priority string `json:"priority"`
	DueDate  string `json:"due_date"`
}

type updateTaskInput struct {
	Title    *string `json:"title"`
	Status   *string `json:"status"`
	Assignee *string `json:"assignee"`
	Priority *string `json:"priority"`
	DueDate  *string `json:"due_date"`
}

func ListLotActivityHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var items []TenderActivity
		if err := db.Where("saved_lot_id = ?", lotID).Order("created_at desc").Limit(80).Find(&items).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения истории")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, items)
	}
}

func ListLotCommentsHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var items []TenderComment
		if err := db.Where("saved_lot_id = ?", lotID).Order("created_at desc").Find(&items).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения комментариев")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, items)
	}
}

func CreateLotCommentHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var input createCommentInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeWorkspaceError(w, http.StatusBadRequest, "Неверный формат комментария")
			return
		}
		body := strings.TrimSpace(input.Body)
		if body == "" {
			writeWorkspaceError(w, http.StatusBadRequest, "Комментарий пустой")
			return
		}
		item := TenderComment{
			SavedLotID: lotID,
			Author:     firstNonEmpty(input.Author, "Пользователь"),
			Body:       body,
			CreatedAt:  time.Now(),
		}
		if err := db.Create(&item).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка сохранения комментария")
			return
		}
		_ = db.Create(&TenderActivity{
			SavedLotID: lotID,
			Action:     "comment_added",
			Actor:      item.Author,
			Message:    body,
			CreatedAt:  item.CreatedAt,
		}).Error
		writeWorkspaceJSON(w, http.StatusCreated, item)
	}
}

func ListLotTasksHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var items []TenderTask
		if err := db.Where("saved_lot_id = ?", lotID).Order("status asc, due_date asc nulls last, created_at desc").Find(&items).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения задач")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, items)
	}
}

func CreateLotTaskHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var input createTaskInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeWorkspaceError(w, http.StatusBadRequest, "Неверный формат задачи")
			return
		}
		title := strings.TrimSpace(input.Title)
		if title == "" {
			writeWorkspaceError(w, http.StatusBadRequest, "Название задачи пустое")
			return
		}
		now := time.Now()
		item := TenderTask{
			SavedLotID: lotID,
			Title:      title,
			Status:     "open",
			Assignee:   strings.TrimSpace(input.Assignee),
			Priority:   normalizeSavedLotChoice(input.Priority, "normal"),
			DueDate:    parseOptionalDate(input.DueDate),
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := db.Create(&item).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка сохранения задачи")
			return
		}
		_ = db.Create(&TenderActivity{
			SavedLotID: lotID,
			Action:     "task_created",
			Actor:      item.Assignee,
			Message:    title,
			CreatedAt:  now,
		}).Error
		writeWorkspaceJSON(w, http.StatusCreated, item)
	}
}

func UpdateLotTaskHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		taskID, err := strconv.ParseUint(chi.URLParam(r, "taskId"), 10, 64)
		if err != nil || taskID == 0 {
			writeWorkspaceError(w, http.StatusBadRequest, "Некорректный ID задачи")
			return
		}

		var task TenderTask
		if err := db.Where("saved_lot_id = ? AND id = ?", lotID, taskID).First(&task).Error; err != nil {
			writeWorkspaceError(w, http.StatusNotFound, "Задача не найдена")
			return
		}
		var input updateTaskInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeWorkspaceError(w, http.StatusBadRequest, "Неверный формат задачи")
			return
		}
		updates := map[string]interface{}{"updated_at": time.Now()}
		if input.Title != nil {
			if title := strings.TrimSpace(*input.Title); title != "" {
				updates["title"] = title
			}
		}
		if input.Status != nil {
			status := normalizeTaskStatus(*input.Status)
			updates["status"] = status
		}
		if input.Assignee != nil {
			updates["assignee"] = strings.TrimSpace(*input.Assignee)
		}
		if input.Priority != nil {
			updates["priority"] = normalizeSavedLotChoice(*input.Priority, "normal")
		}
		if input.DueDate != nil {
			updates["due_date"] = parseOptionalDate(*input.DueDate)
		}
		if err := db.Model(&task).Updates(updates).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка обновления задачи")
			return
		}
		if err := db.First(&task, task.ID).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения задачи")
			return
		}
		_ = db.Create(&TenderActivity{
			SavedLotID: lotID,
			Action:     "task_updated",
			Status:     task.Status,
			Actor:      task.Assignee,
			Message:    task.Title,
			CreatedAt:  time.Now(),
		}).Error
		writeWorkspaceJSON(w, http.StatusOK, task)
	}
}

func lotIDFromRequest(w http.ResponseWriter, r *http.Request) (uint, bool) {
	raw := chi.URLParam(r, "id")
	lotID, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || lotID == 0 {
		writeWorkspaceError(w, http.StatusBadRequest, "Некорректный ID тендера")
		return 0, false
	}
	return uint(lotID), true
}

func normalizeTaskStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "done", "cancelled":
		return strings.TrimSpace(status)
	default:
		return "open"
	}
}

func parseOptionalDate(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return &parsed
		}
	}
	return nil
}

func writeWorkspaceError(w http.ResponseWriter, status int, message string) {
	writeWorkspaceJSON(w, status, map[string]string{"error": message})
}

func writeWorkspaceJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
