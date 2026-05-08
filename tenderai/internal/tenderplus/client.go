package tenderplus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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

// LotDocument — файл/вложение лота в GraphQL TenderPlus.
type LotDocument struct {
	Name         *string `json:"name"`
	DownloadLink *string `json:"downloadLink"`
}

// Lot — одна запись лота из GraphQL.
type Lot struct {
	ID          int           `json:"id"`
	Lot         *string       `json:"lot"`
	LotSourceID *string       `json:"lot_source_id"`
	Title       *string       `json:"title"`
	Description *string       `json:"description"`
	Cost        *float64      `json:"cost"`
	PartnerLink *string       `json:"partnerLink"`
	Place       *string       `json:"place"`
	BuyID       *int          `json:"buy_id"`
	Documents   []LotDocument `json:"documents"`
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

	query := fmt.Sprintf(`{ lot( pagination: { limit: %d, page: %d } filter: { keywords: %s } ) {
		id
		lot
		lot_source_id
		title
		description
		cost
		partnerLink
		place
		buy_id
		documents {
			name
			downloadLink
		}
		lotBuy {
			documents {
				name
				downloadLink
			}
		}
	} }`, limit, page, string(keys))

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
