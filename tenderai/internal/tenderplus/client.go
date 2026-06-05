package tenderplus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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

// LotDocument — файл/вложение лота.
type LotDocument struct {
	Name         *string `json:"name"`
	DownloadLink *string `json:"downloadLink"`
}

// LotName — объект с полем name (регион, партнёр, статус).
type LotName struct {
	Name *string `json:"name"`
}

// LotBuy — блок закупки (поля подтверждены из документации TenderPlus).
type LotBuy struct {
	BeginDate   *string       `json:"begin_date"`
	EndDate     *string       `json:"end_date"`
	PubDate     *string       `json:"pub_date"`
	Buy         *string       `json:"buy"`
	SourceID    *string       `json:"source_id"`
	TitleBuy    *string       `json:"title_buy"`
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
	Counts      *int          `json:"counts"`
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
	Errors     json.RawMessage        `json:"errors"`
	Extensions map[string]interface{} `json:"extensions"`
}

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

	query := fmt.Sprintf(`{ lot( pagination: { limit: %d, page: %d } filter: %s ) {
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
			pub_date
			buy
			source_id
			title_buy
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
		}
	} }`, limit, page, filter)

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
