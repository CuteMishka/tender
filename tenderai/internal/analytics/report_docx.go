package analytics

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const docxMainNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

// BuildReportDOCX renders ReportData into a self-contained OOXML Word file
// using only the Go standard library.
func BuildReportDOCX(report ReportData) ([]byte, error) {
	documentXML := buildReportDocumentXML(report)
	createdAt := report.Header.GeneratedAt
	if createdAt.IsZero() {
		createdAt = report.Header.DataAsOf
	}
	if createdAt.IsZero() {
		createdAt = time.Unix(0, 0).UTC()
	}

	files := []struct {
		name string
		body string
	}{
		{"[Content_Types].xml", reportContentTypesXML},
		{"_rels/.rels", reportRootRelationshipsXML},
		{"docProps/app.xml", reportAppPropertiesXML},
		{"docProps/core.xml", buildReportCorePropertiesXML(createdAt)},
		{"word/document.xml", documentXML},
		{"word/styles.xml", reportStylesXML},
		{"word/settings.xml", reportSettingsXML},
		{"word/_rels/document.xml.rels", reportDocumentRelationshipsXML},
	}

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, file := range files {
		part, err := writer.Create(file.name)
		if err != nil {
			_ = writer.Close()
			return nil, fmt.Errorf("создание части %s: %w", file.name, err)
		}
		if _, err := part.Write([]byte(file.body)); err != nil {
			_ = writer.Close()
			return nil, fmt.Errorf("запись части %s: %w", file.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("завершение DOCX: %w", err)
	}
	return buffer.Bytes(), nil
}

func ReportDOCXFileName(report ReportData) string {
	from := strings.ReplaceAll(report.Header.DateFrom, "-", "")
	to := strings.ReplaceAll(report.Header.DateTo, "-", "")
	suffix := strings.Trim(strings.Join([]string{from, to}, "_"), "_")
	if suffix == "" {
		date := report.Header.GeneratedAt
		if date.IsZero() {
			date = report.Header.DataAsOf
		}
		if !date.IsZero() {
			suffix = date.In(reportLocation).Format("20060102")
		} else {
			suffix = "report"
		}
	}
	return "analytics_report_" + suffix + ".docx"
}

type reportDocumentBuilder struct {
	strings.Builder
}

func buildReportDocumentXML(report ReportData) string {
	var document reportDocumentBuilder
	document.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	document.WriteString(`<w:document xmlns:w="` + docxMainNamespace + `" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`)
	title := strings.TrimSpace(report.Header.Title)
	if title == "" {
		title = reportTitle
	}
	document.paragraph(title, "ReportTitle", "center", false)
	document.paragraph("Сформировано автоматически на основании данных тендерного портала", "ReportSubtitle", "center", false)
	document.spacer()

	organizations := strings.Join(report.Header.Organizations, "; ")
	if organizations == "" {
		organizations = report.Header.OrganizationQuery
	}
	platforms := strings.Join(report.Header.Platforms, "; ")
	if platforms == "" {
		platforms = "Все доступные площадки"
	}
	period := "Весь доступный период"
	switch {
	case report.Header.DateFrom != "" && report.Header.DateTo != "":
		period = formatReportDateInput(report.Header.DateFrom) + " — " + formatReportDateInput(report.Header.DateTo)
	case report.Header.DateFrom != "":
		period = "с " + formatReportDateInput(report.Header.DateFrom)
	case report.Header.DateTo != "":
		period = "по " + formatReportDateInput(report.Header.DateTo)
	}
	headerRows := [][]string{
		{"Организация", organizations},
		{"Площадка", platforms},
		{"Период", period},
		{"Дата выгрузки данных", formatReportDate(&report.Header.DataAsOf)},
		{"Дата формирования", formatReportDate(&report.Header.GeneratedAt)},
		{"Источник", report.Header.Source},
	}
	document.table([]string{"Параметр", "Значение"}, headerRows, []int{2800, 7000})

	document.heading("Ключевые показатели", 1)
	kpiRows := [][]string{
		{"Всего уникальных лотов", strconv.Itoa(report.KPIs.TotalLots)},
		{"Завершено", strconv.Itoa(report.KPIs.CompletedLots)},
		{"Отменено", strconv.Itoa(report.KPIs.CancelledLots)},
		{"Несостоявшиеся закупки", strconv.Itoa(report.KPIs.FailedLots)},
		{"Лотов без указанной суммы", strconv.Itoa(report.KPIs.LotsWithoutAmount)},
		{"Общая сумма", formatReportTenge(report.KPIs.TotalAmount)},
		{"Возможные переобъявления", strconv.Itoa(report.KPIs.PossibleReannouncements)},
	}
	document.table([]string{"Показатель", "Значение"}, kpiRows, []int{6800, 3000})

	document.heading("Разбивка по типу закупки", 1)
	document.breakdownTable("Тип закупки", report.ByPurchaseType)

	document.heading("Разбивка по категориям услуг", 1)
	document.breakdownTable("Категория", report.ByServiceCategory)

	document.heading(fmt.Sprintf("Топ-%d тендеров по сумме", len(report.TopTenders)), 1)
	if len(report.TopTenders) == 0 {
		document.paragraph("Нет лотов с указанной суммой.", "ReportBody", "left", false)
	} else {
		rows := make([][]string, 0, len(report.TopTenders))
		for _, tender := range report.TopTenders {
			rows = append(rows, []string{
				tender.LotNumber,
				tender.Title,
				formatReportTenge(tender.Amount),
				formatReportDate(tender.Deadline),
				tender.Status,
			})
		}
		document.table([]string{"№ лота", "Наименование", "Сумма", "Срок", "Статус"}, rows, []int{1500, 3700, 1700, 1300, 1600})
	}

	if len(report.RepeatedLots) > 0 {
		document.heading("Повторные записи и возможные переобъявления", 1)
		rows := make([][]string, 0, len(report.RepeatedLots))
		for _, lot := range report.RepeatedLots {
			marker := "Повторные строки"
			switch {
			case lot.PossibleReannouncement:
				marker = "Возможное переобъявление"
			case lot.StageTransition:
				marker = "Переход стадии"
			}
			rows = append(rows, []string{
				lot.LotNumber,
				strconv.Itoa(lot.Occurrences),
				strconv.Itoa(lot.PublicationCount),
				marker,
				lot.Status,
			})
		}
		document.table([]string{"№ лота", "Строк", "Публикаций", "Признак", "Статус"}, rows, []int{1800, 900, 1100, 3300, 2700})
	}

	document.heading("Краткие выводы", 1)
	for _, conclusion := range report.Conclusions {
		document.paragraph(conclusion, "ReportBody", "left", false)
	}

	document.heading("Методология и качество данных", 1)
	document.paragraph("Дедупликация: "+report.Header.DeduplicationMethod+".", "ReportSmall", "left", false)
	document.paragraph("Период: "+report.Header.DateBasis+".", "ReportSmall", "left", false)
	document.paragraph(report.Header.AmountCalculationNote+".", "ReportSmall", "left", false)
	document.paragraph(fmt.Sprintf("Исходных строк: %d; после фильтров: %d; уникальных лотов: %d.", report.Quality.SourceRows, report.Quality.FilteredRows, report.Quality.UniqueLots), "ReportSmall", "left", false)
	for _, warning := range report.Quality.Warnings {
		document.paragraph(warning, "ReportSmall", "left", false)
	}
	document.spacer()
	document.paragraph("Документ сформирован автоматически. Признак возможного переобъявления требует проверки по первоисточнику.", "ReportFooter", "center", false)
	document.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`)
	document.WriteString(`</w:body></w:document>`)
	return document.String()
}

func (document *reportDocumentBuilder) breakdownTable(label string, values []ReportBreakdown) {
	if len(values) == 0 {
		document.paragraph("Нет данных.", "ReportBody", "left", false)
		return
	}
	rows := make([][]string, 0, len(values))
	for _, value := range values {
		rows = append(rows, []string{value.Name, strconv.Itoa(value.Count), formatReportTenge(value.Amount)})
	}
	document.table([]string{label, "Количество лотов", "Сумма"}, rows, []int{5900, 1800, 2100})
}

func (document *reportDocumentBuilder) heading(text string, level int) {
	style := "ReportHeading1"
	if level > 1 {
		style = "ReportHeading2"
	}
	document.paragraph(text, style, "left", false)
}

func (document *reportDocumentBuilder) spacer() {
	document.paragraph("", "ReportBody", "left", false)
}

func (document *reportDocumentBuilder) paragraph(text, style, alignment string, bold bool) {
	document.WriteString(`<w:p><w:pPr>`)
	if style != "" {
		document.WriteString(`<w:pStyle w:val="` + escapeReportXML(style) + `"/>`)
	}
	if alignment != "" {
		document.WriteString(`<w:jc w:val="` + escapeReportXML(alignment) + `"/>`)
	}
	document.WriteString(`</w:pPr><w:r>`)
	if bold {
		document.WriteString(`<w:rPr><w:b/></w:rPr>`)
	}
	document.WriteString(`<w:t xml:space="preserve">` + escapeReportXML(text) + `</w:t></w:r></w:p>`)
}

func (document *reportDocumentBuilder) table(headers []string, rows [][]string, widths []int) {
	document.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="9800" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="6" w:color="B7C9C1"/><w:left w:val="single" w:sz="6" w:color="B7C9C1"/><w:bottom w:val="single" w:sz="6" w:color="B7C9C1"/><w:right w:val="single" w:sz="6" w:color="B7C9C1"/><w:insideH w:val="single" w:sz="4" w:color="D9E3DF"/><w:insideV w:val="single" w:sz="4" w:color="D9E3DF"/></w:tblBorders></w:tblPr><w:tblGrid>`)
	for _, width := range widths {
		document.WriteString(`<w:gridCol w:w="` + strconv.Itoa(width) + `"/>`)
	}
	document.WriteString(`</w:tblGrid>`)
	document.tableRow(headers, widths, true, false)
	for index, row := range rows {
		document.tableRow(row, widths, false, index%2 == 1)
	}
	document.WriteString(`</w:tbl>`)
	document.spacer()
}

func (document *reportDocumentBuilder) tableRow(values []string, widths []int, header, shaded bool) {
	document.WriteString(`<w:tr>`)
	if header {
		document.WriteString(`<w:trPr><w:tblHeader w:val="true"/></w:trPr>`)
	}
	for index, width := range widths {
		value := ""
		if index < len(values) {
			value = values[index]
		}
		document.WriteString(`<w:tc><w:tcPr><w:tcW w:w="` + strconv.Itoa(width) + `" w:type="dxa"/><w:vAlign w:val="center"/>`)
		if header {
			document.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="166534"/>`)
		} else if shaded {
			document.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="F3F7F5"/>`)
		}
		document.WriteString(`</w:tcPr><w:p><w:pPr><w:pStyle w:val="ReportTableText"/>`)
		if header {
			document.WriteString(`<w:jc w:val="center"/>`)
		}
		document.WriteString(`</w:pPr><w:r><w:rPr>`)
		if header {
			document.WriteString(`<w:b/><w:color w:val="FFFFFF"/>`)
		}
		document.WriteString(`</w:rPr><w:t xml:space="preserve">` + escapeReportXML(value) + `</w:t></w:r></w:p></w:tc>`)
	}
	document.WriteString(`</w:tr>`)
}

func escapeReportXML(value string) string {
	// XML 1.0 rejects most ASCII control characters. User/source text can
	// contain them, so remove only invalid runes before escaping markup.
	value = strings.Map(func(r rune) rune {
		if r == '\t' || r == '\n' || r == '\r' || r >= 0x20 {
			return r
		}
		return -1
	}, value)
	var buffer bytes.Buffer
	_ = xml.EscapeText(&buffer, []byte(value))
	return buffer.String()
}

func buildReportCorePropertiesXML(createdAt time.Time) string {
	stamp := createdAt.UTC().Format(time.RFC3339)
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
		`<dc:title>` + escapeReportXML(reportTitle) + `</dc:title><dc:creator>Tender Portal</dc:creator><cp:lastModifiedBy>Tender Portal</cp:lastModifiedBy>` +
		`<dcterms:created xsi:type="dcterms:W3CDTF">` + stamp + `</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">` + stamp + `</dcterms:modified></cp:coreProperties>`
}

const reportContentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const reportRootRelationshipsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const reportDocumentRelationshipsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`

const reportAppPropertiesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Tender Portal</Application><AppVersion>1.0</AppVersion></Properties>`

const reportSettingsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/><w:compat/></w:settings>`

// reportStylesXML resolves the decision_memo/standard_business_brief preset.
// Named overrides: Arial throughout, portal green hierarchy/table headers,
// compact 9 pt table text and A4 geometry for a Kazakhstan business report.
const reportStylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="ReportTitle"><w:name w:val="Report Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="166534"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportSubtitle"><w:name w:val="Report Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="180"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="64748B"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportHeading1"><w:name w:val="Report Heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="166534"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportHeading2"><w:name w:val="Report Heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="166534"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportBody"><w:name w:val="Report Body"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportSmall"><w:name w:val="Report Small"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:color w:val="475569"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportFooter"><w:name w:val="Report Footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="160"/></w:pPr><w:rPr><w:i/><w:color w:val="64748B"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ReportTableText"><w:name w:val="Report Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
</w:styles>`
