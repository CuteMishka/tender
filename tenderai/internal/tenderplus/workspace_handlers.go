package tenderplus

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dauren/tender/internal/authctx"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type createCommentInput struct {
	Body string `json:"body"`
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
		if !ok || !ensureSavedLotExists(w, r, db, lotID) {
			return
		}
		var items []TenderActivity
		if err := db.WithContext(r.Context()).Where("saved_lot_id = ?", lotID).Order("created_at desc").Limit(80).Find(&items).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения истории")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, items)
	}
}

func ListLotCommentsHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok || !ensureSavedLotExists(w, r, db, lotID) {
			return
		}
		var items []TenderComment
		if err := db.WithContext(r.Context()).Where("saved_lot_id = ?", lotID).Order("created_at desc").Find(&items).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения комментариев")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, items)
	}
}

func CreateLotCommentHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, err := workspaceIdentity(r)
		if err != nil {
			writeWorkspaceRequestError(w, err, "Доступ запрещен")
			return
		}
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var input createCommentInput
		if err := decodeWorkspaceJSON(w, r, &input); err != nil {
			writeWorkspaceError(w, http.StatusBadRequest, "Неверный формат комментария")
			return
		}
		body := strings.TrimSpace(input.Body)
		if body == "" {
			writeWorkspaceError(w, http.StatusBadRequest, "Комментарий пустой")
			return
		}
		if len([]rune(body)) > 10_000 {
			writeWorkspaceError(w, http.StatusBadRequest, "Комментарий слишком длинный")
			return
		}

		var item TenderComment
		err = db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			lot, err := loadAuthorizedSavedLot(tx, lotID, identity)
			if err != nil {
				return err
			}
			now := time.Now().UTC()
			item = buildTenderComment(lot.ID, body, identity, now)
			if err := tx.Create(&item).Error; err != nil {
				return err
			}
			return tx.Create(&TenderActivity{
				SavedLotID:  lot.ID,
				Action:      "comment_added",
				Actor:       identity.Name,
				ActorUserID: identity.UserID,
				Message:     body,
				CreatedAt:   now,
			}).Error
		})
		if err != nil {
			writeWorkspaceRequestError(w, err, "Ошибка сохранения комментария")
			return
		}
		writeWorkspaceJSON(w, http.StatusCreated, item)
	}
}

func buildTenderComment(lotID uint, body string, identity authctx.Identity, now time.Time) TenderComment {
	return TenderComment{
		SavedLotID:   lotID,
		Author:       identity.Name,
		AuthorUserID: identity.UserID,
		Body:         strings.TrimSpace(body),
		CreatedAt:    now,
	}
}

func ListLotTasksHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lotID, ok := lotIDFromRequest(w, r)
		if !ok || !ensureSavedLotExists(w, r, db, lotID) {
			return
		}
		var items []TenderTask
		if err := db.WithContext(r.Context()).Where("saved_lot_id = ?", lotID).Order("status asc, due_date asc nulls last, created_at desc").Find(&items).Error; err != nil {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения задач")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, items)
	}
}

func CreateLotTaskHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, err := workspaceIdentity(r)
		if err != nil {
			writeWorkspaceRequestError(w, err, "Доступ запрещен")
			return
		}
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		var input createTaskInput
		if err := decodeWorkspaceJSON(w, r, &input); err != nil {
			writeWorkspaceError(w, http.StatusBadRequest, "Неверный формат задачи")
			return
		}
		title := strings.TrimSpace(input.Title)
		if title == "" || len([]rune(title)) > 500 {
			writeWorkspaceError(w, http.StatusBadRequest, "Некорректное название задачи")
			return
		}
		priorityValue := input.Priority
		priority, err := requestedPriority(&priorityValue, "normal")
		if err != nil {
			writeWorkspaceRequestError(w, err, "Некорректный приоритет")
			return
		}
		dueDate, err := parseOptionalDate(input.DueDate)
		if err != nil {
			writeWorkspaceRequestError(w, err, "Некорректная дата")
			return
		}

		var item TenderTask
		err = db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			lot, err := loadAuthorizedSavedLot(tx, lotID, identity)
			if err != nil {
				return err
			}
			assignee, err := requestedTaskAssignee(identity, lot, "", input.Assignee)
			if err != nil {
				return err
			}
			if len([]rune(assignee)) > 255 {
				return newWorkspaceRequestError(http.StatusBadRequest, "Имя исполнителя слишком длинное")
			}
			now := time.Now().UTC()
			item = TenderTask{
				SavedLotID:      lot.ID,
				Title:           title,
				Status:          "open",
				Assignee:        assignee,
				Priority:        priority,
				DueDate:         dueDate,
				CreatedByUserID: identity.UserID,
				UpdatedByUserID: identity.UserID,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			if err := tx.Create(&item).Error; err != nil {
				return err
			}
			return tx.Create(&TenderActivity{
				SavedLotID:  lot.ID,
				Action:      "task_created",
				Actor:       identity.Name,
				ActorUserID: identity.UserID,
				Message:     title,
				CreatedAt:   now,
			}).Error
		})
		if err != nil {
			writeWorkspaceRequestError(w, err, "Ошибка сохранения задачи")
			return
		}
		writeWorkspaceJSON(w, http.StatusCreated, item)
	}
}

func UpdateLotTaskHandler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, err := workspaceIdentity(r)
		if err != nil {
			writeWorkspaceRequestError(w, err, "Доступ запрещен")
			return
		}
		lotID, ok := lotIDFromRequest(w, r)
		if !ok {
			return
		}
		taskID, err := strconv.ParseUint(chi.URLParam(r, "taskId"), 10, 64)
		if err != nil || taskID == 0 {
			writeWorkspaceError(w, http.StatusBadRequest, "Некорректный ID задачи")
			return
		}
		var input updateTaskInput
		if err := decodeWorkspaceJSON(w, r, &input); err != nil {
			writeWorkspaceError(w, http.StatusBadRequest, "Неверный формат задачи")
			return
		}

		var task TenderTask
		err = db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			lot, err := loadAuthorizedSavedLot(tx, lotID, identity)
			if err != nil {
				return err
			}
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("saved_lot_id = ? AND id = ?", lotID, taskID).First(&task).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return newWorkspaceRequestError(http.StatusNotFound, "Задача не найдена")
				}
				return err
			}
			if input.Title != nil {
				title := strings.TrimSpace(*input.Title)
				if title == "" || len([]rune(title)) > 500 {
					return newWorkspaceRequestError(http.StatusBadRequest, "Некорректное название задачи")
				}
				task.Title = title
			}
			if input.Status != nil {
				status, err := requestedTaskStatus(*input.Status)
				if err != nil {
					return err
				}
				task.Status = status
			}
			if input.Assignee != nil {
				assignee, err := requestedTaskAssignee(identity, lot, task.Assignee, *input.Assignee)
				if err != nil {
					return err
				}
				if len([]rune(assignee)) > 255 {
					return newWorkspaceRequestError(http.StatusBadRequest, "Имя исполнителя слишком длинное")
				}
				task.Assignee = assignee
			}
			if input.Priority != nil {
				priority, err := requestedPriority(input.Priority, task.Priority)
				if err != nil {
					return err
				}
				task.Priority = priority
			}
			if input.DueDate != nil {
				dueDate, err := parseOptionalDate(*input.DueDate)
				if err != nil {
					return err
				}
				task.DueDate = dueDate
			}
			now := time.Now().UTC()
			task.UpdatedByUserID = identity.UserID
			task.UpdatedAt = now
			if err := tx.Save(&task).Error; err != nil {
				return err
			}
			return tx.Create(&TenderActivity{
				SavedLotID:  lot.ID,
				Action:      "task_updated",
				Status:      task.Status,
				Actor:       identity.Name,
				ActorUserID: identity.UserID,
				Message:     task.Title,
				CreatedAt:   now,
			}).Error
		})
		if err != nil {
			writeWorkspaceRequestError(w, err, "Ошибка обновления задачи")
			return
		}
		writeWorkspaceJSON(w, http.StatusOK, task)
	}
}

func ensureSavedLotExists(w http.ResponseWriter, r *http.Request, db *gorm.DB, lotID uint) bool {
	var lot SavedLot
	if err := db.WithContext(r.Context()).Select("id").First(&lot, lotID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeWorkspaceError(w, http.StatusNotFound, "Лот не найден")
		} else {
			writeWorkspaceError(w, http.StatusInternalServerError, "Ошибка получения лота")
		}
		return false
	}
	return true
}

func loadAuthorizedSavedLot(tx *gorm.DB, lotID uint, identity authctx.Identity) (SavedLot, error) {
	var lot SavedLot
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&lot, lotID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return SavedLot{}, newWorkspaceRequestError(http.StatusNotFound, "Лот не найден")
		}
		return SavedLot{}, err
	}
	if err := authorizeSavedLotMutation(lot, identity); err != nil {
		return SavedLot{}, err
	}
	return lot, nil
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

func requestedTaskStatus(status string) (string, error) {
	switch strings.TrimSpace(status) {
	case "open", "done", "cancelled":
		return strings.TrimSpace(status), nil
	default:
		return "", newWorkspaceRequestError(http.StatusBadRequest, "Некорректный статус задачи")
	}
}

func parseOptionalDate(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			parsed = parsed.UTC()
			return &parsed, nil
		}
	}
	return nil, newWorkspaceRequestError(http.StatusBadRequest, "Некорректная дата")
}

func writeWorkspaceError(w http.ResponseWriter, status int, message string) {
	writeWorkspaceJSON(w, status, map[string]string{"error": message})
}

func writeWorkspaceJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
