package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dauren/tender/internal/tenderplus"
)

func specTestDocument(name, downloadLink string) LotDocumentDTO {
	return LotDocumentDTO{Name: strPtr(name), DownloadLink: strPtr(downloadLink)}
}

func TestPickSpecDocumentDTOPrefersRealTechspecOverAppendix(t *testing.T) {
	docs := []LotDocumentDTO{
		specTestDocument("appendix_7_17271944.pdf", "https://files.example/appendix"),
		specTestDocument("techspec_86747976.pdf", "https://files.example/techspec"),
		specTestDocument("ТС ЦОД 05.06.docx", "https://files.example/ts"),
	}

	got := pickSpecDocumentDTO(docs)
	if got == nil || derefString(got.Name) != "techspec_86747976.pdf" {
		t.Fatalf("expected techspec document, got %#v", got)
	}
}

func TestPickSpecDocumentDTORecognizesSynchronizedMarkers(t *testing.T) {
	markers := []string{
		"ТС ЦОД.docx",
		"Т.З. на услуги.pdf",
		"Техническая спецификация.pdf",
		"technical_specification.docx",
		"service-specification.pdf",
	}
	for _, name := range markers {
		t.Run(name, func(t *testing.T) {
			docs := []LotDocumentDTO{
				specTestDocument("appendix_7.pdf", "https://files.example/appendix"),
				specTestDocument(name, "https://files.example/candidate"),
			}
			got := pickSpecDocumentDTO(docs)
			if got == nil || derefString(got.Name) != name {
				t.Fatalf("expected %q, got %#v", name, got)
			}
		})
	}
}

func TestPickSpecDocumentDTOKeepsAppendixFallback(t *testing.T) {
	docs := []LotDocumentDTO{
		specTestDocument("appendix_7.pdf", "https://files.example/appendix"),
		specTestDocument("contract_project.pdf", "https://files.example/contract"),
	}
	got := pickSpecDocumentDTO(docs)
	if got == nil || derefString(got.Name) != "appendix_7.pdf" {
		t.Fatalf("expected first supported fallback, got %#v", got)
	}
	if hasSpecDocumentMarker("отсчет оказанных услуг.pdf") {
		t.Fatal("ТС abbreviation must only match a standalone marker")
	}
	if hasSpecDocumentMarker("өтсін.pdf") {
		t.Fatal("ТС abbreviation must remain standalone next to Kazakh letters")
	}
}

func TestGetRAGSpecSummaryAuthenticatesInternalRequest(t *testing.T) {
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.Header.Get(InternalTokenHeader)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	_, found, err := getRAGSpecSummary(context.Background(), server.URL, "lot-1", "internal-service-secret")
	if err != nil || !found {
		t.Fatalf("getRAGSpecSummary: found=%v err=%v", found, err)
	}
	if gotToken != "internal-service-secret" {
		t.Fatalf("internal token header = %q", gotToken)
	}
}

func TestLoadTenderForRAGFallsBackToLiveTenderPlus(t *testing.T) {
	const tenderID = 52018766
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("authorization header = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"lot": []map[string]interface{}{
					{
						"id":            tenderID,
						"lot":           "264335",
						"lot_source_id": "52018766",
						"title":         "Live TenderPlus lot",
						"description":   "Tender available in the live feed before parser synchronization.",
						"documents":     []interface{}{},
					},
				},
			},
		})
	}))
	defer server.Close()

	handler := &Handler{TP: tenderplus.NewClient(server.URL, "test-token")}
	recorder := httptest.NewRecorder()
	loaded, ok := handler.loadTenderForRAG(context.Background(), recorder, tenderID)
	if !ok {
		t.Fatalf("loadTenderForRAG failed: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if loaded.ParserRow != nil {
		t.Fatal("live TenderPlus fallback must not report a parser row")
	}
	if loaded.DTO.ID != tenderID {
		t.Fatalf("id = %d, want %d", loaded.DTO.ID, tenderID)
	}
	if got := derefString(loaded.DTO.LotSourceID); got != "52018766" {
		t.Fatalf("lot source id = %q", got)
	}
	if got := derefString(loaded.DTO.Title); got != "Live TenderPlus lot" {
		t.Fatalf("title = %q", got)
	}
}
