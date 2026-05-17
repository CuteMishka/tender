package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dauren/tender/internal/domain"
	"gorm.io/gorm/clause"
)

type TelegramSettingsDTO struct {
	Enabled     bool   `json:"enabled"`
	Configured  bool   `json:"configured"`
	ChatID      string `json:"chatId"`
	Username    string `json:"username,omitempty"`
	MaskedToken string `json:"maskedToken,omitempty"`
}

type TelegramSettingsRequest struct {
	Enabled  bool   `json:"enabled"`
	BotToken string `json:"botToken"`
	ChatID   string `json:"chatId"`
	Username string `json:"username"`
}

type telegramUpdatesResponse struct {
	OK     bool `json:"ok"`
	Result []struct {
		Message *struct {
			Chat struct {
				ID       int64  `json:"id"`
				Username string `json:"username"`
			} `json:"chat"`
			From *struct {
				ID       int64  `json:"id"`
				Username string `json:"username"`
			} `json:"from"`
		} `json:"message"`
	} `json:"result"`
}

func (h *Handler) GetTelegramSettings(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	settings := h.loadTelegramSettings()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(telegramSettingsDTO(settings))
}

func (h *Handler) UpdateTelegramSettings(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	var req TelegramSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "некорректный JSON")
		return
	}
	chatID := strings.TrimSpace(req.ChatID)
	botToken := strings.TrimSpace(req.BotToken)
	username := normalizeTelegramUsername(req.Username)
	current := h.loadTelegramSettings()
	if botToken == "" {
		botToken = current.BotToken
	}
	if username == "" {
		username = current.Username
	}
	if chatID == "" && botToken != "" && username != "" {
		resolvedChatID, err := resolveTelegramChatID(botToken, username)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		chatID = resolvedChatID
	}
	if req.Enabled && (botToken == "" || chatID == "") {
		writeJSONError(w, http.StatusBadRequest, "для включения Telegram укажите token и chat_id или @username после /start боту")
		return
	}
	settings := domain.TelegramSettings{ID: 1, Enabled: req.Enabled, BotToken: botToken, ChatID: chatID, Username: username}
	if err := h.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"enabled", "bot_token", "chat_id", "username", "updated_at"}),
	}).Create(&settings).Error; err != nil {
		writeJSONError(w, http.StatusInternalServerError, "ошибка сохранения Telegram настроек")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(telegramSettingsDTO(settings))
}

func (h *Handler) TestTelegramSettings(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	settings := h.loadTelegramSettings()
	if settings.BotToken == "" || settings.ChatID == "" {
		writeJSONError(w, http.StatusBadRequest, "Telegram не настроен")
		return
	}
	payload := map[string]interface{}{
		"chat_id":                  settings.ChatID,
		"text":                     "Telegram подключён к TenderAI. Уведомления о новых подходящих тендерах будут приходить сюда.",
		"disable_web_page_preview": true,
	}
	body, _ := json.Marshal(payload)
	client := http.Client{Timeout: 20 * time.Second}
	resp, err := client.Post("https://api.telegram.org/bot"+settings.BotToken+"/sendMessage", "application/json", bytes.NewReader(body))
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "Telegram API недоступен")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeJSONError(w, http.StatusBadGateway, "Telegram не принял сообщение, проверьте token и chat_id")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) loadTelegramSettings() domain.TelegramSettings {
	var settings domain.TelegramSettings
	if h.DB != nil {
		_ = h.DB.First(&settings, 1).Error
	}
	return settings
}

func telegramSettingsDTO(settings domain.TelegramSettings) TelegramSettingsDTO {
	return TelegramSettingsDTO{
		Enabled:     settings.Enabled,
		Configured:  settings.BotToken != "" && settings.ChatID != "",
		ChatID:      settings.ChatID,
		Username:    settings.Username,
		MaskedToken: maskTelegramToken(settings.BotToken),
	}
}

func maskTelegramToken(token string) string {
	if token == "" {
		return ""
	}
	if len(token) <= 10 {
		return "••••"
	}
	return token[:6] + "••••" + token[len(token)-4:]
}

func normalizeTelegramUsername(username string) string {
	username = strings.TrimSpace(username)
	username = strings.TrimPrefix(username, "@")
	return strings.ToLower(username)
}

func resolveTelegramChatID(botToken string, username string) (string, error) {
	client := http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get("https://api.telegram.org/bot" + botToken + "/getUpdates")
	if err != nil {
		return "", errors.New("Telegram API недоступен")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.New("Telegram не отдал updates, проверьте token")
	}
	var body telegramUpdatesResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", errors.New("не удалось прочитать Telegram updates")
	}
	username = normalizeTelegramUsername(username)
	for _, update := range body.Result {
		if update.Message == nil {
			continue
		}
		chatUsername := normalizeTelegramUsername(update.Message.Chat.Username)
		fromUsername := ""
		if update.Message.From != nil {
			fromUsername = normalizeTelegramUsername(update.Message.From.Username)
		}
		if chatUsername == username || fromUsername == username {
			if update.Message.Chat.ID != 0 {
				return strconv.FormatInt(update.Message.Chat.ID, 10), nil
			}
			if update.Message.From != nil && update.Message.From.ID != 0 {
				return strconv.FormatInt(update.Message.From.ID, 10), nil
			}
		}
	}
	return "", errors.New("не нашёл пользователя в Telegram. Напишите боту /start и попробуйте снова")
}
