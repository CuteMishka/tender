package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	cloudyMaxHistoryMessages = 10
	cloudyMaxQuestionChars   = 2500
	cloudyMaxDocuments       = 12
)

var cloudyGreetingRe = regexp.MustCompile(
	`(?i)^\s*(?:` +
		`привет(?:ик|ики|ствую|ствуйте)?|здравствуй(?:те)?|добр(?:ый|ое|ая)\s+(?:день|утро|вечер)` +
		`|хай|хелло|hello|hi|hey|салам|здаров|здарова|йоу|yo` +
		`|доброго\s+(?:дня|утра|вечера|времени)` +
		`|спасибо|благодарю|спс|thanks?|thx|мерси|пасиб` +
		`|круто|класс|супер|молодец|отлично|замечательно|великолепно|прекрасно` +
		`|кто\s+ты|что\s+ты\s+(?:умеешь|можешь|делаешь|такое)` +
		`|как\s+(?:тебя\s+зовут|ты\s+работаешь|ты\s+можешь\s+помочь)` +
		`|расскажи\s+о\s+себе|помоги|помощь|help` +
		`)\s*[!.?]*\s*$`,
)

func isCloudyGreeting(question string) bool {
	q := strings.TrimSpace(question)
	if len([]rune(q)) > 120 {
		return false
	}
	return cloudyGreetingRe.MatchString(q)
}

func cloudyInstantResponse(question string) CloudyChatResponse {
	q := strings.ToLower(strings.TrimSpace(question))
	answer := "Здравствуйте. Я Cloudy, помощник по тендерным документам. Задайте вопрос по выбранному лоту, и я найду ответ в документах."
	if strings.Contains(q, "спасибо") || strings.Contains(q, "благодар") || q == "спс" || q == "thanks" || q == "thx" {
		answer = "Пожалуйста. Если нужно уточнить сроки, требования или документы по лоту, задайте следующий вопрос."
	} else if strings.Contains(q, "кто") || strings.Contains(q, "что") || strings.Contains(q, "помо") || q == "help" {
		answer = "Я Cloudy, AI-помощник по тендерам. Могу ответить по срокам подачи, бюджету, требованиям ТС, документам и рискам выбранного лота."
	}
	return CloudyChatResponse{
		Answer:        answer,
		Sources:       []CloudySourceDTO{},
		FollowUp:      []string{"Какой срок подачи заявки?", "Какая сумма и валюта закупки?", "Какие ключевые требования по ТС?"},
		UsedDocuments: []string{},
		Warnings:      []string{},
		Provider:      "built-in",
		Model:         "intent-router",
	}
}

type CloudyChatMessageDTO struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type CloudyDocumentRangeDTO struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type CloudyChatRequest struct {
	Question      string                  `json:"question"`
	History       []CloudyChatMessageDTO  `json:"history,omitempty"`
	DocumentRange *CloudyDocumentRangeDTO `json:"documentRange,omitempty"`
}

type CloudySourceDTO struct {
	Document string   `json:"document"`
	Snippet  string   `json:"snippet"`
	Score    *float64 `json:"score,omitempty"`
}

type CloudyChatResponse struct {
	Answer            string                 `json:"answer"`
	Sources           []CloudySourceDTO      `json:"sources"`
	FollowUp          []string               `json:"followUp"`
	UsedDocuments     []string               `json:"usedDocuments"`
	Warnings          []string               `json:"warnings"`
	SelectedDocuments []string               `json:"selectedDocuments"`
	DocumentRange     CloudyDocumentRangeDTO `json:"documentRange"`
	Provider          string                 `json:"provider,omitempty"`
	Model             string                 `json:"model,omitempty"`
}

type ragCloudyChatResponse struct {
	Answer        string            `json:"answer"`
	Sources       []CloudySourceDTO `json:"sources"`
	FollowUp      []string          `json:"follow_up"`
	UsedDocuments []string          `json:"used_documents"`
	Warnings      []string          `json:"warnings"`
	Provider      string            `json:"provider"`
	Model         string            `json:"model"`
}

type cloudyDocumentPayload struct {
	Name string
	Data []byte
}

func (h *Handler) CloudyChat(w http.ResponseWriter, r *http.Request) {
	ragBase := strings.TrimRight(h.RagAPIBase, "/")
	if ragBase == "" {
		ragBase = "http://127.0.0.1:8083"
	}

	id, err := strconv.Atoi(chi.URLParam(r, "tenderId"))
	if err != nil || id < 1 {
		writeJSONError(w, http.StatusBadRequest, "некорректный ID")
		return
	}

	var body CloudyChatRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	question := strings.TrimSpace(body.Question)
	if question == "" {
		writeJSONError(w, http.StatusBadRequest, "question is required")
		return
	}
	if len([]rune(question)) > cloudyMaxQuestionChars {
		writeJSONError(w, http.StatusBadRequest, "question is too long")
		return
	}
	if isCloudyGreeting(question) {
		writeJSON(w, http.StatusOK, cloudyInstantResponse(question))
		return
	}
	if h.DB == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	row, docs, ok := h.loadParserLotForSpec(w, id)
	if !ok {
		return
	}
	dto := parserLotToDTO(row, docs)
	dto.Documents = h.documentsForSpec(r.Context(), row, dto)

	ragLotID := specRagLotID(dto)
	if ragLotID == "" {
		writeJSONError(w, http.StatusBadRequest, "не удалось определить идентификатор лота для RAG")
		return
	}

	documentRange, err := normalizeCloudyDocumentRange(body.DocumentRange, len(dto.Documents))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	var payloadDocs []cloudyDocumentPayload
	var selectedNames []string
	var fetchWarnings []string
	selected := selectCloudyDocuments(dto.Documents, documentRange)
	if len(selected) > cloudyMaxDocuments {
		writeJSONError(w, http.StatusBadRequest, "выберите не больше 12 документов за раз")
		return
	}
	var fetchErr error
	payloadDocs, selectedNames, fetchWarnings, fetchErr = h.fetchCloudyDocuments(r.Context(), selected)
	if fetchErr != nil {
		writeJSONError(w, http.StatusBadGateway, fetchErr.Error())
		return
	}

	specSummary, _, _ := getRAGSpecSummary(r.Context(), ragBase, ragLotID, h.RAGInternalServiceToken)
	ragResponse, err := postCloudyChatToRAG(
		r.Context(),
		ragBase,
		ragLotID,
		question,
		trimCloudyHistory(body.History),
		cloudyLotContext(dto, documentRange, len(dto.Documents)),
		specSummary,
		fetchWarnings,
		payloadDocs,
		h.RAGInternalServiceToken,
	)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, CloudyChatResponse{
		Answer:            ragResponse.Answer,
		Sources:           ragResponse.Sources,
		FollowUp:          ragResponse.FollowUp,
		UsedDocuments:     ragResponse.UsedDocuments,
		Warnings:          ragResponse.Warnings,
		SelectedDocuments: selectedNames,
		DocumentRange:     documentRange,
		Provider:          ragResponse.Provider,
		Model:             ragResponse.Model,
	})
}

func normalizeCloudyDocumentRange(raw *CloudyDocumentRangeDTO, count int) (CloudyDocumentRangeDTO, error) {
	if count <= 0 {
		return CloudyDocumentRangeDTO{}, nil
	}
	from, to := 1, count
	if raw != nil {
		from, to = raw.From, raw.To
	}
	if from > to {
		from, to = to, from
	}
	if from < 1 || to < 1 || from > count || to > count {
		return CloudyDocumentRangeDTO{}, fmt.Errorf("диапазон документов должен быть от 1 до %d", count)
	}
	return CloudyDocumentRangeDTO{From: from, To: to}, nil
}

func selectCloudyDocuments(docs []LotDocumentDTO, documentRange CloudyDocumentRangeDTO) []LotDocumentDTO {
	if len(docs) == 0 || documentRange.From == 0 || documentRange.To == 0 {
		return nil
	}
	return docs[documentRange.From-1 : documentRange.To]
}

func trimCloudyHistory(history []CloudyChatMessageDTO) []CloudyChatMessageDTO {
	start := 0
	if len(history) > cloudyMaxHistoryMessages {
		start = len(history) - cloudyMaxHistoryMessages
	}
	out := make([]CloudyChatMessageDTO, 0, len(history)-start)
	for _, item := range history[start:] {
		role := strings.ToLower(strings.TrimSpace(item.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		if len([]rune(content)) > 2000 {
			content = string([]rune(content)[:2000]) + "…"
		}
		out = append(out, CloudyChatMessageDTO{Role: role, Content: content})
	}
	return out
}

func (h *Handler) fetchCloudyDocuments(ctx context.Context, docs []LotDocumentDTO) ([]cloudyDocumentPayload, []string, []string, error) {
	payloads := make([]cloudyDocumentPayload, 0, len(docs))
	names := make([]string, 0, len(docs))
	warnings := make([]string, 0)
	for index, doc := range docs {
		name := strings.TrimSpace(derefString(doc.Name))
		if name == "" {
			name = fmt.Sprintf("document-%d", index+1)
		}
		link := strings.TrimSpace(derefString(doc.DownloadLink))
		if link == "" {
			warnings = append(warnings, fmt.Sprintf("%s: нет ссылки на документ", name))
			continue
		}
		data, err := h.fetchAllowedDocumentBytes(ctx, link)
		if err != nil {
			if ctx.Err() != nil {
				return nil, nil, warnings, ctx.Err()
			}
			warnings = append(warnings, fmt.Sprintf("%s: не удалось скачать (%v)", name, err))
			continue
		}
		payloads = append(payloads, cloudyDocumentPayload{Name: name, Data: data})
		names = append(names, name)
	}
	return payloads, names, warnings, nil
}

func cloudyLotContext(dto LotDTO, documentRange CloudyDocumentRangeDTO, totalDocuments int) string {
	lines := []string{
		fmt.Sprintf("ID в системе: %d", dto.ID),
		"Лот/номер: " + derefString(dto.Lot),
		"Идентификатор источника: " + derefString(dto.LotSourceID),
		"Источник: " + derefString(dto.Source),
		"Площадка: " + derefString(dto.SourceLabel),
		"Название: " + derefString(dto.Title),
	}
	if description := strings.TrimSpace(derefString(dto.Description)); description != "" {
		lines = append(lines, "Описание: "+truncateRunes(description, 5000))
	}
	if dto.Cost != nil {
		lines = append(lines, fmt.Sprintf("Сумма/бюджет: %.2f KZT", *dto.Cost))
	}
	lines = append(lines,
		"Начало подачи: "+derefString(dto.StartDate),
		"Окончание подачи: "+derefString(dto.EndDate),
		"Место: "+derefString(dto.Place),
		"Регион: "+derefString(dto.Region),
		"Заказчик: "+derefString(dto.CustomerName),
		"Организатор: "+derefString(dto.OrganizerName),
		"Тип закупки: "+derefString(dto.PurchaseType),
		"Статус: "+derefString(dto.Status),
	)
	if len(dto.RequiredServices) > 0 {
		lines = append(lines, "Найденные услуги: "+strings.Join(dto.RequiredServices, "; "))
	}
	if technicalSpec := strings.TrimSpace(derefString(dto.TechnicalSpec)); technicalSpec != "" {
		lines = append(lines, "Текст ТС из карточки: "+truncateRunes(technicalSpec, 6000))
	}
	if totalDocuments > 0 && documentRange.From > 0 {
		lines = append(lines, fmt.Sprintf("Выбранный диапазон документов: %d-%d из %d", documentRange.From, documentRange.To, totalDocuments))
	} else {
		lines = append(lines, "Документы не выбраны или не найдены; отвечай по карточке лота.")
	}
	return strings.Join(lines, "\n")
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func postCloudyChatToRAG(
	ctx context.Context,
	ragBase string,
	lotID string,
	question string,
	history []CloudyChatMessageDTO,
	lotContext string,
	specSummary map[string]interface{},
	warnings []string,
	docs []cloudyDocumentPayload,
	internalToken string,
) (ragCloudyChatResponse, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("question", question); err != nil {
		return ragCloudyChatResponse{}, err
	}
	if len(history) > 0 {
		historyJSON, _ := json.Marshal(history)
		_ = writer.WriteField("history_json", string(historyJSON))
	}
	if strings.TrimSpace(lotContext) != "" {
		_ = writer.WriteField("lot_context", lotContext)
	}
	if len(specSummary) > 0 {
		specJSON, _ := json.Marshal(specSummary)
		_ = writer.WriteField("spec_summary_json", string(specJSON))
	}
	if len(warnings) > 0 {
		warningsJSON, _ := json.Marshal(warnings)
		_ = writer.WriteField("warnings_json", string(warningsJSON))
	}
	for _, doc := range docs {
		part, err := writer.CreateFormFile("documents", doc.Name)
		if err != nil {
			return ragCloudyChatResponse{}, err
		}
		if _, err := part.Write(doc.Data); err != nil {
			return ragCloudyChatResponse{}, err
		}
	}
	if err := writer.Close(); err != nil {
		return ragCloudyChatResponse{}, err
	}

	endpoint := strings.TrimRight(ragBase, "/") + "/v1/lots/" + url.PathEscape(lotID) + "/cloudy/chat"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return ragCloudyChatResponse{}, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	setRAGInternalToken(req, internalToken)

	resp, err := (&http.Client{Timeout: 180 * time.Second}).Do(req)
	if err != nil {
		return ragCloudyChatResponse{}, fmt.Errorf("RAG недоступен: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ragCloudyChatResponse{}, fmt.Errorf("RAG HTTP %d: %s", resp.StatusCode, ragErrorDetail(raw))
	}
	var out ragCloudyChatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ragCloudyChatResponse{}, fmt.Errorf("RAG вернул некорректный JSON: %w", err)
	}
	if strings.TrimSpace(out.Answer) == "" {
		return ragCloudyChatResponse{}, errors.New("RAG вернул пустой ответ")
	}
	return out, nil
}
