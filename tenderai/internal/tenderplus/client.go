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
