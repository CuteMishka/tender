package tenderplus

import (
	"encoding/json"
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
