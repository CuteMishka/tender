package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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
