package tenderplus

import "testing"

func TestLotAllDocumentsMerge(t *testing.T) {
	u1, u2, u3 := "https://a/x", "https://b/y", "https://c/z"
	n1, n2 := "a.pdf", "b.pdf"
	l := Lot{
		Documents: []LotDocument{{Name: &n1, DownloadLink: &u1}},
		LotBuy: &LotBuy{
			Documents: []LotDocument{
				{Name: &n2, DownloadLink: &u2},
				{Name: &n2, DownloadLink: &u3},
			},
		},
	}
	all := l.AllDocuments()
	if len(all) != 3 {
		t.Fatalf("want 3 merged, got %d", len(all))
	}
}

func TestLotAllDocumentsDedupeByLink(t *testing.T) {
	u := "https://same"
	n1, n2 := "a", "b"
	l := Lot{
		Documents: []LotDocument{{Name: &n1, DownloadLink: &u}},
		LotBuy: &LotBuy{
			Documents: []LotDocument{{Name: &n2, DownloadLink: &u}},
		},
	}
	if len(l.AllDocuments()) != 1 {
		t.Fatalf("duplicate link should collapse")
	}
}
