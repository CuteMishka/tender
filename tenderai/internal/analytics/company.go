package analytics

import (
	"context"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/dauren/tender/internal/tenderplus"
)

const (
	companyDisplayLimitDefault = 25
	companyDisplayLimitMax     = 10000
	companyPageSize            = 100
	companyMaxPages            = 100
	companyPageConcurrency     = 6
)

type CompanyTenderIntelligence struct {
	Query             string            `json:"query"`
	GeneratedAt       time.Time         `json:"generated_at"`
	Source            string            `json:"source"`
	Matches           []CompanyMatch    `json:"matches"`
	Summary           CompanySummary    `json:"summary"`
	Insights          []CompanyInsight  `json:"insights"`
	Aggregates        CompanyAggregates `json:"aggregates"`
	Published         []CompanyTender   `json:"published"`
	WonContracts      []CompanyContract `json:"won_contracts"`
	CustomerContracts []CompanyContract `json:"customer_contracts"`
	Participated      []CompanyOffer    `json:"participated"`
	Warnings          []string          `json:"warnings,omitempty"`
}

type CompanyMatch struct {
	Name  string   `json:"name"`
	BIN   string   `json:"bin"`
	Roles []string `json:"roles"`
	Score int      `json:"score"`
}

type CompanySummary struct {
	PublishedCount               int        `json:"published_count"`
	ActivePublishedCount         int        `json:"active_published_count"`
	PublishedBudget              float64    `json:"published_budget"`
	PublishedAmountCount         int        `json:"published_amount_count"`
	WonContractsCount            int        `json:"won_contracts_count"`
	WonContractsAmount           float64    `json:"won_contracts_amount"`
	WonContractsAmountCount      int        `json:"won_contracts_amount_count"`
	CustomerContractsCount       int        `json:"customer_contracts_count"`
	CustomerContractsAmount      float64    `json:"customer_contracts_amount"`
	CustomerContractsAmountCount int        `json:"customer_contracts_amount_count"`
	ParticipatedCount            int        `json:"participated_count"`
	LastActivityAt               *time.Time `json:"last_activity_at"`
	Confidence                   string     `json:"confidence"`
}

type CompanyInsight struct {
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
}

type CompanyAggregates struct {
	Monthly        []CompanyMonthlyPoint `json:"monthly"`
	StatusMix      []CompanyNamedValue   `json:"status_mix"`
	PlatformMix    []CompanyNamedValue   `json:"platform_mix"`
	PurchaseMix    []CompanyNamedValue   `json:"purchase_mix"`
	Counterparties []CompanyNamedMoney   `json:"counterparties"`
	Opportunities  []CompanyTender       `json:"opportunities"`
	Recent         []CompanyRecentEvent  `json:"recent"`
}

type CompanyMonthlyPoint struct {
	Label           string  `json:"label"`
	Published       int     `json:"published"`
	Won             int     `json:"won"`
	Customer        int     `json:"customer"`
	Participated    int     `json:"participated"`
	PublishedAmount float64 `json:"publishedAmount"`
	WonAmount       float64 `json:"wonAmount"`
	CustomerAmount  float64 `json:"customerAmount"`
}

type CompanyNamedValue struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

type CompanyNamedMoney struct {
	Name   string  `json:"name"`
	Count  int     `json:"count"`
	Amount float64 `json:"amount"`
}

type CompanyRecentEvent struct {
	Kind            string     `json:"kind"`
	Title           string     `json:"title"`
	Subtitle        string     `json:"subtitle"`
	Amount          float64    `json:"amount"`
	AmountAvailable bool       `json:"amount_available"`
	Status          string     `json:"status"`
	Date            *time.Time `json:"date"`
	Link            string     `json:"link"`
}

type CompanyTender struct {
	ID              int        `json:"id"`
	LotNumber       string     `json:"lot_number"`
	Title           string     `json:"title"`
	Amount          float64    `json:"amount"`
	AmountAvailable bool       `json:"amount_available"`
	Status          string     `json:"status"`
	CustomerName    string     `json:"customer_name"`
	CustomerBIN     string     `json:"customer_bin"`
	Organizer       string     `json:"organizer"`
	Platform        string     `json:"platform"`
	PurchaseType    string     `json:"purchase_type"`
	Region          string     `json:"region"`
	BeginDate       *time.Time `json:"begin_date"`
	EndDate         *time.Time `json:"end_date"`
	PublishDate     *time.Time `json:"publish_date"`
	Link            string     `json:"link"`
}

type CompanyContract struct {
	ID              int        `json:"id"`
	ContractNumber  string     `json:"contract_number"`
	Amount          float64    `json:"amount"`
	AmountAvailable bool       `json:"amount_available"`
	SignDate        *time.Time `json:"sign_date"`
	Status          string     `json:"status"`
	SupplierName    string     `json:"supplier_name"`
	SupplierBIN     string     `json:"supplier_bin"`
	CustomerName    string     `json:"customer_name"`
	CustomerBIN     string     `json:"customer_bin"`
	TenderNumber    string     `json:"tender_number"`
	TenderTitle     string     `json:"tender_title"`
}

type CompanyOffer struct {
	ID              int            `json:"id"`
	LotID           int            `json:"lot_id"`
	Amount          float64        `json:"amount"`
	AmountAvailable bool           `json:"amount_available"`
	DiscountPrice   float64        `json:"discount_price"`
	RequestDate     *time.Time     `json:"request_date"`
	Status          string         `json:"status"`
	Organization    string         `json:"organization"`
	OrganizationBIN string         `json:"organization_bin"`
	Lot             *CompanyTender `json:"lot"`
}

var (
	binLikeRE          = regexp.MustCompile(`\d{12}`)
	emptyParenSuffixRE = regexp.MustCompile(`\s*\(\s*\)\s*$`)
)

func (h *Handler) GetCompanyTenderIntelligence(w http.ResponseWriter, r *http.Request) {
	if h.TP == nil || !h.TP.Configured() {
		writeError(w, http.StatusServiceUnavailable, "TenderPlus не настроен")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) < 2 {
		writeError(w, http.StatusBadRequest, "Введите название компании или БИН")
		return
	}
	limit := companyDisplayLimitDefault
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 && n <= companyDisplayLimitMax {
			limit = n
		}
	}

	out := CompanyTenderIntelligence{
		Query:             query,
		GeneratedAt:       time.Now(),
		Source:            "TenderPlus API",
		Published:         make([]CompanyTender, 0),
		WonContracts:      make([]CompanyContract, 0),
		CustomerContracts: make([]CompanyContract, 0),
		Participated:      make([]CompanyOffer, 0),
	}

	matches := newCompanyMatchCollector()
	binHints := orderedStringSet{}
	if bin := firstBIN(query); bin != "" {
		binHints.add(bin)
		matches.add("", bin, "БИН из запроса", 10)
	}

	warnings := make([]string, 0)
	seenLots := map[int]bool{}
	seenWonContracts := map[int]bool{}
	seenCustomerContracts := map[int]bool{}
	seenOffers := map[int]bool{}
	totalCounts := companyTotalCounts{}
	var publishedKeywordTotal int
	var publishedKeywordTotalOK bool

	appendLots := func(lots []tenderplus.Lot, matchText string) {
		for _, lot := range lots {
			if !companyMatchesLot(lot, matchText) {
				continue
			}
			dto := companyTenderFromLot(lot)
			if dto.ID > 0 && !seenLots[dto.ID] {
				seenLots[dto.ID] = true
				out.Published = append(out.Published, dto)
			}
			if dto.CustomerName != "" || dto.CustomerBIN != "" {
				matches.add(dto.CustomerName, dto.CustomerBIN, "Публикует тендеры", 4)
				if dto.CustomerBIN != "" {
					binHints.add(dto.CustomerBIN)
				}
			}
		}
	}

	lots, publishedTotal, publishedTotalOK, err := listAllCompanyLotsByKeywords(r.Context(), h.TP, []string{query})
	if err != nil {
		warnings = append(warnings, "Лоты TenderPlus временно недоступны: "+err.Error())
	} else {
		publishedKeywordTotal = publishedTotal
		publishedKeywordTotalOK = publishedTotalOK
		appendLots(lots, query)
	}

	keywordContracts, _, _, err := listAllCompanyContractsByKeywords(r.Context(), h.TP, []string{query})
	if err != nil {
		warnings = append(warnings, "Договоры TenderPlus по названию временно недоступны: "+err.Error())
	} else {
		for _, contract := range keywordContracts {
			supplierMatch := companyMatchesText(query, derefStr(contract.SupplierName), derefStr(contract.SupplierBIIN))
			customerMatch := companyMatchesText(query, derefStr(contract.CustomerNameRU), derefStr(contract.CustomerBIIN))
			if supplierMatch {
				dto := companyContractFromTP(contract)
				if dto.ID > 0 && !seenWonContracts[dto.ID] {
					seenWonContracts[dto.ID] = true
					out.WonContracts = append(out.WonContracts, dto)
				}
				matches.add(dto.SupplierName, dto.SupplierBIN, "Выигрывает договоры", 6)
				if dto.SupplierBIN != "" {
					binHints.add(dto.SupplierBIN)
				}
			}
			if customerMatch {
				dto := companyContractFromTP(contract)
				if dto.ID > 0 && !seenCustomerContracts[dto.ID] {
					seenCustomerContracts[dto.ID] = true
					out.CustomerContracts = append(out.CustomerContracts, dto)
				}
				matches.add(dto.CustomerName, dto.CustomerBIN, "Заказчик по договорам", 5)
				if dto.CustomerBIN != "" {
					binHints.add(dto.CustomerBIN)
				}
			}
		}
	}

	for _, bin := range binHints.first(4) {
		binLots, binPublishedTotal, binPublishedTotalOK, err := listAllCompanyLotsByKeywords(r.Context(), h.TP, []string{bin})
		if err != nil {
			warnings = append(warnings, "Лоты заказчика "+bin+" недоступны: "+err.Error())
		} else {
			if binPublishedTotalOK {
				totalCounts.Published.add(binPublishedTotal)
			}
			appendLots(binLots, bin)
		}

		supplierContracts, supplierTotal, supplierTotalOK, err := listAllCompanySupplierContracts(r.Context(), h.TP, bin)
		if err != nil {
			warnings = append(warnings, "Договоры поставщика "+bin+" недоступны: "+err.Error())
		} else if supplierTotalOK {
			totalCounts.WonContracts.add(supplierTotal)
		}
		for _, contract := range supplierContracts {
			dto := companyContractFromTP(contract)
			if dto.ID > 0 && !seenWonContracts[dto.ID] {
				seenWonContracts[dto.ID] = true
				out.WonContracts = append(out.WonContracts, dto)
				matches.add(dto.SupplierName, dto.SupplierBIN, "Выигрывает договоры", 7)
			}
		}

		customerContracts, customerTotal, customerTotalOK, err := listAllCompanyCustomerContracts(r.Context(), h.TP, bin)
		if err != nil {
			warnings = append(warnings, "Договоры заказчика "+bin+" недоступны: "+err.Error())
		} else if customerTotalOK {
			totalCounts.CustomerContracts.add(customerTotal)
		}
		for _, contract := range customerContracts {
			dto := companyContractFromTP(contract)
			if dto.ID > 0 && !seenCustomerContracts[dto.ID] {
				seenCustomerContracts[dto.ID] = true
				out.CustomerContracts = append(out.CustomerContracts, dto)
				matches.add(dto.CustomerName, dto.CustomerBIN, "Заказчик по договорам", 6)
			}
		}

		offers, offerTotal, offerTotalOK, err := listCompanyOfferPreview(r.Context(), h.TP, bin)
		if err != nil {
			warnings = append(warnings, "Заявки участника "+bin+" недоступны: "+err.Error())
		} else if offerTotalOK {
			totalCounts.Participated.add(offerTotal)
		}
		for _, offer := range offers {
			dto := companyOfferFromTP(offer)
			if dto.ID > 0 && !seenOffers[dto.ID] {
				seenOffers[dto.ID] = true
				out.Participated = append(out.Participated, dto)
				matches.add(dto.Organization, dto.OrganizationBIN, "Участвует в закупках", 4)
			}
		}
	}

	if !totalCounts.Published.ok && publishedKeywordTotalOK {
		totalCounts.Published.set(publishedKeywordTotal)
	}

	sortCompanyResponse(&out)
	out.Matches = matches.list()
	out.Summary = buildCompanySummary(out)
	totalCounts.applyTo(&out.Summary)
	out.Insights = buildCompanyInsights(out, len(binHints.values) > 0)
	out.Aggregates = buildCompanyAggregates(out)
	trimCompanyResponse(&out, limit)
	out.Warnings = warnings
	writeJSON(w, out)
}

func listAllCompanyLotsByKeywords(ctx context.Context, client *tenderplus.Client, keywords []string) ([]tenderplus.Lot, int, bool, error) {
	return listAllCompanyPages(ctx, func(ctx context.Context, page, limit int) ([]tenderplus.Lot, map[string]interface{}, error) {
		return client.ListLotsByKeywords(ctx, keywords, page, limit)
	})
}

func listAllCompanyContractsByKeywords(ctx context.Context, client *tenderplus.Client, keywords []string) ([]tenderplus.Contract, int, bool, error) {
	return listAllCompanyPages(ctx, func(ctx context.Context, page, limit int) ([]tenderplus.Contract, map[string]interface{}, error) {
		return client.ListContractsByKeywords(ctx, keywords, page, limit)
	})
}

func listAllCompanySupplierContracts(ctx context.Context, client *tenderplus.Client, bin string) ([]tenderplus.Contract, int, bool, error) {
	return listAllCompanyPages(ctx, func(ctx context.Context, page, limit int) ([]tenderplus.Contract, map[string]interface{}, error) {
		return client.ListContractsBySupplierBIN(ctx, bin, page, limit)
	})
}

func listAllCompanyCustomerContracts(ctx context.Context, client *tenderplus.Client, bin string) ([]tenderplus.Contract, int, bool, error) {
	return listAllCompanyPages(ctx, func(ctx context.Context, page, limit int) ([]tenderplus.Contract, map[string]interface{}, error) {
		return client.ListContractsByCustomerBIN(ctx, bin, page, limit)
	})
}

func listCompanyOfferPreview(ctx context.Context, client *tenderplus.Client, bin string) ([]tenderplus.LotOffer, int, bool, error) {
	rows, extensions, err := client.ListLotOffersByOrgBIN(ctx, bin, 1, companyPageSize)
	if err != nil {
		return rows, 0, false, err
	}
	total, ok := extensionInt(extensions, "totalCount")
	return rows, total, ok, nil
}

func listAllCompanyPages[T any](ctx context.Context, fetch func(context.Context, int, int) ([]T, map[string]interface{}, error)) ([]T, int, bool, error) {
	firstRows, extensions, err := fetch(ctx, 1, companyPageSize)
	if err != nil {
		return nil, 0, false, err
	}
	all := make([]T, 0, len(firstRows))
	all = append(all, firstRows...)
	total, totalOK := extensionInt(extensions, "totalCount")
	if len(firstRows) < companyPageSize {
		return all, total, totalOK, nil
	}

	pageCount, pageCountOK := extensionInt(extensions, "pageCount")
	if !pageCountOK || pageCount <= 1 {
		rows, err := listCompanyPagesSequential(ctx, fetch, 2, companyMaxPages)
		if err != nil {
			return all, total, totalOK, err
		}
		all = append(all, rows...)
		return all, total, totalOK, nil
	}
	pageCount = minInt(pageCount, companyMaxPages)
	rows, err := listCompanyPagesParallel(ctx, fetch, 2, pageCount)
	if err != nil {
		return all, total, totalOK, err
	}
	all = append(all, rows...)
	return all, total, totalOK, nil
}

func listCompanyPagesSequential[T any](ctx context.Context, fetch func(context.Context, int, int) ([]T, map[string]interface{}, error), fromPage, toPage int) ([]T, error) {
	all := make([]T, 0)
	for page := fromPage; page <= toPage; page++ {
		rows, _, err := fetch(ctx, page, companyPageSize)
		if err != nil {
			return all, err
		}
		if len(rows) == 0 {
			return all, nil
		}
		all = append(all, rows...)
		if len(rows) < companyPageSize {
			return all, nil
		}
	}
	return all, nil
}

func listCompanyPagesParallel[T any](ctx context.Context, fetch func(context.Context, int, int) ([]T, map[string]interface{}, error), fromPage, toPage int) ([]T, error) {
	if toPage < fromPage {
		return nil, nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type pageResult struct {
		page int
		rows []T
		err  error
	}
	jobs := make(chan int)
	results := make(chan pageResult, toPage-fromPage+1)
	workerCount := minInt(companyPageConcurrency, toPage-fromPage+1)

	var wg sync.WaitGroup
	wg.Add(workerCount)
	for i := 0; i < workerCount; i++ {
		go func() {
			defer wg.Done()
			for page := range jobs {
				rows, _, err := fetch(ctx, page, companyPageSize)
				if err != nil {
					results <- pageResult{page: page, rows: rows, err: err}
					cancel()
					return
				}
				select {
				case results <- pageResult{page: page, rows: rows, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for page := fromPage; page <= toPage; page++ {
			select {
			case jobs <- page:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()

	byPage := make(map[int][]T, toPage-fromPage+1)
	for result := range results {
		if result.err != nil {
			return nil, result.err
		}
		byPage[result.page] = result.rows
	}

	all := make([]T, 0)
	for page := fromPage; page <= toPage; page++ {
		rows := byPage[page]
		if len(rows) == 0 {
			return all, nil
		}
		all = append(all, rows...)
		if len(rows) < companyPageSize {
			return all, nil
		}
	}
	return all, nil
}

type companyTotalCounts struct {
	Published         totalCounter
	WonContracts      totalCounter
	CustomerContracts totalCounter
	Participated      totalCounter
}

func (t companyTotalCounts) applyTo(summary *CompanySummary) {
	summary.PublishedCount = t.Published.apply(summary.PublishedCount)
	summary.WonContractsCount = t.WonContracts.apply(summary.WonContractsCount)
	summary.CustomerContractsCount = t.CustomerContracts.apply(summary.CustomerContractsCount)
	summary.ParticipatedCount = t.Participated.apply(summary.ParticipatedCount)
}

type totalCounter struct {
	value int
	ok    bool
}

func (c *totalCounter) set(value int) {
	if value < 0 {
		return
	}
	c.value = value
	c.ok = true
}

func (c *totalCounter) add(value int) {
	if value < 0 {
		return
	}
	c.value += value
	c.ok = true
}

func (c totalCounter) apply(current int) int {
	if c.ok && c.value > current {
		return c.value
	}
	return current
}

func extensionInt(extensions map[string]interface{}, key string) (int, bool) {
	if extensions == nil {
		return 0, false
	}
	raw, ok := extensions[key]
	if !ok {
		return 0, false
	}
	switch value := raw.(type) {
	case int:
		return value, value >= 0
	case int64:
		if value < 0 {
			return 0, false
		}
		return int(value), true
	case float64:
		if value < 0 {
			return 0, false
		}
		return int(value), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(value))
		return n, err == nil && n >= 0
	default:
		return 0, false
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type orderedStringSet struct {
	values []string
	seen   map[string]bool
}

func (s *orderedStringSet) add(value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	if s.seen == nil {
		s.seen = map[string]bool{}
	}
	if s.seen[value] {
		return
	}
	s.seen[value] = true
	s.values = append(s.values, value)
}

func (s orderedStringSet) first(n int) []string {
	if len(s.values) <= n {
		return s.values
	}
	return s.values[:n]
}

type companyMatchCollector struct {
	items map[string]*CompanyMatch
}

func newCompanyMatchCollector() *companyMatchCollector {
	return &companyMatchCollector{items: map[string]*CompanyMatch{}}
}

func (c *companyMatchCollector) add(name, bin, role string, score int) {
	name = strings.TrimSpace(name)
	bin = strings.TrimSpace(bin)
	if name == "" && bin == "" {
		return
	}
	key := bin
	if key == "" {
		key = normalizeCompanyText(name)
	}
	item, ok := c.items[key]
	if !ok {
		item = &CompanyMatch{Name: name, BIN: bin, Roles: []string{}, Score: 0}
		c.items[key] = item
	}
	if item.Name == "" {
		item.Name = name
	}
	if item.BIN == "" {
		item.BIN = bin
	}
	if role != "" && !containsString(item.Roles, role) {
		item.Roles = append(item.Roles, role)
	}
	item.Score += score
}

func (c *companyMatchCollector) list() []CompanyMatch {
	out := make([]CompanyMatch, 0, len(c.items))
	for _, item := range c.items {
		out = append(out, *item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].Name < out[j].Name
		}
		return out[i].Score > out[j].Score
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func companyMatchesLot(lot tenderplus.Lot, query string) bool {
	if lot.LotBuy != nil {
		lb := lot.LotBuy
		if lb.Organization != nil && companyMatchesText(query, derefStr(lb.Organization.ShortName), derefStr(lb.Organization.BinIIN)) {
			return true
		}
		if companyMatchesText(query, derefStr(lb.Organizer)) {
			return true
		}
	}
	return false
}

func companyMatchesText(query string, values ...string) bool {
	bin := firstBIN(query)
	if bin != "" {
		for _, value := range values {
			if strings.Contains(onlyDigits(value), bin) {
				return true
			}
		}
	}
	needle := normalizeCompanyForMatch(query)
	if needle == "" {
		return false
	}
	terms := companyTerms(needle)
	for _, value := range values {
		hay := normalizeCompanyForMatch(value)
		if hay == "" {
			continue
		}
		if strings.Contains(hay, needle) {
			return true
		}
		if len(terms) > 0 {
			all := true
			for _, term := range terms {
				if !strings.Contains(hay, term) {
					all = false
					break
				}
			}
			if all {
				return true
			}
		}
	}
	return false
}

func normalizeCompanyForMatch(value string) string {
	return strings.Join(companyTerms(normalizeCompanyText(value)), " ")
}

func normalizeCompanyText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r):
			b.WriteRune(r)
		default:
			b.WriteRune(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func companyTerms(normalized string) []string {
	stop := map[string]bool{
		"тоо": true, "ао": true, "ооо": true, "ип": true, "ргп": true, "кгп": true,
		"товарищество": true, "ограниченной": true, "ответственностью": true,
		"акционерное": true, "общество": true, "компания": true, "филиал": true,
		"гкп": true, "кгу": true, "гу": true, "республика": true, "казахстан": true,
	}
	parts := strings.Fields(normalized)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if len([]rune(part)) < 2 || stop[part] {
			continue
		}
		out = append(out, part)
	}
	return out
}

func firstBIN(value string) string {
	return binLikeRE.FindString(value)
}

func onlyDigits(value string) string {
	var b strings.Builder
	for _, r := range value {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func companyTenderFromLot(lot tenderplus.Lot) CompanyTender {
	dto := CompanyTender{
		ID:              lot.ID,
		LotNumber:       cleanLotNumber(derefStr(lot.Lot)),
		Title:           derefStr(lot.Title),
		Amount:          tenderplus.LotAmount(lot),
		AmountAvailable: tenderplus.LotAmountAvailable(lot),
		Link:            cleanTenderPlusLink(lot.ID, derefStr(lot.PartnerLink)),
	}
	if lot.Region != nil {
		dto.Region = derefStr(lot.Region.Name)
	}
	if lot.LotBuy != nil {
		lb := lot.LotBuy
		if dto.Title == "" {
			dto.Title = derefStr(lb.TitleBuy)
		}
		dto.Organizer = tenderplus.LotOrganizationName(lot)
		dto.BeginDate = parseTP(derefStr(lb.BeginDate))
		dto.EndDate = parseTP(derefStr(lb.EndDate))
		dto.PublishDate = parseTP(derefStr(lb.PubDate))
		dto.CustomerName = tenderplus.LotOrganizationName(lot)
		dto.CustomerBIN = tenderplus.LotOrganizationBIN(lot)
		if lb.Partner != nil {
			dto.Platform = derefStr(lb.Partner.Name)
		}
		dto.Status = tenderplus.LotStatusName(lot)
		dto.PurchaseType = tenderplus.LotPurchaseType(lot)
	}
	return dto
}

func cleanLotNumber(value string) string {
	return strings.TrimSpace(emptyParenSuffixRE.ReplaceAllString(value, ""))
}

func companyContractFromTP(contract tenderplus.Contract) CompanyContract {
	dto := CompanyContract{
		ID:              contract.ID,
		ContractNumber:  derefStr(contract.ContractNumber),
		Amount:          derefFloat(contract.ContractSum),
		AmountAvailable: contract.ContractSum != nil && *contract.ContractSum > 0,
		SignDate:        parseTP(derefStr(contract.SignDate)),
		SupplierName:    derefStr(contract.SupplierName),
		SupplierBIN:     derefStr(contract.SupplierBIIN),
		CustomerName:    derefStr(contract.CustomerNameRU),
		CustomerBIN:     derefStr(contract.CustomerBIIN),
		TenderNumber:    derefStr(contract.TrdBuyNumberAnno),
		TenderTitle:     derefStr(contract.TrdBuyNameRU),
	}
	if contract.Status != nil {
		dto.Status = derefStr(contract.Status.Name)
	}
	return dto
}

func companyOfferFromTP(offer tenderplus.LotOffer) CompanyOffer {
	dto := CompanyOffer{
		ID:              offer.ID,
		LotID:           derefInt(offer.LotID),
		Amount:          derefFloat(offer.Cost),
		AmountAvailable: hasPositiveFloat(offer.Cost) || hasPositiveFloat(offer.DiscountPrice),
		DiscountPrice:   derefFloat(offer.DiscountPrice),
		RequestDate:     parseTP(derefStr(offer.RequestDate)),
		Status:          derefStr(offer.StatusTitle),
	}
	if offer.Organization != nil {
		dto.Organization = derefStr(offer.Organization.ShortName)
		dto.OrganizationBIN = derefStr(offer.Organization.BinIIN)
	}
	if offer.Lot != nil {
		lot := companyTenderFromLot(*offer.Lot)
		dto.Lot = &lot
	}
	return dto
}

func cleanTenderPlusLink(id int, link string) string {
	link = strings.TrimSpace(link)
	if link != "" && link != "#" {
		return link
	}
	if id > 0 {
		return "https://tenderplus.kz/zakupki/" + strconv.Itoa(id)
	}
	return ""
}

func trimCompanyResponse(out *CompanyTenderIntelligence, limit int) {
	if len(out.Published) > limit {
		out.Published = out.Published[:limit]
	}
	if len(out.WonContracts) > limit {
		out.WonContracts = out.WonContracts[:limit]
	}
	if len(out.CustomerContracts) > limit {
		out.CustomerContracts = out.CustomerContracts[:limit]
	}
	if len(out.Participated) > limit {
		out.Participated = out.Participated[:limit]
	}
}

func sortCompanyResponse(out *CompanyTenderIntelligence) {
	sort.SliceStable(out.Published, func(i, j int) bool {
		return companyTenderSortTime(out.Published[i]).After(companyTenderSortTime(out.Published[j]))
	})
	sort.SliceStable(out.WonContracts, func(i, j int) bool {
		return companyTimeValue(out.WonContracts[i].SignDate).After(companyTimeValue(out.WonContracts[j].SignDate))
	})
	sort.SliceStable(out.CustomerContracts, func(i, j int) bool {
		return companyTimeValue(out.CustomerContracts[i].SignDate).After(companyTimeValue(out.CustomerContracts[j].SignDate))
	})
	sort.SliceStable(out.Participated, func(i, j int) bool {
		return companyTimeValue(out.Participated[i].RequestDate).After(companyTimeValue(out.Participated[j].RequestDate))
	})
}

func companyTenderSortTime(item CompanyTender) time.Time {
	return companyLatestTime(item.PublishDate, item.EndDate, item.BeginDate)
}

func companyLatestTime(values ...*time.Time) time.Time {
	var latest time.Time
	for _, value := range values {
		if value == nil || value.IsZero() {
			continue
		}
		if latest.IsZero() || value.After(latest) {
			latest = *value
		}
	}
	return latest
}

func companyTimeValue(value *time.Time) time.Time {
	if value == nil || value.IsZero() {
		return time.Time{}
	}
	return *value
}

func buildCompanySummary(out CompanyTenderIntelligence) CompanySummary {
	summary := CompanySummary{
		PublishedCount:         len(out.Published),
		WonContractsCount:      len(out.WonContracts),
		CustomerContractsCount: len(out.CustomerContracts),
		ParticipatedCount:      len(out.Participated),
		Confidence:             "medium",
	}
	now := time.Now()
	for _, lot := range out.Published {
		summary.PublishedBudget += lot.Amount
		if lot.AmountAvailable {
			summary.PublishedAmountCount++
		}
		if isTenderActive(lot.Status, lot.EndDate, now) {
			summary.ActivePublishedCount++
		}
		summary.LastActivityAt = latestTime(summary.LastActivityAt, lot.PublishDate, lot.EndDate)
	}
	for _, contract := range out.WonContracts {
		summary.WonContractsAmount += contract.Amount
		if contract.AmountAvailable {
			summary.WonContractsAmountCount++
		}
		summary.LastActivityAt = latestTime(summary.LastActivityAt, contract.SignDate)
	}
	for _, contract := range out.CustomerContracts {
		summary.CustomerContractsAmount += contract.Amount
		if contract.AmountAvailable {
			summary.CustomerContractsAmountCount++
		}
		summary.LastActivityAt = latestTime(summary.LastActivityAt, contract.SignDate)
	}
	for _, offer := range out.Participated {
		summary.LastActivityAt = latestTime(summary.LastActivityAt, offer.RequestDate)
	}
	if len(out.Matches) > 0 && out.Matches[0].BIN != "" {
		summary.Confidence = "high"
	}
	if len(out.Matches) == 0 {
		summary.Confidence = "low"
	}
	return summary
}

func buildCompanyAggregates(out CompanyTenderIntelligence) CompanyAggregates {
	monthly, monthIndex := emptyCompanyMonths(6)
	addMonth := func(key string, update func(*CompanyMonthlyPoint)) {
		if key == "" {
			return
		}
		row := monthIndex[key]
		if row == nil {
			return
		}
		update(row)
	}

	for _, lot := range out.Published {
		addMonth(companyMonthKey(lot.PublishDate, lot.EndDate, lot.BeginDate), func(row *CompanyMonthlyPoint) {
			row.Published++
			row.PublishedAmount += lot.Amount
		})
	}
	for _, contract := range out.WonContracts {
		addMonth(companyMonthKey(contract.SignDate), func(row *CompanyMonthlyPoint) {
			row.Won++
			row.WonAmount += contract.Amount
		})
	}
	for _, contract := range out.CustomerContracts {
		addMonth(companyMonthKey(contract.SignDate), func(row *CompanyMonthlyPoint) {
			row.Customer++
			row.CustomerAmount += contract.Amount
		})
	}
	for _, offer := range out.Participated {
		addMonth(companyMonthKey(offer.RequestDate), func(row *CompanyMonthlyPoint) {
			row.Participated++
		})
	}

	opportunities := make([]CompanyTender, 0)
	now := time.Now()
	for _, lot := range out.Published {
		if isTenderActive(lot.Status, lot.EndDate, now) {
			opportunities = append(opportunities, lot)
		}
	}
	sort.SliceStable(opportunities, func(i, j int) bool {
		left := opportunityDateValue(opportunities[i])
		right := opportunityDateValue(opportunities[j])
		if !left.Equal(right) {
			return left.Before(right)
		}
		return opportunities[i].Amount > opportunities[j].Amount
	})
	if len(opportunities) > companyDisplayLimitMax {
		opportunities = opportunities[:companyDisplayLimitMax]
	}

	return CompanyAggregates{
		Monthly:        monthly,
		StatusMix:      groupCompanyTenders(out.Published, func(item CompanyTender) string { return item.Status }),
		PlatformMix:    groupCompanyTenders(out.Published, func(item CompanyTender) string { return item.Platform }),
		PurchaseMix:    groupCompanyTenders(out.Published, func(item CompanyTender) string { return item.PurchaseType }),
		Counterparties: buildCompanyCounterparties(out.WonContracts, out.CustomerContracts),
		Opportunities:  opportunities,
		Recent:         buildCompanyRecentEvents(out),
	}
}

func buildCompanyRecentEvents(out CompanyTenderIntelligence) []CompanyRecentEvent {
	events := make([]CompanyRecentEvent, 0, 24)
	for _, lot := range out.Published {
		events = append(events, CompanyRecentEvent{
			Kind:            "published",
			Title:           lot.Title,
			Subtitle:        lot.Platform,
			Amount:          lot.Amount,
			AmountAvailable: lot.AmountAvailable,
			Status:          lot.Status,
			Date:            latestTime(nil, lot.PublishDate, lot.EndDate, lot.BeginDate),
			Link:            lot.Link,
		})
	}
	for _, contract := range out.WonContracts {
		events = append(events, CompanyRecentEvent{
			Kind:            "won",
			Title:           contract.TenderTitle,
			Subtitle:        contract.CustomerName,
			Amount:          contract.Amount,
			AmountAvailable: contract.AmountAvailable,
			Status:          contract.Status,
			Date:            contract.SignDate,
		})
	}
	for _, contract := range out.CustomerContracts {
		events = append(events, CompanyRecentEvent{
			Kind:            "customer_contract",
			Title:           contract.TenderTitle,
			Subtitle:        contract.SupplierName,
			Amount:          contract.Amount,
			AmountAvailable: contract.AmountAvailable,
			Status:          contract.Status,
			Date:            contract.SignDate,
		})
	}
	for _, offer := range out.Participated {
		title := ""
		link := ""
		if offer.Lot != nil {
			title = offer.Lot.Title
			link = offer.Lot.Link
		}
		events = append(events, CompanyRecentEvent{
			Kind:            "participated",
			Title:           title,
			Subtitle:        offer.Organization,
			Amount:          maxFloat(offer.DiscountPrice, offer.Amount),
			AmountAvailable: offer.AmountAvailable,
			Status:          offer.Status,
			Date:            offer.RequestDate,
			Link:            link,
		})
	}
	sort.SliceStable(events, func(i, j int) bool {
		return companyTimeValue(events[i].Date).After(companyTimeValue(events[j].Date))
	})
	if len(events) > 12 {
		events = events[:12]
	}
	return events
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func emptyCompanyMonths(count int) ([]CompanyMonthlyPoint, map[string]*CompanyMonthlyPoint) {
	if count < 1 {
		count = 1
	}
	rows := make([]CompanyMonthlyPoint, 0, count)
	index := make(map[string]*CompanyMonthlyPoint, count)
	base := time.Now()
	for i := count - 1; i >= 0; i-- {
		date := time.Date(base.Year(), base.Month(), 1, 0, 0, 0, 0, base.Location()).AddDate(0, -i, 0)
		key := companyMonthKey(&date)
		rows = append(rows, CompanyMonthlyPoint{Label: companyMonthLabel(key)})
		index[key] = &rows[len(rows)-1]
	}
	return rows, index
}

func companyMonthKey(candidates ...*time.Time) string {
	for _, candidate := range candidates {
		if candidate != nil && !candidate.IsZero() {
			return candidate.Format("2006-01")
		}
	}
	return ""
}

func companyMonthLabel(key string) string {
	if len(key) != len("2006-01") {
		return key
	}
	return key[5:7] + "." + key[:4]
}

func groupCompanyTenders(items []CompanyTender, pick func(CompanyTender) string) []CompanyNamedValue {
	counts := map[string]int{}
	for _, item := range items {
		key := strings.TrimSpace(pick(item))
		if key == "" {
			key = "Не указано"
		}
		counts[key]++
	}
	out := make([]CompanyNamedValue, 0, len(counts))
	for name, value := range counts {
		out = append(out, CompanyNamedValue{Name: name, Value: value})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Value == out[j].Value {
			return out[i].Name < out[j].Name
		}
		return out[i].Value > out[j].Value
	})
	if len(out) > 7 {
		out = out[:7]
	}
	return out
}

func buildCompanyCounterparties(won []CompanyContract, customer []CompanyContract) []CompanyNamedMoney {
	items := map[string]CompanyNamedMoney{}
	add := func(name string, amount float64) {
		key := strings.TrimSpace(name)
		if key == "" {
			key = "Не указано"
		}
		row := items[key]
		row.Name = key
		row.Count++
		row.Amount += amount
		items[key] = row
	}
	for _, contract := range won {
		add(contract.CustomerName, contract.Amount)
	}
	for _, contract := range customer {
		add(contract.SupplierName, contract.Amount)
	}
	out := make([]CompanyNamedMoney, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Amount == out[j].Amount {
			return out[i].Count > out[j].Count
		}
		return out[i].Amount > out[j].Amount
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func opportunityDateValue(item CompanyTender) time.Time {
	if item.EndDate != nil && !item.EndDate.IsZero() {
		return *item.EndDate
	}
	return time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
}

func buildCompanyInsights(out CompanyTenderIntelligence, hasBIN bool) []CompanyInsight {
	insights := make([]CompanyInsight, 0, 4)
	if out.Summary.ActivePublishedCount > 0 {
		insights = append(insights, CompanyInsight{
			Kind: "opportunity", Title: "Есть активные публикации",
			Message:  "Компания сейчас держит открытые закупки: стоит проверить сроки, площадку и предмет закупа.",
			Severity: "success",
		})
	}
	if out.Summary.WonContractsCount > 0 {
		insights = append(insights, CompanyInsight{
			Kind: "supplier", Title: "Есть история побед",
			Message:  "TenderPlus нашёл договоры, где компания выступала поставщиком; это помогает оценить её рыночный профиль.",
			Severity: "info",
		})
	}
	if out.Summary.CustomerContractsCount > 0 || out.Summary.PublishedCount > 0 {
		insights = append(insights, CompanyInsight{
			Kind: "customer", Title: "Видна закупочная активность",
			Message:  "По компании найдены опубликованные тендеры или договоры заказчика, поэтому можно смотреть бюджет и частоту закупок.",
			Severity: "info",
		})
	}
	if !hasBIN {
		insights = append(insights, CompanyInsight{
			Kind: "confidence", Title: "Нужен БИН для максимальной точности",
			Message:  "По названию TenderPlus может найти одноимённые компании; БИН уточнит договоры и заявки.",
			Severity: "warning",
		})
	}
	if len(insights) == 0 {
		insights = append(insights, CompanyInsight{
			Kind: "empty", Title: "Данных мало",
			Message:  "Попробуйте полное юридическое название или БИН, чтобы раскрыть договоры и участия.",
			Severity: "warning",
		})
	}
	return insights
}

func isTenderActive(status string, endDate *time.Time, now time.Time) bool {
	normalized := strings.ToLower(status)
	if strings.Contains(normalized, "опублик") || strings.Contains(normalized, "прием") || strings.Contains(normalized, "приём") {
		return true
	}
	return endDate != nil && endDate.After(now)
}

func latestTime(current *time.Time, candidates ...*time.Time) *time.Time {
	latest := current
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}
		if latest == nil || candidate.After(*latest) {
			t := *candidate
			latest = &t
		}
	}
	return latest
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func derefFloat(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

func hasPositiveFloat(v *float64) bool {
	return v != nil && *v > 0
}

func derefInt(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}
