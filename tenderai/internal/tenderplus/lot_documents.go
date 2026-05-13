package tenderplus

func (l Lot) AllDocuments() []LotDocument {
	total := len(l.Documents)
	if l.LotBuy != nil {
		total += len(l.LotBuy.Documents)
	}
	if total == 0 {
		return []LotDocument{}
	}
	out := make([]LotDocument, 0, total)
	out = append(out, l.Documents...)
	if l.LotBuy != nil {
		out = append(out, l.LotBuy.Documents...)
	}
	return dedupeDocuments(out)
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
