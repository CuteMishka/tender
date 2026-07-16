package analytics

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var (
	errReportQueryRequired = errors.New("укажите организацию или БИН для формирования справки")
	reportLocation         = loadReportLocation()
)

const (
	reportTitle       = "Аналитическая справка по тендерам"
	reportDateBasis   = "Дата публикации; при отсутствии — дата окончания, затем дата начала"
	reportDedupMethod = "Площадка + нормализованный номер лота; при отсутствии номера — идентификатор лота источника, затем внутренний ID TenderPlus"
	reportAmountNote  = "Сумма каждого уникального лота учитывается один раз; лоты без указанной суммы входят в количество, но не в общую сумму"
)

type normalizedReportRequest struct {
	request          ReportRequest
	from             *time.Time
	toExclusive      *time.Time
	platforms        map[string]struct{}
	organizationNorm string
	topN             int
}

type reportLot struct {
	key                    string
	lotNumber              string
	lotSource              string
	title                  string
	amount                 float64
	amountAvailable        bool
	deadline               *time.Time
	effectiveDate          *time.Time
	status                 string
	statusGroup            ReportStatus
	platform               string
	organization           string
	purchaseType           string
	serviceCategory        string
	occurrences            int
	publicationCount       int
	stageTransition        bool
	possibleReannouncement bool
	amountConflict         bool
	usedAmountFallback     bool
}

// BuildReport is the pure report-calculation core. It does not fetch data,
// inspect HTTP state or read the clock; all variable metadata is supplied by
// the caller through ReportBuildMeta.
func BuildReport(rows []CompanyTender, request ReportRequest, meta ReportBuildMeta) (ReportData, error) {
	normalized, err := normalizeReportRequest(request)
	if err != nil {
		return ReportData{}, err
	}

	availablePlatforms, availableOrganizations := collectReportFilterOptions(rows)
	filtered := filterReportRows(rows, normalized)
	quality := ReportQuality{
		SourceRows:   len(rows),
		FilteredRows: len(filtered),
		Warnings:     append([]string(nil), meta.Warnings...),
	}

	groups := make(map[string][]CompanyTender)
	for index, row := range filtered {
		if cleanReportIdentifier(row.LotNumber) == "" {
			quality.RowsWithoutLotNumber++
		}
		if cleanReportIdentifier(row.LotSource) == "" {
			quality.RowsWithoutLotSource++
		}
		key := reportDedupKey(row)
		// Rows without every stable source identifier must remain distinct. An
		// absent internal ID is not a real shared identifier and must never make
		// unrelated rows collapse into one lot.
		if row.ID <= 0 && cleanReportIdentifier(row.LotNumber) == "" && cleanReportIdentifier(row.LotSource) == "" {
			key += "|ROW:" + strconv.Itoa(index)
		}
		groups[key] = append(groups[key], row)
	}

	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	lots := make([]reportLot, 0, len(keys))
	for _, key := range keys {
		lot := buildReportLot(key, groups[key])
		lots = append(lots, lot)
		if lot.statusGroup == ReportStatusUnknown {
			quality.LotsWithUnknownStatus++
		}
		if lot.amountConflict {
			quality.LotsWithConflictingAmounts++
		}
		if lot.usedAmountFallback {
			quality.LotsUsingAmountFallback++
		}
		if lot.statusGroup == ReportStatusActive && lot.deadline != nil && !meta.DataAsOf.IsZero() && lot.deadline.Before(meta.DataAsOf) {
			quality.PastDeadlineActiveLots++
		}
	}
	quality.UniqueLots = len(lots)
	appendReportQualityWarnings(&quality)

	report := ReportData{
		Header:                 buildReportHeader(lots, normalized.request, meta),
		AvailablePlatforms:     availablePlatforms,
		AvailableOrganizations: availableOrganizations,
		Quality:                quality,
	}
	report.KPIs = buildReportKPIs(lots)
	report.ByPurchaseType = buildReportBreakdown(lots, func(lot reportLot) string { return lot.purchaseType })
	report.ByServiceCategory = buildReportBreakdown(lots, func(lot reportLot) string { return lot.serviceCategory })
	report.TopTenders = buildReportTop(lots, normalized.topN)
	report.RepeatedLots = buildRepeatedLots(lots)
	report.Conclusions = buildReportConclusions(report)
	return report, nil
}

func normalizeReportRequest(request ReportRequest) (normalizedReportRequest, error) {
	request.OrganizationQuery = strings.TrimSpace(request.OrganizationQuery)
	request.Organization = strings.TrimSpace(request.Organization)
	request.DateFrom = strings.TrimSpace(request.DateFrom)
	request.DateTo = strings.TrimSpace(request.DateTo)
	if len([]rune(request.OrganizationQuery)) < 2 {
		return normalizedReportRequest{}, errReportQueryRequired
	}

	topN := request.TopN
	if topN == 0 {
		topN = defaultReportTopN
	}
	if topN < 1 || topN > maxReportTopN {
		return normalizedReportRequest{}, fmt.Errorf("top_n должен быть от 1 до %d", maxReportTopN)
	}
	request.TopN = topN

	from, err := parseReportDate(request.DateFrom, "date_from")
	if err != nil {
		return normalizedReportRequest{}, err
	}
	to, err := parseReportDate(request.DateTo, "date_to")
	if err != nil {
		return normalizedReportRequest{}, err
	}
	if from != nil && to != nil && from.After(*to) {
		return normalizedReportRequest{}, errors.New("date_from не может быть позже date_to")
	}
	var toExclusive *time.Time
	if to != nil {
		value := to.AddDate(0, 0, 1)
		toExclusive = &value
	}

	platforms := make(map[string]struct{})
	cleanPlatforms := make([]string, 0, len(request.Platforms))
	seenPlatforms := make(map[string]struct{})
	for _, platform := range request.Platforms {
		platform = strings.TrimSpace(platform)
		key := normalizeReportText(platform)
		if key == "" {
			continue
		}
		platforms[key] = struct{}{}
		if _, exists := seenPlatforms[key]; !exists {
			seenPlatforms[key] = struct{}{}
			cleanPlatforms = append(cleanPlatforms, platform)
		}
	}
	sortReportStrings(cleanPlatforms)
	request.Platforms = cleanPlatforms

	return normalizedReportRequest{
		request:          request,
		from:             from,
		toExclusive:      toExclusive,
		platforms:        platforms,
		organizationNorm: normalizeReportText(request.Organization),
		topN:             topN,
	}, nil
}

func parseReportDate(value, field string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, reportLocation)
	if err != nil || parsed.Format("2006-01-02") != value {
		return nil, fmt.Errorf("%s должен быть в формате YYYY-MM-DD", field)
	}
	return &parsed, nil
}

func filterReportRows(rows []CompanyTender, request normalizedReportRequest) []CompanyTender {
	filtered := make([]CompanyTender, 0, len(rows))
	for _, row := range rows {
		if len(request.platforms) > 0 {
			if _, ok := request.platforms[normalizeReportText(row.Platform)]; !ok {
				continue
			}
		}
		if request.organizationNorm != "" {
			haystack := normalizeReportText(strings.Join([]string{row.CustomerName, row.CustomerBIN, row.Organizer}, " "))
			if !strings.Contains(haystack, request.organizationNorm) {
				continue
			}
		}
		if request.from != nil || request.toExclusive != nil {
			date := companyTenderReportDate(row)
			if date == nil {
				continue
			}
			localDate := date.In(reportLocation)
			if request.from != nil && localDate.Before(*request.from) {
				continue
			}
			if request.toExclusive != nil && !localDate.Before(*request.toExclusive) {
				continue
			}
		}
		filtered = append(filtered, row)
	}
	return filtered
}

func collectReportFilterOptions(rows []CompanyTender) ([]string, []string) {
	platforms := make(map[string]string)
	organizations := make(map[string]string)
	add := func(values map[string]string, value string) {
		value = strings.TrimSpace(value)
		key := normalizeReportText(value)
		if key == "" {
			return
		}
		if current, ok := values[key]; !ok || strings.Compare(value, current) < 0 {
			values[key] = value
		}
	}
	for _, row := range rows {
		add(platforms, row.Platform)
		add(organizations, row.CustomerName)
		add(organizations, row.Organizer)
		if strings.TrimSpace(row.CustomerName) == "" && strings.TrimSpace(row.Organizer) == "" {
			add(organizations, row.CustomerBIN)
		}
	}
	return sortedReportMapValues(platforms), sortedReportMapValues(organizations)
}

func reportDedupKey(row CompanyTender) string {
	platform := cleanReportIdentifier(row.Platform)
	if platform == "" {
		platform = "PLATFORM-UNKNOWN"
	}
	if lotNumber := cleanReportIdentifier(row.LotNumber); lotNumber != "" {
		return platform + "|LOT:" + lotNumber
	}
	if lotSource := cleanReportIdentifier(row.LotSource); lotSource != "" {
		return platform + "|SOURCE:" + lotSource
	}
	return platform + "|ID:" + strconv.Itoa(row.ID)
}

func buildReportLot(key string, rows []CompanyTender) reportLot {
	ordered := append([]CompanyTender(nil), rows...)
	sort.SliceStable(ordered, func(i, j int) bool {
		leftPreliminary := isPreliminaryTender(ordered[i])
		rightPreliminary := isPreliminaryTender(ordered[j])
		if leftPreliminary != rightPreliminary {
			return !leftPreliminary
		}
		leftDate := companyTenderReportDate(ordered[i])
		rightDate := companyTenderReportDate(ordered[j])
		if compareReportDates(leftDate, rightDate) != 0 {
			return compareReportDates(leftDate, rightDate) > 0
		}
		return ordered[i].ID > ordered[j].ID
	})
	representative := ordered[0]

	lot := reportLot{
		key:             key,
		lotNumber:       firstReportValue(ordered, func(row CompanyTender) string { return row.LotNumber }),
		lotSource:       firstReportValue(ordered, func(row CompanyTender) string { return row.LotSource }),
		title:           firstReportValue(ordered, func(row CompanyTender) string { return row.Title }),
		deadline:        firstReportDate(ordered, func(row CompanyTender) *time.Time { return row.EndDate }),
		effectiveDate:   companyTenderReportDate(representative),
		platform:        firstReportValue(ordered, func(row CompanyTender) string { return row.Platform }),
		organization:    firstReportOrganization(ordered),
		purchaseType:    firstReportValue(ordered, func(row CompanyTender) string { return row.PurchaseType }),
		serviceCategory: firstReportCategory(ordered),
		occurrences:     distinctReportOccurrences(rows),
	}
	if lot.lotNumber == "" {
		lot.lotNumber = fmt.Sprintf("ID %d", representative.ID)
	}
	if lot.title == "" {
		lot.title = "Без наименования"
	}
	if lot.platform == "" {
		lot.platform = "Площадка не указана"
	}
	if lot.organization == "" {
		lot.organization = "Организация не указана"
	}
	if lot.purchaseType == "" {
		lot.purchaseType = "Не указано"
	}
	if lot.serviceCategory == "" {
		lot.serviceCategory = "Не указано"
	}
	lot.statusGroup, lot.status = aggregateReportStatus(ordered)

	if representative.AmountAvailable {
		lot.amount = representative.Amount
		lot.amountAvailable = true
	} else {
		for _, row := range ordered[1:] {
			if row.AmountAvailable {
				lot.amount = row.Amount
				lot.amountAvailable = true
				lot.usedAmountFallback = true
				break
			}
		}
	}
	lot.amountConflict = hasConflictingReportAmounts(rows)

	hasPreliminary := false
	hasNonPreliminary := false
	publicationIDs := make(map[string]struct{})
	for _, row := range rows {
		if isPreliminaryTender(row) {
			hasPreliminary = true
			continue
		}
		hasNonPreliminary = true
		if id := reportPublicationID(row); id != "" {
			publicationIDs[id] = struct{}{}
		}
	}
	lot.stageTransition = hasPreliminary && hasNonPreliminary
	lot.publicationCount = len(publicationIDs)
	if lot.publicationCount == 0 && len(rows) > 0 {
		lot.publicationCount = 1
	}
	lot.possibleReannouncement = len(publicationIDs) > 1
	return lot
}

func firstReportValue(rows []CompanyTender, pick func(CompanyTender) string) string {
	for _, row := range rows {
		if value := strings.TrimSpace(pick(row)); value != "" {
			return value
		}
	}
	return ""
}

func firstReportDate(rows []CompanyTender, pick func(CompanyTender) *time.Time) *time.Time {
	for _, row := range rows {
		if value := pick(row); value != nil && !value.IsZero() {
			copyValue := *value
			return &copyValue
		}
	}
	return nil
}

func firstReportOrganization(rows []CompanyTender) string {
	if value := firstReportValue(rows, func(row CompanyTender) string { return row.CustomerName }); value != "" {
		return value
	}
	if value := firstReportValue(rows, func(row CompanyTender) string { return row.Organizer }); value != "" {
		return value
	}
	return firstReportValue(rows, func(row CompanyTender) string { return row.CustomerBIN })
}

func firstReportCategory(rows []CompanyTender) string {
	for _, pick := range []func(CompanyTender) string{
		func(row CompanyTender) string { return row.Category },
		func(row CompanyTender) string { return row.SubjectType },
		func(row CompanyTender) string { return row.EnstruTitle },
	} {
		if value := firstReportValue(rows, pick); value != "" {
			return value
		}
	}
	return ""
}

func companyTenderReportDate(row CompanyTender) *time.Time {
	for _, value := range []*time.Time{row.PublishDate, row.EndDate, row.BeginDate} {
		if value != nil && !value.IsZero() {
			copyValue := *value
			return &copyValue
		}
	}
	return nil
}

func compareReportDates(left, right *time.Time) int {
	if left == nil && right == nil {
		return 0
	}
	if left == nil {
		return -1
	}
	if right == nil {
		return 1
	}
	if left.After(*right) {
		return 1
	}
	if left.Before(*right) {
		return -1
	}
	return 0
}

func distinctReportOccurrences(rows []CompanyTender) int {
	ids := make(map[int]struct{})
	zeroIDs := 0
	for _, row := range rows {
		if row.ID > 0 {
			ids[row.ID] = struct{}{}
		} else {
			zeroIDs++
		}
	}
	return len(ids) + zeroIDs
}

func reportPublicationID(row CompanyTender) string {
	platform := cleanReportIdentifier(row.Platform)
	if value := cleanReportIdentifier(row.BuySourceID); value != "" {
		return platform + "|BUY-SOURCE:" + value
	}
	if row.BuyID > 0 {
		return platform + "|BUY-ID:" + strconv.Itoa(row.BuyID)
	}
	if value := cleanReportIdentifier(row.LotSource); value != "" {
		return platform + "|LOT-SOURCE:" + value
	}
	return ""
}

func isPreliminaryTender(row CompanyTender) bool {
	value := normalizeReportText(strings.Join([]string{
		row.Status,
		row.PurchaseType,
		row.BuyNumber,
		row.Title,
	}, " "))
	markers := []string{
		"ПРЕДВАРИТЕЛ", "ОБСУЖДЕН", "ОБСУЖДЕНИ", "PRELIMINARY", "DISCUSSION",
	}
	return containsAnyReportMarker(value, markers)
}

func hasConflictingReportAmounts(rows []CompanyTender) bool {
	amounts := make(map[int64]struct{})
	for _, row := range rows {
		if !row.AmountAvailable {
			continue
		}
		amounts[int64(math.Round(row.Amount*100))] = struct{}{}
		if len(amounts) > 1 {
			return true
		}
	}
	return false
}

func classifyReportStatus(status string) ReportStatus {
	value := normalizeReportText(status)
	if containsAnyReportMarker(value, []string{"ОТМЕН", "АННУЛИР", "ОТОЗВАН", "CANCEL", "WITHDRAW"}) {
		return ReportStatusCancelled
	}
	if containsAnyReportMarker(value, []string{"НЕСОСТОЯ", "НЕ СОСТОЯ", "FAILED", "БЕЗ ОПРЕДЕЛЕНИЯ ПОБЕДИТЕЛЯ", "ПОБЕДИТЕЛЬ НЕ ОПРЕДЕЛЕН", "ПОБЕДИТЕЛЬ НЕ ОПРЕДЕЛЁН"}) {
		return ReportStatusFailed
	}
	if containsAnyReportMarker(value, []string{"НЕ ЗАВЕРШ"}) {
		return ReportStatusActive
	}
	if containsAnyReportMarker(value, []string{"ЗАВЕРШ", "ЗАВЕРШЁН", "ИТОГ", "ДОГОВОР ЗАКЛЮЧ", "ОПРЕДЕЛЕН ПОБЕДИТЕЛЬ", "ОПРЕДЕЛЁН ПОБЕДИТЕЛЬ", "COMPLETED", "CLOSED", "FINISHED", "AWARDED"}) {
		return ReportStatusCompleted
	}
	if containsAnyReportMarker(value, []string{"ОПУБЛИК", "ПРИЕМ", "ПРИЁМ", "ОБСУЖДЕН", "ОБСУЖДЕНИ", "ОБЪЯВ", "АКТИВ", "ACTIVE", "PUBLISHED", "ACCEPTING", "OPEN"}) {
		return ReportStatusActive
	}
	return ReportStatusUnknown
}

// aggregateReportStatus applies a deterministic precedence across every raw
// occurrence of a unique lot. The human-readable status is taken from the most
// recent occurrence in the winning group because rows arrive in report order.
func aggregateReportStatus(rows []CompanyTender) (ReportStatus, string) {
	bestGroup := ReportStatusUnknown
	bestStatus := ""
	bestPriority := -1
	for _, row := range rows {
		group := classifyReportStatus(row.Status)
		priority := reportStatusPriority(group)
		if priority > bestPriority {
			bestPriority = priority
			bestGroup = group
			bestStatus = strings.TrimSpace(row.Status)
		}
	}
	if bestStatus == "" {
		bestStatus = "Не указан"
	}
	return bestGroup, bestStatus
}

func reportStatusPriority(status ReportStatus) int {
	switch status {
	case ReportStatusCancelled:
		return 5
	case ReportStatusFailed:
		return 4
	case ReportStatusCompleted:
		return 3
	case ReportStatusActive:
		return 2
	default:
		return 1
	}
}

func containsAnyReportMarker(value string, markers []string) bool {
	for _, marker := range markers {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}

func buildReportHeader(lots []reportLot, request ReportRequest, meta ReportBuildMeta) ReportHeader {
	organizations := make(map[string]string)
	platforms := make(map[string]string)
	for _, lot := range lots {
		addReportMapValue(organizations, lot.organization)
		addReportMapValue(platforms, lot.platform)
	}
	if len(organizations) == 0 {
		for _, match := range meta.Matches {
			addReportMapValue(organizations, match.Name)
		}
	}
	platformValues := sortedReportMapValues(platforms)
	if len(request.Platforms) > 0 {
		platformValues = append([]string(nil), request.Platforms...)
	}
	source := strings.TrimSpace(meta.Source)
	if source == "" {
		source = "TenderPlus API"
	}
	dataAsOf := meta.DataAsOf
	generatedAt := meta.GeneratedAt
	if dataAsOf.IsZero() {
		dataAsOf = generatedAt
	}
	if generatedAt.IsZero() {
		generatedAt = dataAsOf
	}
	return ReportHeader{
		Title:                 reportTitle,
		OrganizationQuery:     request.OrganizationQuery,
		OrganizationFilter:    request.Organization,
		Organizations:         sortedReportMapValues(organizations),
		Platforms:             platformValues,
		DateFrom:              request.DateFrom,
		DateTo:                request.DateTo,
		DataAsOf:              dataAsOf,
		GeneratedAt:           generatedAt,
		Source:                source,
		Timezone:              reportLocation.String(),
		DateBasis:             reportDateBasis,
		DeduplicationMethod:   reportDedupMethod,
		AmountCalculationNote: reportAmountNote,
	}
}

func buildReportKPIs(lots []reportLot) ReportKPIs {
	kpis := ReportKPIs{TotalLots: len(lots)}
	for _, lot := range lots {
		switch lot.statusGroup {
		case ReportStatusCancelled:
			kpis.CancelledLots++
		case ReportStatusFailed:
			kpis.FailedLots++
			kpis.CompletedLots++
		case ReportStatusCompleted:
			kpis.CompletedLots++
		}
		if lot.amountAvailable {
			kpis.TotalAmount += lot.amount
		} else {
			kpis.LotsWithoutAmount++
		}
		if lot.possibleReannouncement {
			kpis.PossibleReannouncements++
		}
	}
	return kpis
}

func buildReportBreakdown(lots []reportLot, pick func(reportLot) string) []ReportBreakdown {
	byName := make(map[string]ReportBreakdown)
	for _, lot := range lots {
		name := strings.TrimSpace(pick(lot))
		if name == "" {
			name = "Не указано"
		}
		key := normalizeReportText(name)
		row := byName[key]
		if row.Name == "" {
			row.Name = name
		}
		row.Count++
		if lot.amountAvailable {
			row.Amount += lot.amount
		}
		byName[key] = row
	}
	result := make([]ReportBreakdown, 0, len(byName))
	for _, row := range byName {
		result = append(result, row)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Amount != result[j].Amount {
			return result[i].Amount > result[j].Amount
		}
		if result[i].Count != result[j].Count {
			return result[i].Count > result[j].Count
		}
		return normalizeReportText(result[i].Name) < normalizeReportText(result[j].Name)
	})
	return result
}

func buildReportTop(lots []reportLot, limit int) []ReportTopTender {
	known := make([]reportLot, 0, len(lots))
	for _, lot := range lots {
		if lot.amountAvailable {
			known = append(known, lot)
		}
	}
	sort.SliceStable(known, func(i, j int) bool {
		if known[i].amount != known[j].amount {
			return known[i].amount > known[j].amount
		}
		if compared := compareReportDates(known[i].effectiveDate, known[j].effectiveDate); compared != 0 {
			return compared > 0
		}
		return cleanReportIdentifier(known[i].lotNumber) < cleanReportIdentifier(known[j].lotNumber)
	})
	if len(known) > limit {
		known = known[:limit]
	}
	result := make([]ReportTopTender, 0, len(known))
	for _, lot := range known {
		result = append(result, ReportTopTender{
			LotNumber:              lot.lotNumber,
			LotSource:              lot.lotSource,
			Title:                  lot.title,
			Amount:                 lot.amount,
			AmountAvailable:        lot.amountAvailable,
			Deadline:               lot.deadline,
			Status:                 lot.status,
			StatusGroup:            lot.statusGroup,
			Platform:               lot.platform,
			Organization:           lot.organization,
			PossibleReannouncement: lot.possibleReannouncement,
		})
	}
	return result
}

func buildRepeatedLots(lots []reportLot) []ReportRepeatedLot {
	result := make([]ReportRepeatedLot, 0)
	for _, lot := range lots {
		if lot.occurrences <= 1 && !lot.stageTransition && !lot.possibleReannouncement {
			continue
		}
		result = append(result, ReportRepeatedLot{
			LotNumber:              lot.lotNumber,
			LotSource:              lot.lotSource,
			Title:                  lot.title,
			Platform:               lot.platform,
			Occurrences:            lot.occurrences,
			PublicationCount:       lot.publicationCount,
			StageTransition:        lot.stageTransition,
			PossibleReannouncement: lot.possibleReannouncement,
			Status:                 lot.status,
		})
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].PossibleReannouncement != result[j].PossibleReannouncement {
			return result[i].PossibleReannouncement
		}
		if result[i].Occurrences != result[j].Occurrences {
			return result[i].Occurrences > result[j].Occurrences
		}
		if result[i].Platform != result[j].Platform {
			return normalizeReportText(result[i].Platform) < normalizeReportText(result[j].Platform)
		}
		return cleanReportIdentifier(result[i].LotNumber) < cleanReportIdentifier(result[j].LotNumber)
	})
	return result
}

func buildReportConclusions(report ReportData) []string {
	if report.KPIs.TotalLots == 0 {
		return []string{"За выбранный период лоты, соответствующие заданным фильтрам, не найдены."}
	}
	conclusions := make([]string, 0, 5)
	if row, ok := largestReportAmount(report.ByServiceCategory); ok {
		conclusions = append(conclusions, fmt.Sprintf("Наибольшая сумма приходится на категорию «%s» — %s по %d лотам.", row.Name, formatReportTenge(row.Amount), row.Count))
	}
	if row, ok := largestReportAmount(report.ByPurchaseType); ok {
		conclusions = append(conclusions, fmt.Sprintf("По типам закупки максимальный объём у «%s» — %s.", row.Name, formatReportTenge(row.Amount)))
	}
	if row, ok := largestReportCount(report.ByServiceCategory); ok {
		conclusions = append(conclusions, fmt.Sprintf("Больше всего лотов в категории «%s» — %d.", row.Name, row.Count))
	}
	conclusions = append(conclusions, fmt.Sprintf(
		"Завершено %d лотов, из них %d имеют признак несостоявшейся закупки; отменено %d.",
		report.KPIs.CompletedLots,
		report.KPIs.FailedLots,
		report.KPIs.CancelledLots,
	))
	if report.KPIs.LotsWithoutAmount > 0 {
		conclusions = append(conclusions, fmt.Sprintf("У %d из %d уникальных лотов сумма не указана и не включена в денежные итоги.", report.KPIs.LotsWithoutAmount, report.KPIs.TotalLots))
	}
	if report.KPIs.PossibleReannouncements > 0 {
		conclusions = append(conclusions, fmt.Sprintf("У %d лотов обнаружены признаки возможного переобъявления; этот признак требует проверки и сам по себе не доказывает несостоявшуюся закупку.", report.KPIs.PossibleReannouncements))
	}
	return conclusions
}

func largestReportAmount(rows []ReportBreakdown) (ReportBreakdown, bool) {
	if len(rows) == 0 {
		return ReportBreakdown{}, false
	}
	best := rows[0]
	for _, row := range rows[1:] {
		if row.Amount > best.Amount || (row.Amount == best.Amount && row.Count > best.Count) {
			best = row
		}
	}
	return best, true
}

func largestReportCount(rows []ReportBreakdown) (ReportBreakdown, bool) {
	if len(rows) == 0 {
		return ReportBreakdown{}, false
	}
	best := rows[0]
	for _, row := range rows[1:] {
		if row.Count > best.Count || (row.Count == best.Count && row.Amount > best.Amount) {
			best = row
		}
	}
	return best, true
}

func appendReportQualityWarnings(quality *ReportQuality) {
	if quality.RowsWithoutLotNumber > 0 {
		quality.Warnings = append(quality.Warnings, fmt.Sprintf("У %d строк отсутствует номер лота; для них использован резервный ключ дедупликации.", quality.RowsWithoutLotNumber))
	}
	if quality.LotsWithUnknownStatus > 0 {
		quality.Warnings = append(quality.Warnings, fmt.Sprintf("Статус %d уникальных лотов не удалось отнести к стандартной группе.", quality.LotsWithUnknownStatus))
	}
	if quality.LotsWithConflictingAmounts > 0 {
		quality.Warnings = append(quality.Warnings, fmt.Sprintf("У %d уникальных лотов разные суммы в повторных строках; использована сумма наиболее актуальной записи.", quality.LotsWithConflictingAmounts))
	}
	if quality.PastDeadlineActiveLots > 0 {
		quality.Warnings = append(quality.Warnings, fmt.Sprintf("У %d лотов активный статус сохранён после срока окончания; статус источника не был изменён автоматически.", quality.PastDeadlineActiveLots))
	}
}

func normalizeReportText(value string) string {
	value = norm.NFKC.String(value)
	value = strings.Map(func(r rune) rune {
		switch r {
		case '\u00a0', '\u202f', '\u2007':
			return ' '
		default:
			return unicode.ToUpper(r)
		}
	}, value)
	return strings.Join(strings.Fields(value), " ")
}

func cleanReportIdentifier(value string) string {
	return normalizeReportText(strings.TrimSpace(emptyParenSuffixRE.ReplaceAllString(value, "")))
}

func addReportMapValue(values map[string]string, value string) {
	value = strings.TrimSpace(value)
	key := normalizeReportText(value)
	if key == "" || key == normalizeReportText("Не указано") || key == normalizeReportText("Площадка не указана") || key == normalizeReportText("Организация не указана") {
		return
	}
	if current, ok := values[key]; !ok || strings.Compare(value, current) < 0 {
		values[key] = value
	}
}

func sortedReportMapValues(values map[string]string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	sortReportStrings(result)
	return result
}

func sortReportStrings(values []string) {
	sort.SliceStable(values, func(i, j int) bool {
		left := normalizeReportText(values[i])
		right := normalizeReportText(values[j])
		if left == right {
			return values[i] < values[j]
		}
		return left < right
	})
}

func loadReportLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Qyzylorda")
	if err == nil {
		return location
	}
	return time.FixedZone("Asia/Qyzylorda", 5*60*60)
}
