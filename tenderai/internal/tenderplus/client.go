package tenderplus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
	token      string
}

func (c *Client) Configured() bool {
	return c != nil && strings.TrimSpace(c.token) != ""
}

func NewClient(baseURL, token string) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ForceAttemptHTTP2 = true
	transport.TLSHandshakeTimeout = 30 * time.Second
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout:   75 * time.Second,
			Transport: transport,
		},
		token: token,
	}
}

type graphqlRequest struct {
	Query string `json:"query"`
}

const lotFields = `
		id
		lot
		lot_source_id
		title
		description
		cost
		one_cost
		counts
		partnerLink
		place
		buy_id
		subjectType {
			name
		}
		category {
			name
		}
		enstru {
			code
			title
			description
		}
		documents {
			name
			downloadLink
		}
		region {
			name
		}
		lotBuy {
			begin_date
			end_date
			pub_date
			buy
			source_id
			title_buy
			organizer
			documents {
				name
				downloadLink
			}
			partner {
				name
			}
			organization {
				bin_iin
				short_name
			}
			tenderTypePartner {
				name
			}
			lot_status_id
			lotStatus {
				name
			}
		}`

const lotListFields = `
		id
		lot
		lot_source_id
		title
		description
		cost
		one_cost
		counts
		partnerLink
		place
		buy_id
		subjectType {
			name
		}
		category {
			name
		}
		enstru {
			code
			title
			description
		}
		region {
			name
		}
		lotBuy {
			begin_date
			end_date
			pub_date
			buy
			source_id
			title_buy
			organizer
			partner {
				name
			}
			organization {
				bin_iin
				short_name
			}
			tenderTypePartner {
				name
			}
			lot_status_id
			lotStatus {
				name
			}
		}`

// LotDocument — файл/вложение лота.
type LotDocument struct {
	Name         *string `json:"name"`
	DownloadLink *string `json:"downloadLink"`
}

var (
	attachmentLinkRE = regexp.MustCompile(`(?is)<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>`)
	htmlTagRE        = regexp.MustCompile(`(?is)<[^>]+>`)
	attachmentExtRE  = regexp.MustCompile(`(?i)\.(pdf|docx?|xlsx?|zip|rar|7z)(?:[\s?#]|$)`)
)

// LotName — объект с полем name (регион, партнёр, статус).
type LotName struct {
	Name *string `json:"name"`
}

// LotBuy — блок закупки (поля подтверждены из документации TenderPlus).
type LotBuy struct {
	BeginDate         *string       `json:"begin_date"`
	EndDate           *string       `json:"end_date"`
	PubDate           *string       `json:"pub_date"`
	Buy               *string       `json:"buy"`
	SourceID          *string       `json:"source_id"`
	TitleBuy          *string       `json:"title_buy"`
	Organizer         *string       `json:"organizer"`
	Partner           *LotName      `json:"partner"`
	Organization      *Organization `json:"organization"`
	TenderTypePartner *LotName      `json:"tenderTypePartner"`
	LotStatusID       *int          `json:"lot_status_id"`
	LotStatus         *LotName      `json:"lotStatus"`
	Documents         []LotDocument `json:"documents"`
}

// Organization — заказчик/организатор объявления TenderPlus.
type Organization struct {
	BinIIN    *string `json:"bin_iin"`
	ShortName *string `json:"short_name"`
}

// LotEnstru — классификатор ЕНС ТРУ из TenderPlus.
type LotEnstru struct {
	Code        *string `json:"code"`
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

// Lot — одна запись лота из GraphQL TenderPlus.
type Lot struct {
	ID          int           `json:"id"`
	Lot         *string       `json:"lot"`
	LotSourceID *string       `json:"lot_source_id"`
	Title       *string       `json:"title"`
	Description *string       `json:"description"`
	Cost        *float64      `json:"cost"`
	OneCost     *float64      `json:"one_cost"`
	Counts      *float64      `json:"counts"`
	PartnerLink *string       `json:"partnerLink"`
	Place       *string       `json:"place"`
	BuyID       *int          `json:"buy_id"`
	SubjectType *LotName      `json:"subjectType"`
	Category    *LotName      `json:"category"`
	Enstru      *LotEnstru    `json:"enstru"`
	Documents   []LotDocument `json:"documents"`
	Region      *LotName      `json:"region"`
	LotBuy      *LotBuy       `json:"lotBuy"`
}

type listLotsResponse struct {
	Data struct {
		Lot []Lot `json:"lot"`
	} `json:"data"`
	Errors     json.RawMessage        `json:"errors"`
	Extensions map[string]interface{} `json:"extensions"`
}

type Contract struct {
	ID               int      `json:"id"`
	ContractNumber   *string  `json:"contract_number"`
	ContractSum      *float64 `json:"contract_sum"`
	SignDate         *string  `json:"sign_date"`
	SupplierBIIN     *string  `json:"supplier_biin"`
	SupplierName     *string  `json:"supplier_name"`
	CustomerBIIN     *string  `json:"customer_biin"`
	CustomerNameRU   *string  `json:"customer_name_ru"`
	TrdBuyNumberAnno *string  `json:"trd_buy_number_anno"`
	TrdBuyNameRU     *string  `json:"trd_buy_name_ru"`
	Status           *LotName `json:"status"`
}

type LotOffer struct {
	ID            int           `json:"id"`
	LotID         *int          `json:"lot_id"`
	OneCost       *float64      `json:"one_cost"`
	Cost          *float64      `json:"cost"`
	DiscountValue *float64      `json:"discount_value"`
	DiscountPrice *float64      `json:"discount_price"`
	RequestDate   *string       `json:"request_date"`
	Status        *int          `json:"status"`
	StatusTitle   *string       `json:"statusTitle"`
	Organization  *Organization `json:"organization"`
	Lot           *Lot          `json:"lot"`
}

type listContractsResponse struct {
	Data struct {
		Contract []Contract `json:"contract"`
	} `json:"data"`
	Errors     json.RawMessage        `json:"errors"`
	Extensions map[string]interface{} `json:"extensions"`
}

type listLotOffersResponse struct {
	Data struct {
		LotOffer []LotOffer `json:"lotOffer"`
	} `json:"data"`
	Errors     json.RawMessage        `json:"errors"`
	Extensions map[string]interface{} `json:"extensions"`
}

const contractFields = `
		id
		contract_number
		contract_sum
		sign_date
		supplier_biin
		supplier_name
		customer_biin
		customer_name_ru
		trd_buy_number_anno
		trd_buy_name_ru
		status {
			name
		}`

const lotOfferFields = `
		id
		lot_id
		one_cost
		cost
		discount_value
		discount_price
		request_date
		status
		statusTitle
		organization {
			bin_iin
			short_name
		}
		lot {
			id
			lot
			lot_source_id
			title
			description
			cost
			one_cost
			counts
			partnerLink
			place
			buy_id
			subjectType {
				name
			}
			category {
				name
			}
			enstru {
				code
				title
				description
			}
			region {
				name
			}
			lotBuy {
				begin_date
				end_date
				pub_date
				buy
				source_id
				title_buy
				organizer
				partner {
					name
				}
				organization {
					bin_iin
					short_name
				}
				tenderTypePartner {
					name
				}
				lot_status_id
				lotStatus {
					name
				}
			}
		}`

func graphqlQuote(value string) string {
	b, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(b)
}

func graphqlStringList(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		quoted = append(quoted, graphqlQuote(value))
	}
	if len(quoted) == 0 {
		return "[]"
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func lotFilterLiteral(keywords []string, endDateFrom string) string {
	parts := []string{"keywords: " + graphqlStringList(keywords)}
	if strings.TrimSpace(endDateFrom) != "" {
		parts = append(parts, "endDateFrom: "+graphqlQuote(endDateFrom))
	}
	return "{ " + strings.Join(parts, ", ") + " }"
}

func graphqlErrorMessage(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var arr []struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
		if strings.TrimSpace(arr[0].Message) != "" {
			return arr[0].Message
		}
	}
	var obj struct {
		Message string `json:"message"`
		Name    string `json:"name"`
		Status  int    `json:"status"`
	}
	if err := json.Unmarshal(raw, &obj); err == nil {
		if strings.TrimSpace(obj.Message) != "" {
			return obj.Message
		}
		if strings.TrimSpace(obj.Name) != "" {
			return obj.Name
		}
	}
	if len(trimmed) > 500 {
		return trimmed[:500]
	}
	return trimmed
}

func (c *Client) ListLotsByKeywords(ctx context.Context, keywords []string, page, limit int) ([]Lot, map[string]interface{}, error) {
	return c.ListLots(ctx, keywords, page, limit, "")
}

func (c *Client) ListActiveLots(ctx context.Context, keywords []string, page, limit int, endDateFrom string) ([]Lot, map[string]interface{}, error) {
	return c.ListLots(ctx, keywords, page, limit, endDateFrom)
}

func (c *Client) ListLots(ctx context.Context, keywords []string, page, limit int, endDateFrom string) ([]Lot, map[string]interface{}, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if page <= 0 {
		page = 1
	}
	if keywords == nil {
		keywords = []string{}
	}
	filter := lotFilterLiteral(keywords, endDateFrom)

	query := fmt.Sprintf(`{ lot( pagination: { limit: %d, page: %d } filter: %s ) { %s } }`, limit, page, filter, lotListFields)

	body, err := json.Marshal(graphqlRequest{Query: query})
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	var out listLotsResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, nil, err
	}
	if msg := graphqlErrorMessage(out.Errors); msg != "" {
		return nil, nil, fmt.Errorf("tenderplus: %s", msg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("tenderplus: status %d", resp.StatusCode)
	}
	return out.Data.Lot, out.Extensions, nil
}

func (c *Client) ListContractsByKeywords(ctx context.Context, keywords []string, page, limit int) ([]Contract, map[string]interface{}, error) {
	return c.listContracts(ctx, "keywords: "+graphqlStringList(keywords), page, limit)
}

func (c *Client) ListContractsBySupplierBIN(ctx context.Context, bin string, page, limit int) ([]Contract, map[string]interface{}, error) {
	return c.listContracts(ctx, "supplier_biin: "+quoteGraphQLString(bin), page, limit)
}

func (c *Client) ListContractsByCustomerBIN(ctx context.Context, bin string, page, limit int) ([]Contract, map[string]interface{}, error) {
	return c.listContracts(ctx, "customer_biin: "+quoteGraphQLString(bin), page, limit)
}

func (c *Client) listContracts(ctx context.Context, filter string, page, limit int) ([]Contract, map[string]interface{}, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if page <= 0 {
		page = 1
	}
	query := fmt.Sprintf(`{ contract( pagination: { limit: %d, page: %d } filter: { %s } ) { %s } }`, limit, page, filter, contractFields)
	body, err := json.Marshal(graphqlRequest{Query: query})
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	var out listContractsResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, nil, err
	}
	if msg := graphqlErrorMessage(out.Errors); msg != "" {
		return nil, nil, fmt.Errorf("tenderplus: %s", msg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("tenderplus: status %d", resp.StatusCode)
	}
	return out.Data.Contract, out.Extensions, nil
}

func (c *Client) ListLotOffersByOrgBIN(ctx context.Context, bin string, page, limit int) ([]LotOffer, map[string]interface{}, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if page <= 0 {
		page = 1
	}
	query := fmt.Sprintf(`{ lotOffer( pagination: { limit: %d, page: %d } filter: { orgBinIin: [%s] } ) { %s } }`, limit, page, quoteGraphQLString(bin), lotOfferFields)
	body, err := json.Marshal(graphqlRequest{Query: query})
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	var out listLotOffersResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, nil, err
	}
	if msg := graphqlErrorMessage(out.Errors); msg != "" {
		return nil, nil, fmt.Errorf("tenderplus: %s", msg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("tenderplus: status %d", resp.StatusCode)
	}
	return out.Data.LotOffer, out.Extensions, nil
}

func (c *Client) LotByID(ctx context.Context, id int) (*Lot, error) {
	return c.FindLot(ctx, []LotLookup{
		{Field: "lotNumOrSourceId", Value: strconv.Itoa(id)},
		{Field: "lotNumber", Value: strconv.Itoa(id)},
		{Field: "lot_source_id", Value: strconv.Itoa(id)},
	})
}

type LotLookup struct {
	Field string
	Value string
}

var allowedLotLookupFields = map[string]bool{
	"lotNumber":        true,
	"lotNumOrSourceId": true,
	"lot_source_id":    true,
	"source_id":        true,
	"buy":              true,
}

func (c *Client) FindLot(ctx context.Context, lookups []LotLookup) (*Lot, error) {
	seen := make(map[string]bool, len(lookups))
	var lastErr error
	for _, lookup := range lookups {
		field := lookup.Field
		value := strings.TrimSpace(lookup.Value)
		if value == "" || !allowedLotLookupFields[field] {
			continue
		}
		key := field + ":" + value
		if seen[key] {
			continue
		}
		seen[key] = true
		lot, err := c.lotByFilter(ctx, fmt.Sprintf("%s: %s", field, quoteGraphQLString(value)))
		if err != nil {
			lastErr = err
			continue
		}
		if lot != nil {
			return lot, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("tenderplus: lot not found")
}

func (c *Client) lotByFilter(ctx context.Context, filter string) (*Lot, error) {
	query := fmt.Sprintf(`{ lot(pagination: { limit: 1, page: 1 } filter: { %s } ) { %s } }`, filter, lotFields)
	body, err := json.Marshal(graphqlRequest{Query: query})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var out struct {
		Data struct {
			Lot []Lot `json:"lot"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Errors) > 0 {
		return nil, fmt.Errorf("tenderplus: %s", out.Errors[0].Message)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tenderplus: status %d", resp.StatusCode)
	}
	if len(out.Data.Lot) == 0 {
		return nil, nil
	}
	return &out.Data.Lot[0], nil
}

func quoteGraphQLString(value string) string {
	quoted, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(quoted)
}

func (c *Client) AttachedFilesFromPage(ctx context.Context, pageURL string) ([]LotDocument, error) {
	pageURL = strings.TrimSpace(pageURL)
	if pageURL == "" {
		return nil, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 tenderai/1.0")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("tenderplus page status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	base, err := url.Parse(pageURL)
	if err != nil {
		return nil, err
	}
	htmlText := string(raw)
	lowered := strings.ToLower(htmlText)
	if idx := strings.Index(lowered, "прикреп"); idx >= 0 {
		end := idx + 30000
		if end > len(htmlText) {
			end = len(htmlText)
		}
		htmlText = htmlText[idx:end]
	}
	seen := map[string]bool{}
	var out []LotDocument
	for _, match := range attachmentLinkRE.FindAllStringSubmatch(htmlText, -1) {
		if len(match) < 3 {
			continue
		}
		href := strings.TrimSpace(html.UnescapeString(match[1]))
		label := strings.TrimSpace(htmlTagRE.ReplaceAllString(html.UnescapeString(match[2]), " "))
		label = strings.Join(strings.Fields(label), " ")
		absolute := resolveTenderPlusURL(base, href)
		if absolute == "" || seen[absolute] || !looksLikeAttachment(absolute, label) {
			continue
		}
		seen[absolute] = true
		if label == "" {
			label = absolute[strings.LastIndex(absolute, "/")+1:]
		}
		name := label
		link := absolute
		out = append(out, LotDocument{Name: &name, DownloadLink: &link})
	}
	return out, nil
}

func resolveTenderPlusURL(base *url.URL, href string) string {
	if href == "" {
		return ""
	}
	parsed, err := url.Parse(href)
	if err != nil {
		return ""
	}
	return base.ResolveReference(parsed).String()
}

func looksLikeAttachment(link string, label string) bool {
	return attachmentExtRE.MatchString(link) || attachmentExtRE.MatchString(label)
}

// GetLotByID ищет конкретный лот по ID, перебирая страницы.
func (c *Client) GetLotByID(ctx context.Context, id int, keywords []string) (*Lot, error) {
	query := fmt.Sprintf(`{ lot( pagination: { limit: 25, page: 1 } before: %d filter: { keywords: [] } ) {
		id
		lot
		lot_source_id
		title
		description
		cost
		one_cost
		counts
		partnerLink
		place
		buy_id
		subjectType {
			name
		}
		category {
			name
		}
		enstru {
			code
			title
			description
		}
		documents {
			name
			downloadLink
		}
		region {
			name
		}
		lotBuy {
			begin_date
			end_date
			pub_date
			buy
			source_id
			title_buy
			organizer
			documents {
				name
				downloadLink
			}
			partner {
				name
			}
			organization {
				bin_iin
				short_name
			}
			tenderTypePartner {
				name
			}
			lot_status_id
			lotStatus {
				name
			}
		}
	} }`, id+1)

	body, err := json.Marshal(graphqlRequest{Query: query})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var out listLotsResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if msg := graphqlErrorMessage(out.Errors); msg != "" {
		return nil, fmt.Errorf("tenderplus: %s", msg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tenderplus: status %d", resp.StatusCode)
	}
	for i := range out.Data.Lot {
		if out.Data.Lot[i].ID == id {
			return &out.Data.Lot[i], nil
		}
	}
	return nil, fmt.Errorf("лот с ID %d не найден", id)
}
