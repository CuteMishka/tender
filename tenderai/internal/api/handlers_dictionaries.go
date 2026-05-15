package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/dauren/tender/internal/domain"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type DictionaryItemDTO struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Value     string `json:"value"`
	Active    bool   `json:"active"`
	LastLot   string `json:"lastLot,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type DictionarySaveRequest struct {
	Kind    string `json:"kind"`
	Value   string `json:"value"`
	Active  *bool  `json:"active"`
	LastLot string `json:"lastLot"`
}

var allowedDictionaryKinds = map[string]bool{
	"advantages": true,
	"blockers":   true,
	"keywords":   true,
	"tru":        true,
	"companies":  true,
}

func (h *Handler) ListDictionaries(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	kind := normalizeDictionaryKind(r.URL.Query().Get("kind"))
	if kind != "" && !allowedDictionaryKinds[kind] {
		writeJSONError(w, http.StatusBadRequest, "неизвестный тип справочника")
		return
	}
	query := h.DB.Model(&domain.DictionaryItem{})
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	var rows []domain.DictionaryItem
	if err := query.Order("kind asc, value asc, id asc").Find(&rows).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка получения справочника")
		return
	}
	items := make([]DictionaryItemDTO, 0, len(rows))
	keywords := make([]string, 0)
	for _, row := range rows {
		items = append(items, dictionaryItemDTO(row))
		if row.Kind == "keywords" && row.Active {
			keywords = append(keywords, row.Value)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"items":    items,
		"data":     items,
		"keywords": keywords,
	})
}

func (h *Handler) GetDictionaryItem(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	id, ok := parseDictionaryID(w, r)
	if !ok {
		return
	}
	var row domain.DictionaryItem
	if err := h.DB.First(&row, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeJSONError(w, http.StatusNotFound, "значение не найдено")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "ошибка получения значения")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dictionaryItemDTO(row))
}

func (h *Handler) CreateDictionaryItem(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	var req DictionarySaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "некорректный JSON")
		return
	}
	kind, value, ok := normalizeDictionaryPayload(req.Kind, req.Value)
	if !ok {
		writeJSONError(w, http.StatusBadRequest, "kind и value обязательны")
		return
	}
	if !allowedDictionaryKinds[kind] {
		writeJSONError(w, http.StatusBadRequest, "неизвестный тип справочника")
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	row := domain.DictionaryItem{Kind: kind, Value: value, Active: active, LastLot: strings.TrimSpace(req.LastLot)}
	if err := h.DB.Create(&row).Error; err != nil {
		if isUniqueViolation(err) {
			writeJSONError(w, http.StatusConflict, "значение уже есть в справочнике")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "ошибка создания значения")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(dictionaryItemDTO(row))
}

func (h *Handler) UpdateDictionaryItem(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	id, ok := parseDictionaryID(w, r)
	if !ok {
		return
	}
	var row domain.DictionaryItem
	if err := h.DB.First(&row, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeJSONError(w, http.StatusNotFound, "значение не найдено")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "ошибка получения значения")
		return
	}
	var req DictionarySaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "некорректный JSON")
		return
	}
	if strings.TrimSpace(req.Kind) != "" {
		row.Kind = normalizeDictionaryKind(req.Kind)
	}
	if strings.TrimSpace(req.Value) != "" {
		row.Value = normalizeDictionaryValue(req.Value)
	}
	if req.Active != nil {
		row.Active = *req.Active
	}
	row.LastLot = strings.TrimSpace(req.LastLot)
	if row.Kind == "" || row.Value == "" {
		writeJSONError(w, http.StatusBadRequest, "kind и value обязательны")
		return
	}
	if !allowedDictionaryKinds[row.Kind] {
		writeJSONError(w, http.StatusBadRequest, "неизвестный тип справочника")
		return
	}
	if err := h.DB.Save(&row).Error; err != nil {
		if isUniqueViolation(err) {
			writeJSONError(w, http.StatusConflict, "значение уже есть в справочнике")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "ошибка обновления значения")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dictionaryItemDTO(row))
}

func (h *Handler) DeleteDictionaryItem(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	id, ok := parseDictionaryID(w, r)
	if !ok {
		return
	}
	result := h.DB.Delete(&domain.DictionaryItem{}, id)
	if result.Error != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка удаления значения")
		return
	}
	if result.RowsAffected == 0 {
		writeJSONError(w, http.StatusNotFound, "значение не найдено")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func dictionaryItemDTO(row domain.DictionaryItem) DictionaryItemDTO {
	return DictionaryItemDTO{
		ID:        stringID(row.ID),
		Kind:      row.Kind,
		Value:     row.Value,
		Active:    row.Active,
		LastLot:   row.LastLot,
		CreatedAt: row.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: row.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func normalizeDictionaryPayload(kind string, value string) (string, string, bool) {
	k := normalizeDictionaryKind(kind)
	v := normalizeDictionaryValue(value)
	return k, v, k != "" && v != ""
}

func normalizeDictionaryKind(kind string) string {
	return strings.ToLower(strings.TrimSpace(kind))
}

func normalizeDictionaryValue(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func stringID(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}

func parseDictionaryID(w http.ResponseWriter, r *http.Request) (uint, bool) {
	raw := strings.TrimSpace(chi.URLParam(r, "id"))
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		writeJSONError(w, http.StatusBadRequest, "некорректный ID")
		return 0, false
	}
	return uint(id), true
}

func isUniqueViolation(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "duplicate key") || strings.Contains(message, "unique constraint")
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
