package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dauren/tender/internal/tenderplus"
	"github.com/go-chi/chi/v5"
)

func TestNormalizeCloudyDocumentRange(t *testing.T) {
	got, err := normalizeCloudyDocumentRange(&CloudyDocumentRangeDTO{From: 3, To: 1}, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.From != 1 || got.To != 3 {
		t.Fatalf("got range %+v, want 1-3", got)
	}

	if _, err := normalizeCloudyDocumentRange(&CloudyDocumentRangeDTO{From: 0, To: 2}, 5); err == nil {
		t.Fatal("expected invalid range error")
	}

	empty, err := normalizeCloudyDocumentRange(nil, 0)
	if err != nil {
		t.Fatalf("empty range error: %v", err)
	}
	if empty.From != 0 || empty.To != 0 {
		t.Fatalf("empty range = %+v", empty)
	}
}

func TestCloudyInstantResponse(t *testing.T) {
	resp := cloudyInstantResponse("помоги")
	if resp.Answer == "" {
		t.Fatal("instant response answer is empty")
	}
	if resp.Provider != "built-in" || resp.Model != "intent-router" {
		t.Fatalf("unexpected instant metadata: provider=%q model=%q", resp.Provider, resp.Model)
	}
	if len(resp.FollowUp) == 0 {
		t.Fatal("instant response should include follow-up suggestions")
	}
	if len(resp.Sources) != 0 || len(resp.UsedDocuments) != 0 {
		t.Fatalf("instant response should not include document data: %+v", resp)
	}
}

func TestPostCloudyChatToRAG(t *testing.T) {
	var gotQuestion string
	var gotHistory string
	var gotLotContext string
	var gotSpecSummary string
	var gotWarnings string
	var gotFileName string
	var gotFileBody string
	var gotInternalToken string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotInternalToken = r.Header.Get(InternalTokenHeader)
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		if r.URL.Path != "/v1/lots/lot-1/cloudy/chat" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		gotQuestion = r.FormValue("question")
		gotHistory = r.FormValue("history_json")
		gotLotContext = r.FormValue("lot_context")
		gotSpecSummary = r.FormValue("spec_summary_json")
		gotWarnings = r.FormValue("warnings_json")

		files := r.MultipartForm.File["documents"]
		if len(files) != 1 {
			t.Fatalf("files = %d, want 1", len(files))
		}
		gotFileName = files[0].Filename
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("open file: %v", err)
		}
		defer file.Close()
		raw, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("read file: %v", err)
		}
		gotFileBody = string(raw)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ragCloudyChatResponse{
			Answer:        "Срок указан в ТС.",
			Sources:       []CloudySourceDTO{{Document: "spec.txt", Snippet: "срок 10 дней"}},
			FollowUp:      []string{"Показать требования?"},
			UsedDocuments: []string{"spec.txt"},
			Warnings:      []string{"minor"},
			Provider:      "test",
			Model:         "fake",
		})
	}))
	defer server.Close()

	resp, err := postCloudyChatToRAG(
		context.Background(),
		server.URL,
		"lot-1",
		"Какие сроки?",
		[]CloudyChatMessageDTO{{Role: "user", Content: "Привет"}},
		"Название: тестовый лот",
		map[string]interface{}{"overview": "тест"},
		[]string{"document-2: не удалось скачать"},
		[]cloudyDocumentPayload{{Name: "spec.txt", Data: []byte("срок 10 дней")}},
		"internal-service-secret",
	)
	if err != nil {
		t.Fatalf("postCloudyChatToRAG error: %v", err)
	}
	if resp.Answer != "Срок указан в ТС." || resp.Provider != "test" || resp.Model != "fake" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if gotQuestion != "Какие сроки?" {
		t.Fatalf("question = %q", gotQuestion)
	}
	if gotHistory == "" || gotLotContext == "" || gotSpecSummary == "" {
		t.Fatalf("missing forwarded fields: history=%q context=%q spec=%q", gotHistory, gotLotContext, gotSpecSummary)
	}
	if gotWarnings == "" {
		t.Fatal("warnings_json was not forwarded")
	}
	if gotFileName != "spec.txt" || gotFileBody != "срок 10 дней" {
		t.Fatalf("file = %q %q", gotFileName, gotFileBody)
	}
	if gotInternalToken != "internal-service-secret" {
		t.Fatalf("internal token header = %q", gotInternalToken)
	}
}

func TestCloudyChatUsesLiveTenderPlusLotBeforeParserSynchronization(t *testing.T) {
	tenderPlusServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data": {
				"lot": [{
					"id": 52018766,
					"lot": "264335",
					"lot_source_id": "52018766",
					"title": "Live TenderPlus lot",
					"description": "Server infrastructure services",
					"documents": []
				}]
			}
		}`))
	}))
	defer tenderPlusServer.Close()

	ragServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/lots/52018766/spec-summary":
			http.NotFound(w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/lots/52018766/cloudy/chat":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(ragCloudyChatResponse{
				Answer:        "Лот доступен по данным TenderPlus.",
				Sources:       []CloudySourceDTO{},
				FollowUp:      []string{},
				UsedDocuments: []string{},
				Warnings:      []string{},
				Provider:      "test",
				Model:         "fake",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ragServer.Close()

	handler := &Handler{
		TP:         tenderplus.NewClient(tenderPlusServer.URL, "test-token"),
		RagAPIBase: ragServer.URL,
	}
	router := chi.NewRouter()
	router.Post("/api/v1/tenders/{tenderId}/cloudy/chat", handler.CloudyChat)

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/tenders/52018766/cloudy/chat",
		strings.NewReader(`{"question":"Какая услуга требуется?"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response CloudyChatResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Answer != "Лот доступен по данным TenderPlus." {
		t.Fatalf("answer = %q", response.Answer)
	}
}
