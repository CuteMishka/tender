package tenderplus

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLotUnmarshalMultipleDocuments(t *testing.T) {
	const raw = `{
  "lot": [
    {
      "id": 1,
      "lot": "26000044KR-1",
      "documents": [
        {"name": "a.pdf", "downloadLink": "https://example.com/a"},
        {"name": "b.pdf", "downloadLink": "https://example.com/b"},
        {"name": "c.pdf", "downloadLink": "https://example.com/c"},
        {"name": "d.pdf", "downloadLink": "https://example.com/d"}
      ]
    }
  ]
}`
	var out struct {
		Lot []Lot `json:"lot"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Lot) != 1 {
		t.Fatalf("lots: %d", len(out.Lot))
	}
	if n := len(out.Lot[0].Documents); n != 4 {
		t.Fatalf("documents: want 4 got %d", n)
	}
}

func TestLotByIDUsesInternalIDCursorLookup(t *testing.T) {
	var requestCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		query := string(body)
		if !strings.Contains(query, `"before":52018767`) && !strings.Contains(query, `before: 52018767`) {
			t.Fatalf("expected cursor lookup for internal ID, got %s", query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"lot":[{"id":52018766,"lot":"264335","lot_source_id":null,"title":"Test lot"}]}}`)
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	lot, err := client.LotByID(t.Context(), 52018766)
	if err != nil {
		t.Fatal(err)
	}
	if lot == nil || lot.ID != 52018766 {
		t.Fatalf("expected internal lot 52018766, got %#v", lot)
	}
	if requestCount != 1 {
		t.Fatalf("expected one exact cursor request, got %d", requestCount)
	}
}
