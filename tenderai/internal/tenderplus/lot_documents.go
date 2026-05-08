package tenderplus

func (l Lot) AllDocuments() []LotDocument {
	if len(l.Documents) == 0 {
		return []LotDocument{}
	}
	return dedupeDocuments(l.Documents)
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
