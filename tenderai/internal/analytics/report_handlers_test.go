package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReportPreviewUsesLiveLoaderAndReturnsContract(t *testing.T) {
	var gotQuery string
	var gotLimit int
	generatedAt := time.Date(2026, time.July, 14, 8, 30, 0, 0, reportLocation)
	handler := &Handler{CompanyLoader: func(_ context.Context, query string, limit int) (CompanyTenderIntelligence, error) {
		gotQuery = query
		gotLimit = limit
		return CompanyTenderIntelligence{
			GeneratedAt: generatedAt,
			Source:      "TenderPlus API",
			Summary:     CompanySummary{PublishedCount: 3},
			Published: []CompanyTender{{
				ID: 1, LotNumber: "L-1", LotSource: "S-1", Title: "Лот", Amount: 100,
				AmountAvailable: true, Status: "Завершен", CustomerName: "АО Альфа",
				Platform: "Госзакупки РК", PurchaseType: "Открытый тендер", Category: "Услуги",
				PublishDate: reportTestTime(2026, time.January, 15, 12),
			}},
			Warnings: []string{"Предупреждение источника"},
		}, nil
	}}
	body := `{"organization_query":"  АО Альфа  ","organization":"Альфа","platforms":["Госзакупки РК"],"date_from":"2026-01-01","date_to":"2026-01-31","top_n":15}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/reports/preview", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.ReportPreview(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if gotQuery != "АО Альфа" || gotLimit != companyDisplayLimitMax {
		t.Errorf("loader args = (%q, %d), want normalized query and %d", gotQuery, gotLimit, companyDisplayLimitMax)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q", got)
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q", got)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, key := range []string{"header", "kpis", "by_purchase_type", "by_service_category", "top_tenders", "repeated_lots", "conclusions", "quality", "available_platforms", "available_organizations"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("preview response is missing top-level key %q", key)
		}
	}
	var report ReportData
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode ReportData: %v", err)
	}
	if report.KPIs.TotalLots != 1 || report.KPIs.TotalAmount != 100 {
		t.Errorf("report KPIs = %#v", report.KPIs)
	}
	if !report.Header.DataAsOf.Equal(generatedAt) {
		t.Errorf("DataAsOf = %v, want %v", report.Header.DataAsOf, generatedAt)
	}
	warnings := strings.Join(report.Quality.Warnings, " ")
	if !strings.Contains(warnings, "Предупреждение источника") || !strings.Contains(warnings, "вернул 1 из 3") || !strings.Contains(warnings, "только полученные строки") {
		t.Errorf("quality warnings = %#v", report.Quality.Warnings)
	}
}

func TestReportDOCXReturnsDownload(t *testing.T) {
	handler := &Handler{CompanyLoader: func(_ context.Context, _ string, _ int) (CompanyTenderIntelligence, error) {
		return CompanyTenderIntelligence{
			GeneratedAt: time.Date(2026, time.July, 14, 8, 30, 0, 0, reportLocation),
			Source:      "TenderPlus API",
			Published: []CompanyTender{{
				ID: 1, LotNumber: "L-1", Title: "Лот", Amount: 100, AmountAvailable: true,
				Status: "Завершен", Platform: "P", CustomerName: "Орг",
			}},
		}, nil
	}}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/reports/docx", strings.NewReader(`{"organization_query":"Орг","date_from":"2026-01-01","date_to":"2026-07-14"}`))
	response := httptest.NewRecorder()
	handler.ReportDOCX(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := response.Header().Get("Content-Disposition"); !strings.Contains(got, "analytics_report_20260101_20260714.docx") {
		t.Errorf("Content-Disposition = %q", got)
	}
	if got := response.Header().Get("Content-Length"); got == "" {
		t.Error("Content-Length is missing")
	}
	if body := response.Body.Bytes(); len(body) < 2 || !bytes.Equal(body[:2], []byte("PK")) {
		t.Error("response is not a DOCX ZIP")
	}
}

func TestReportHandlersRejectInvalidRequestsBeforeLoading(t *testing.T) {
	loaderCalls := 0
	handler := &Handler{CompanyLoader: func(_ context.Context, _ string, _ int) (CompanyTenderIntelligence, error) {
		loaderCalls++
		return CompanyTenderIntelligence{}, nil
	}}
	tests := []struct {
		name string
		body string
	}{
		{name: "empty body", body: ""},
		{name: "missing query", body: `{}`},
		{name: "unknown field", body: `{"organization_query":"AA","unexpected":true}`},
		{name: "multiple objects", body: `{"organization_query":"AA"} {"organization_query":"BB"}`},
		{name: "malformed", body: `{"organization_query":`},
		{name: "bad date", body: `{"organization_query":"AA","date_from":"14.07.2026"}`},
		{name: "reverse dates", body: `{"organization_query":"AA","date_from":"2026-07-14","date_to":"2026-01-01"}`},
		{name: "top too high", body: `{"organization_query":"AA","top_n":101}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/reports/preview", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			handler.ReportPreview(response, request)
			if response.Code != http.StatusBadRequest {
				t.Errorf("status = %d, body = %s", response.Code, response.Body.String())
			}
			var errorBody map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &errorBody); err != nil || errorBody["error"] == "" {
				t.Errorf("error response = %q, decode error = %v", response.Body.String(), err)
			}
		})
	}
	if loaderCalls != 0 {
		t.Errorf("loader called %d times for invalid requests", loaderCalls)
	}
}

func TestReportPreviewMapsLoaderErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
	}{
		{name: "not configured", err: ErrTenderPlusNotConfigured, status: http.StatusServiceUnavailable},
		{name: "loader validation", err: ErrCompanyQueryRequired, status: http.StatusBadRequest},
		{name: "upstream", err: errors.New("upstream unavailable"), status: http.StatusBadGateway},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := &Handler{CompanyLoader: func(_ context.Context, _ string, _ int) (CompanyTenderIntelligence, error) {
				return CompanyTenderIntelligence{}, test.err
			}}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/analytics/reports/preview", strings.NewReader(`{"organization_query":"AA"}`))
			response := httptest.NewRecorder()
			handler.ReportPreview(response, request)
			if response.Code != test.status {
				t.Errorf("status = %d, want %d; body = %s", response.Code, test.status, response.Body.String())
			}
		})
	}
}
