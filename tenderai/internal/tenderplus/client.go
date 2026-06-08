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

func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
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
			documents {
				name
				downloadLink
			}
			partner {
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
	BeginDate   *string       `json:"begin_date"`
	EndDate     *string       `json:"end_date"`
	Partner     *LotName      `json:"partner"`
	LotStatusID *int          `json:"lot_status_id"`
	LotStatus   *LotName      `json:"lotStatus"`
	Documents   []LotDocument `json:"documents"`
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
	Documents   []LotDocument `json:"documents"`
	Region      *LotName      `json:"region"`
	LotBuy      *LotBuy       `json:"lotBuy"`
}

type listLotsResponse struct {
	Data struct {
		Lot []Lot `json:"lot"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Extensions map[string]interface{} `json:"extensions"`
}

func (c *Client) ListLotsByKeywords(ctx context.Context, keywords []string, page, limit int) ([]Lot, map[string]interface{}, error) {
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
	keys, err := json.Marshal(keywords)
	if err != nil {
		return nil, nil, err
	}

	query := fmt.Sprintf(`{ lot( pagination: { limit: %d, page: %d } filter: { keywords: %s } ) { %s } }`, limit, page, string(keys), lotFields)

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
	if len(out.Errors) > 0 {
		return nil, nil, fmt.Errorf("tenderplus: %s", out.Errors[0].Message)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("tenderplus: status %d", resp.StatusCode)
	}
	return out.Data.Lot, out.Extensions, nil
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
	if keywords == nil {
		keywords = []string{"IaaS", "сервер"}
	}
	const maxPages = 50
	for page := 1; page <= maxPages; page++ {
		lots, _, err := c.ListLotsByKeywords(ctx, keywords, page, 50)
		if err != nil {
			return nil, err
		}
		for i := range lots {
			if lots[i].ID == id {
				return &lots[i], nil
			}
		}
		if len(lots) < 50 {
			break
		}
	}
	return nil, fmt.Errorf("лот с ID %d не найден", id)
}
