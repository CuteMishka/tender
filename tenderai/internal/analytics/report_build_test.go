package analytics

import (
	"math"
	"strings"
	"testing"
	"time"
)

func reportTestTime(year int, month time.Month, day, hour int) *time.Time {
	value := time.Date(year, month, day, hour, 0, 0, 0, reportLocation)
	return &value
}

func reportTestMeta() ReportBuildMeta {
	return ReportBuildMeta{
		Source:      "TenderPlus API",
		DataAsOf:    time.Date(2026, time.July, 14, 12, 0, 0, 0, reportLocation),
		GeneratedAt: time.Date(2026, time.July, 14, 12, 5, 0, 0, reportLocation),
	}
}

func TestBuildReportDeduplicatesByPlatformAndLotNumber(t *testing.T) {
	rows := []CompanyTender{
		{ID: 101, LotNumber: " LOT-001 () ", LotSource: "pre-source", BuySourceID: "PRE-1", Title: "Обсуждение", Amount: 900, AmountAvailable: true, Status: "Предварительное обсуждение", CustomerName: "АО Альфа", Platform: "Госзакупки РК", PurchaseType: "Предварительное обсуждение", Category: "ИТ", PublishDate: reportTestTime(2026, time.January, 1, 10)},
		{ID: 102, LotNumber: "lot-001", LotSource: "open-source", BuySourceID: "PUB-1", Title: "Серверы", Amount: 1000, AmountAvailable: true, Status: "Опубликован", CustomerName: "АО Альфа", Platform: " госзакупки   рк ", PurchaseType: "Открытый тендер", Category: "ИТ", PublishDate: reportTestTime(2026, time.January, 2, 10)},
		{ID: 103, LotNumber: "LOT-001", LotSource: "samruk-source", BuySourceID: "SAM-1", Title: "Другой лот", Amount: 50, AmountAvailable: true, Status: "Завершен", CustomerName: "АО Альфа", Platform: "Самрук-Казына", PurchaseType: "Запрос цен", Category: "Товары", PublishDate: reportTestTime(2026, time.January, 2, 10)},
		{ID: 201, LotNumber: "B-2", LotSource: "b-source-1", BuySourceID: "PUB-B-1", Title: "Каналы связи", Amount: 180, AmountAvailable: true, Status: "Не состоялась", CustomerName: "АО Альфа", Platform: "Госзакупки РК", PurchaseType: "Открытый тендер", Category: "Связь", PublishDate: reportTestTime(2026, time.January, 3, 10)},
		{ID: 202, LotNumber: " B-2 ", LotSource: "b-source-2", BuySourceID: "PUB-B-2", Title: "Каналы связи", Amount: 200, AmountAvailable: true, Status: "Опубликован", CustomerName: "АО Альфа", Platform: "Госзакупки РК", PurchaseType: "Открытый тендер", Category: "Связь", PublishDate: reportTestTime(2026, time.January, 4, 10)},
	}

	report, err := BuildReport(rows, ReportRequest{OrganizationQuery: "Альфа"}, reportTestMeta())
	if err != nil {
		t.Fatalf("BuildReport() error = %v", err)
	}
	if report.KPIs.TotalLots != 3 {
		t.Fatalf("TotalLots = %d, want 3", report.KPIs.TotalLots)
	}
	if report.KPIs.PossibleReannouncements != 1 {
		t.Errorf("PossibleReannouncements = %d, want 1", report.KPIs.PossibleReannouncements)
	}
	if report.KPIs.TotalAmount != 1250 {
		t.Errorf("TotalAmount = %v, want 1250", report.KPIs.TotalAmount)
	}
	if len(report.RepeatedLots) != 2 {
		t.Fatalf("RepeatedLots len = %d, want 2", len(report.RepeatedLots))
	}

	var transition, reannounced *ReportRepeatedLot
	for index := range report.RepeatedLots {
		row := &report.RepeatedLots[index]
		switch cleanReportIdentifier(row.LotNumber) {
		case "LOT-001":
			if normalizeReportText(row.Platform) == normalizeReportText("Госзакупки РК") {
				transition = row
			}
		case "B-2":
			reannounced = row
		}
	}
	if transition == nil || !transition.StageTransition || transition.PossibleReannouncement || transition.PublicationCount != 1 {
		t.Errorf("stage transition row = %#v, want transition only with one publication", transition)
	}
	if reannounced == nil || !reannounced.PossibleReannouncement || reannounced.PublicationCount != 2 {
		t.Errorf("reannounced row = %#v, want possible reannouncement with two publications", reannounced)
	}

	var bTender *ReportTopTender
	for index := range report.TopTenders {
		if cleanReportIdentifier(report.TopTenders[index].LotNumber) == "B-2" {
			bTender = &report.TopTenders[index]
		}
	}
	if bTender == nil || bTender.StatusGroup != ReportStatusFailed || bTender.Status != "Не состоялась" {
		t.Errorf("B-2 aggregate status = %#v, want failed/Не состоялась", bTender)
	}
}

func TestAggregateReportStatusPrecedence(t *testing.T) {
	tests := []struct {
		name     string
		statuses []string
		group    ReportStatus
		label    string
	}{
		{name: "unknown", statuses: []string{"Архивный"}, group: ReportStatusUnknown, label: "Архивный"},
		{name: "active beats unknown", statuses: []string{"Прием заявок", "Архивный"}, group: ReportStatusActive, label: "Прием заявок"},
		{name: "completed beats active", statuses: []string{"Завершен", "Опубликован"}, group: ReportStatusCompleted, label: "Завершен"},
		{name: "failed beats completed", statuses: []string{"Не состоялась", "Завершен"}, group: ReportStatusFailed, label: "Не состоялась"},
		{name: "cancelled beats failed", statuses: []string{"Отменен", "Не состоялась"}, group: ReportStatusCancelled, label: "Отменен"},
		{name: "first winning label retained", statuses: []string{"Отменен заказчиком", "Аннулирован"}, group: ReportStatusCancelled, label: "Отменен заказчиком"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rows := make([]CompanyTender, 0, len(test.statuses))
			for _, status := range test.statuses {
				rows = append(rows, CompanyTender{Status: status})
			}
			group, label := aggregateReportStatus(rows)
			if group != test.group || label != test.label {
				t.Fatalf("aggregateReportStatus() = (%q, %q), want (%q, %q)", group, label, test.group, test.label)
			}
		})
	}
}

func TestBuildReportAmountsKPIsBreakdownsAndTop(t *testing.T) {
	rows := []CompanyTender{
		{ID: 11, LotNumber: "L-1", LotSource: "S-1", BuySourceID: "B-1", Title: "Лот 1", Status: "Завершен", Platform: "P", CustomerName: "Орг", PurchaseType: "Открытый тендер", Category: "Категория А", PublishDate: reportTestTime(2026, time.January, 2, 10)},
		{ID: 10, LotNumber: "L-1", LotSource: "S-1", BuySourceID: "B-1", Title: "Лот 1", Amount: 1234.4, AmountAvailable: true, Status: "Завершен", Platform: "P", CustomerName: "Орг", PurchaseType: "Открытый тендер", Category: "Категория А", PublishDate: reportTestTime(2026, time.January, 1, 10)},
		{ID: 21, LotNumber: "L-2", LotSource: "S-2", BuySourceID: "B-2", Title: "Лот 2", Amount: 2000, AmountAvailable: true, Status: "Завершен", Platform: "P", CustomerName: "Орг", PurchaseType: "Открытый тендер", Category: "Категория А", PublishDate: reportTestTime(2026, time.January, 3, 10)},
		{ID: 20, LotNumber: "L-2", LotSource: "S-2", BuySourceID: "B-2", Title: "Лот 2", Amount: 2100, AmountAvailable: true, Status: "Опубликован", Platform: "P", CustomerName: "Орг", PurchaseType: "Открытый тендер", Category: "Категория А", PublishDate: reportTestTime(2026, time.January, 1, 10)},
		{ID: 30, LotNumber: "L-3", Title: "Лот 3", Status: "Отменен", Platform: "P", CustomerName: "Орг", PurchaseType: "Запрос цен", SubjectType: "Работы", PublishDate: reportTestTime(2026, time.January, 4, 10)},
		{ID: 40, LotNumber: "L-4", Title: "Лот 4", Amount: 500, AmountAvailable: true, Status: "Не состоялась", Platform: "P", CustomerName: "Орг", PurchaseType: "Открытый тендер", EnstruTitle: "Услуги связи", PublishDate: reportTestTime(2026, time.January, 5, 10)},
		{ID: 50, LotNumber: "L-5", Title: "Лот 5", Amount: 100, AmountAvailable: true, Status: "Прием заявок", Platform: "P", CustomerName: "Орг", PurchaseType: "Запрос цен", Category: "Категория Б", PublishDate: reportTestTime(2026, time.January, 6, 10)},
		{ID: 60, LotNumber: "L-6", Title: "Лот 6", Amount: 50, AmountAvailable: true, Status: "Архивный", Platform: "P", CustomerName: "Орг", SubjectType: "Товары", PublishDate: reportTestTime(2026, time.January, 7, 10)},
	}
	report, err := BuildReport(rows, ReportRequest{OrganizationQuery: "Орг", TopN: 2}, reportTestMeta())
	if err != nil {
		t.Fatalf("BuildReport() error = %v", err)
	}
	wantKPIs := ReportKPIs{TotalLots: 6, CompletedLots: 3, CancelledLots: 1, FailedLots: 1, LotsWithoutAmount: 1, TotalAmount: 3884.4}
	if report.KPIs.TotalLots != wantKPIs.TotalLots || report.KPIs.CompletedLots != wantKPIs.CompletedLots || report.KPIs.CancelledLots != wantKPIs.CancelledLots || report.KPIs.FailedLots != wantKPIs.FailedLots || report.KPIs.LotsWithoutAmount != wantKPIs.LotsWithoutAmount || math.Abs(report.KPIs.TotalAmount-wantKPIs.TotalAmount) > 0.001 {
		t.Errorf("KPIs = %#v, want %#v", report.KPIs, wantKPIs)
	}
	if report.Quality.LotsUsingAmountFallback != 1 || report.Quality.LotsWithConflictingAmounts != 1 || report.Quality.LotsWithUnknownStatus != 1 {
		t.Errorf("quality = %#v, want one fallback, conflict and unknown status", report.Quality)
	}
	if len(report.TopTenders) != 2 || report.TopTenders[0].LotNumber != "L-2" || report.TopTenders[1].LotNumber != "L-1" {
		t.Errorf("TopTenders = %#v, want L-2 then L-1", report.TopTenders)
	}
	for name, breakdown := range map[string][]ReportBreakdown{"purchase": report.ByPurchaseType, "category": report.ByServiceCategory} {
		var count int
		var amount float64
		for _, row := range breakdown {
			count += row.Count
			amount += row.Amount
		}
		if count != report.KPIs.TotalLots || math.Abs(amount-report.KPIs.TotalAmount) > 0.001 {
			t.Errorf("%s breakdown totals = (%d, %v), want (%d, %v)", name, count, amount, report.KPIs.TotalLots, report.KPIs.TotalAmount)
		}
	}
	joined := strings.Join(report.Conclusions, " ")
	if !strings.Contains(joined, "Категория А") || !strings.Contains(joined, "Открытый тендер") || !strings.Contains(joined, "отменено 1") {
		t.Errorf("conclusions do not cover leaders/cancellations: %q", joined)
	}
}

func TestBuildReportFiltersAreInclusiveAndOptionsPrecedeFilters(t *testing.T) {
	rows := []CompanyTender{
		{ID: 1, LotNumber: "1", Amount: 1, AmountAvailable: true, Status: "Завершен", Platform: "Госзакупки РК", CustomerName: "АО Казахтелеком", PublishDate: reportTestTime(2026, time.January, 1, 23)},
		{ID: 2, LotNumber: "2", Amount: 2, AmountAvailable: true, Status: "Завершен", Platform: "Госзакупки РК", CustomerName: "АО Казахтелеком", PublishDate: reportTestTime(2026, time.January, 31, 23)},
		{ID: 3, LotNumber: "3", Amount: 3, AmountAvailable: true, Status: "Завершен", Platform: "Госзакупки РК", CustomerName: "АО Казахтелеком", EndDate: reportTestTime(2026, time.January, 15, 8)},
		{ID: 4, LotNumber: "4", Amount: 4, AmountAvailable: true, Status: "Завершен", Platform: "Госзакупки РК", CustomerName: "АО Казахтелеком", PublishDate: reportTestTime(2026, time.February, 1, 0)},
		{ID: 5, LotNumber: "5", Amount: 5, AmountAvailable: true, Status: "Завершен", Platform: "Самрук-Казына", CustomerName: "Другая организация", PublishDate: reportTestTime(2026, time.January, 15, 8)},
	}
	report, err := BuildReport(rows, ReportRequest{
		OrganizationQuery: "Казахтелеком",
		Organization:      "казахтелеком",
		Platforms:         []string{"  госзакупки   рк  "},
		DateFrom:          "2026-01-01",
		DateTo:            "2026-01-31",
	}, reportTestMeta())
	if err != nil {
		t.Fatalf("BuildReport() error = %v", err)
	}
	if report.KPIs.TotalLots != 3 || report.KPIs.TotalAmount != 6 {
		t.Errorf("filtered KPIs = %#v, want 3 lots / 6", report.KPIs)
	}
	if len(report.AvailablePlatforms) != 2 || !containsString(report.AvailablePlatforms, "Самрук-Казына") {
		t.Errorf("AvailablePlatforms = %#v, want unfiltered options", report.AvailablePlatforms)
	}
	if !containsString(report.AvailableOrganizations, "Другая организация") {
		t.Errorf("AvailableOrganizations = %#v, want unfiltered organization", report.AvailableOrganizations)
	}
	if report.Header.DateFrom != "2026-01-01" || report.Header.DateTo != "2026-01-31" {
		t.Errorf("header period = %q..%q", report.Header.DateFrom, report.Header.DateTo)
	}
}

func TestBuildReportFallbackDeduplicationDoesNotMergeMissingIDs(t *testing.T) {
	rows := []CompanyTender{
		{ID: 1, LotSource: " SRC-1 ", Platform: "P", Status: "Опубликован"},
		{ID: 2, LotSource: "src-1", Platform: "P", Status: "Опубликован"},
		{ID: 3, Platform: "P", Status: "Опубликован"},
		{ID: 4, Platform: "P", Status: "Опубликован"},
		{Platform: "P", Status: "Опубликован"},
		{Platform: "P", Status: "Опубликован"},
	}
	report, err := BuildReport(rows, ReportRequest{OrganizationQuery: "PP"}, reportTestMeta())
	if err != nil {
		t.Fatalf("BuildReport() error = %v", err)
	}
	if report.KPIs.TotalLots != 5 {
		t.Errorf("TotalLots = %d, want 5 (source pair merged; stable and absent IDs distinct)", report.KPIs.TotalLots)
	}
	if report.Quality.RowsWithoutLotNumber != 6 || report.Quality.RowsWithoutLotSource != 4 {
		t.Errorf("identifier quality = %#v", report.Quality)
	}
}

func TestBuildReportValidationAndEmptyResult(t *testing.T) {
	tests := []struct {
		name    string
		request ReportRequest
		marker  string
	}{
		{name: "query", request: ReportRequest{OrganizationQuery: "A"}, marker: "организацию"},
		{name: "top too low", request: ReportRequest{OrganizationQuery: "AA", TopN: -1}, marker: "top_n"},
		{name: "top too high", request: ReportRequest{OrganizationQuery: "AA", TopN: 101}, marker: "top_n"},
		{name: "bad from", request: ReportRequest{OrganizationQuery: "AA", DateFrom: "01.01.2026"}, marker: "date_from"},
		{name: "bad to", request: ReportRequest{OrganizationQuery: "AA", DateTo: "2026-02-30"}, marker: "date_to"},
		{name: "reverse period", request: ReportRequest{OrganizationQuery: "AA", DateFrom: "2026-02-01", DateTo: "2026-01-01"}, marker: "позже"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := BuildReport(nil, test.request, reportTestMeta())
			if err == nil || !strings.Contains(err.Error(), test.marker) {
				t.Fatalf("BuildReport() error = %v, want marker %q", err, test.marker)
			}
		})
	}

	report, err := BuildReport(nil, ReportRequest{OrganizationQuery: "AA"}, reportTestMeta())
	if err != nil {
		t.Fatalf("empty BuildReport() error = %v", err)
	}
	if report.KPIs.TotalLots != 0 || len(report.Conclusions) != 1 || !strings.Contains(report.Conclusions[0], "не найдены") {
		t.Errorf("empty report = %#v", report)
	}
}

func TestReportFormatting(t *testing.T) {
	if got := formatReportTenge(1234567.49); got != "1\u00a0234\u00a0567 тг" {
		t.Errorf("formatReportTenge() = %q", got)
	}
	if got := formatReportTenge(-1234.6); got != "-1\u00a0235 тг" {
		t.Errorf("formatReportTenge(negative) = %q", got)
	}
	value := time.Date(2026, time.July, 14, 0, 0, 0, 0, reportLocation)
	if got := formatReportDate(&value); got != "14.07.2026" {
		t.Errorf("formatReportDate() = %q", got)
	}
}
