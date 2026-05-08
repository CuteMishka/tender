package tenderplus

// LotBuy — блок закупки; часть вложений только здесь, не в Lot.documents.
type LotBuy struct {
	Documents []LotDocument `json:"documents"`
}

// AllDocuments объединяет файлы лота и закупки (как раздел «Документация» на TenderPlus).
func (l Lot) AllDocuments() []LotDocument {
	return dedupeDocuments(concatDocuments(l.Documents, lotBuyDocuments(l)))
}

func lotBuyDocuments(l Lot) []LotDocument {
	if l.LotBuy == nil {
		return nil
	}
	return l.LotBuy.Documents
}

func concatDocuments(a, b []LotDocument) []LotDocument {
	if len(b) == 0 {
		return a
	}
	if len(a) == 0 {
		return b
	}
	out := make([]LotDocument, 0, len(a)+len(b))
	out = append(out, a...)
	out = append(out, b...)
	return out
}

func dedupeDocuments(in []LotDocument) []LotDocument {
	seen := make(map[string]struct{}, len(in))
	out := make([]LotDocument, 0, len(in))
	for _, d := range in {
		key := documentDedupKey(d)
		if key == "" {
			out = append(out, d)
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, d)
	}
	return out
}

func documentDedupKey(d LotDocument) string {
	if d.DownloadLink != nil && *d.DownloadLink != "" {
		return *d.DownloadLink
	}
	if d.Name != nil {
		return "name:" + *d.Name
	}
	return ""
}
