package analytics

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

func reportDOCXFixture() ReportData {
	deadline := time.Date(2026, time.July, 31, 18, 0, 0, 0, reportLocation)
	return ReportData{
		Header: ReportHeader{
			Title:                 reportTitle,
			OrganizationQuery:     "123456789012",
			Organizations:         []string{"АО & Co\x01"},
			Platforms:             []string{"Госзакупки РК"},
			DateFrom:              "2026-01-01",
			DateTo:                "2026-07-14",
			DataAsOf:              time.Date(2026, time.July, 14, 12, 0, 0, 0, reportLocation),
			GeneratedAt:           time.Date(2026, time.July, 14, 12, 5, 0, 0, reportLocation),
			Source:                "TenderPlus API",
			DeduplicationMethod:   reportDedupMethod,
			DateBasis:             reportDateBasis,
			AmountCalculationNote: reportAmountNote,
		},
		KPIs: ReportKPIs{
			TotalLots:         1,
			CompletedLots:     1,
			TotalAmount:       1234567,
			LotsWithoutAmount: 0,
		},
		ByPurchaseType:    []ReportBreakdown{{Name: "Открытый тендер", Count: 1, Amount: 1234567}},
		ByServiceCategory: []ReportBreakdown{{Name: "Услуги", Count: 1, Amount: 1234567}},
		TopTenders: []ReportTopTender{{
			LotNumber:       "LOT-1",
			Title:           "Связь & интернет",
			Amount:          1234567,
			AmountAvailable: true,
			Deadline:        &deadline,
			Status:          "Завершен",
		}},
		RepeatedLots: []ReportRepeatedLot{{
			LotNumber:              "LOT-1",
			Occurrences:            2,
			PublicationCount:       2,
			PossibleReannouncement: true,
			Status:                 "Завершен",
		}},
		Conclusions: []string{"Наибольшая сумма приходится на услуги."},
		Quality: ReportQuality{
			SourceRows:   2,
			FilteredRows: 2,
			UniqueLots:   1,
			Warnings:     []string{"Проверить & подтвердить."},
		},
	}
}

func TestBuildReportDOCXProducesValidOOXML(t *testing.T) {
	content, err := BuildReportDOCX(reportDOCXFixture())
	if err != nil {
		t.Fatalf("BuildReportDOCX() error = %v", err)
	}
	if len(content) < 4 || !bytes.Equal(content[:2], []byte("PK")) {
		t.Fatalf("DOCX does not have a ZIP signature")
	}
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatalf("open DOCX ZIP: %v", err)
	}
	required := map[string]bool{
		"[Content_Types].xml":          false,
		"_rels/.rels":                  false,
		"docProps/app.xml":             false,
		"docProps/core.xml":            false,
		"word/document.xml":            false,
		"word/styles.xml":              false,
		"word/settings.xml":            false,
		"word/_rels/document.xml.rels": false,
	}
	parts := make(map[string][]byte)
	for _, file := range reader.File {
		stream, openErr := file.Open()
		if openErr != nil {
			t.Fatalf("open part %s: %v", file.Name, openErr)
		}
		body, readErr := io.ReadAll(stream)
		_ = stream.Close()
		if readErr != nil {
			t.Fatalf("read part %s: %v", file.Name, readErr)
		}
		parts[file.Name] = body
		if _, exists := required[file.Name]; exists {
			required[file.Name] = true
		}
		if strings.HasSuffix(file.Name, ".xml") || strings.HasSuffix(file.Name, ".rels") {
			decoder := xml.NewDecoder(bytes.NewReader(body))
			for {
				_, tokenErr := decoder.Token()
				if tokenErr == io.EOF {
					break
				}
				if tokenErr != nil {
					t.Fatalf("part %s is not well-formed XML: %v", file.Name, tokenErr)
				}
			}
		}
	}
	for name, found := range required {
		if !found {
			t.Errorf("required DOCX part %s is missing", name)
		}
	}

	document := string(parts["word/document.xml"])
	for _, marker := range []string{
		"Аналитическая справка по тендерам",
		"Ключевые показатели",
		"Разбивка по типу закупки",
		"Разбивка по категориям услуг",
		"Топ-1 тендеров по сумме",
		"Краткие выводы",
		"Методология и качество данных",
		"АО &amp; Co",
		"Связь &amp; интернет",
		"1\u00a0234\u00a0567 тг",
		"14.07.2026",
		`<w:pgSz w:w="11906" w:h="16838"/>`,
	} {
		if !strings.Contains(document, marker) {
			t.Errorf("document.xml is missing %q", marker)
		}
	}
	if strings.ContainsRune(document, '\x01') {
		t.Error("document.xml contains an invalid XML control character")
	}
	tableCount := strings.Count(document, "<w:tbl>")
	if tableCount == 0 || strings.Count(document, `<w:tblInd w:w="120" w:type="dxa"/>`) != tableCount {
		t.Errorf("table indentation is not present on every table")
	}
	if strings.Count(document, `<w:tblHeader w:val="true"/>`) != tableCount {
		t.Errorf("repeating header row is not present on every table")
	}
	if strings.Contains(document, "<w:keepNext/></w:pPr><w:r><w:rPr>") {
		t.Error("table-cell paragraphs should not be chained with keepNext")
	}

	gridRE := regexp.MustCompile(`(?s)<w:tblGrid>(.*?)</w:tblGrid>`)
	widthRE := regexp.MustCompile(`<w:gridCol w:w="(\d+)"/>`)
	grids := gridRE.FindAllStringSubmatch(document, -1)
	if len(grids) != tableCount {
		t.Fatalf("found %d grids for %d tables", len(grids), tableCount)
	}
	for index, grid := range grids {
		var sum int
		for _, match := range widthRE.FindAllStringSubmatch(grid[1], -1) {
			width, conversionErr := strconv.Atoi(match[1])
			if conversionErr != nil {
				t.Fatalf("grid %d width conversion: %v", index, conversionErr)
			}
			sum += width
		}
		if sum != 9800 {
			t.Errorf("grid %d width sum = %d, want 9800", index, sum)
		}
	}
}

func TestBuildReportDocumentXMLFormatsOneSidedPeriods(t *testing.T) {
	tests := []struct {
		name string
		from string
		to   string
		want string
	}{
		{name: "from only", from: "2026-01-01", want: "с 01.01.2026"},
		{name: "to only", to: "2026-01-31", want: "по 31.01.2026"},
		{name: "both", from: "2026-01-01", to: "2026-01-31", want: "01.01.2026 — 31.01.2026"},
		{name: "none", want: "Весь доступный период"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			report := reportDOCXFixture()
			report.Header.DateFrom = test.from
			report.Header.DateTo = test.to
			document := buildReportDocumentXML(report)
			if !strings.Contains(document, test.want) {
				t.Errorf("period XML does not contain %q", test.want)
			}
		})
	}
}

func TestReportDOCXFileName(t *testing.T) {
	report := reportDOCXFixture()
	if got := ReportDOCXFileName(report); got != "analytics_report_20260101_20260714.docx" {
		t.Errorf("ReportDOCXFileName() = %q", got)
	}
	report.Header.DateFrom = ""
	report.Header.DateTo = ""
	if got := ReportDOCXFileName(report); got != "analytics_report_20260714.docx" {
		t.Errorf("ReportDOCXFileName(no period) = %q", got)
	}
}
