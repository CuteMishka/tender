package api

import (
	"net/url"
	"testing"
)

func TestValidateFetchURL(t *testing.T) {
	hosts := map[string]struct{}{
		"v3bl.goszakup.gov.kz": {},
	}

	cases := []struct {
		name       string
		raw        string
		pathPrefix string
		wantErr    bool
	}{
		{"https allowed host path ok", "https://v3bl.goszakup.gov.kz/files/download_file/x", "/files/", false},
		{"http rejected", "http://v3bl.goszakup.gov.kz/files/x", "/files/", true},
		{"wrong host", "https://evil.example/files/download_file/x", "/files/", true},
		{"path prefix mismatch", "https://v3bl.goszakup.gov.kz/other/x", "/files/", true},
		{"empty path prefix allows path", "https://v3bl.goszakup.gov.kz/other/x", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, err := url.Parse(tc.raw)
			if err != nil {
				t.Fatal(err)
			}
			err = validateFetchURL(u, hosts, tc.pathPrefix)
			if tc.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestPickContentType(t *testing.T) {
	if got := pickContentType("application/pdf; charset=binary", "/x"); got != "application/pdf" {
		t.Fatalf("upstream pdf: got %q", got)
	}
	if got := pickContentType("application/octet-stream", "/a/b.docx"); got != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("from ext docx: got %q", got)
	}
}
