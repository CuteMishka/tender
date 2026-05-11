package analytics

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/dauren/tender/internal/tenderplus"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SyncResult — результат синхронизации.
type SyncResult struct {
	Fetched  int `json:"fetched"`
	Upserted int `json:"upserted"`
}

// SyncFromTenderPlus загружает все доступные лоты из TenderPlus и сохраняет в historical_lots.
func SyncFromTenderPlus(ctx context.Context, db *gorm.DB, tp *tenderplus.Client, keywords string) (*SyncResult, error) {
	kws := parseKeywords(keywords)
	if len(kws) == 0 {
		kws = []string{"IaaS", "сервер"}
	}

	var fetched int
	const pageSize = 50
	batch := make([]HistoricalLot, 0, pageSize)

	for page := 1; page <= 200; page++ {
		lots, _, err := tp.ListLotsByKeywords(ctx, kws, page, pageSize)
		if err != nil {
			log.Printf("analytics sync page %d error: %v", page, err)
			break
		}
		if len(lots) == 0 {
			break
		}
		fetched += len(lots)

		for _, l := range lots {
			batch = append(batch, lotToHistorical(l))
		}

		if len(lots) < pageSize {
			break
		}
	}

	if len(batch) == 0 {
		return &SyncResult{}, nil
	}

	result := db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "lot_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"title", "description", "initial_amount", "status",
			"customer_name", "customer_id", "organizer_name",
			"purchase_type", "partner_link", "lot_source",
			"start_date", "end_date", "publish_date", "updated_at",
		}),
	}).Create(&batch)

	if result.Error != nil {
		return nil, result.Error
	}

	return &SyncResult{Fetched: fetched, Upserted: int(result.RowsAffected)}, nil
}

func lotToHistorical(l tenderplus.Lot) HistoricalLot {
	h := HistoricalLot{
		LotID:       l.ID,
		LotSource:   derefStr(l.LotSourceID),
		PartnerLink: derefStr(l.PartnerLink),
	}
	if l.Title != nil {
		h.Title = *l.Title
	}
	if l.Description != nil {
		h.Description = *l.Description
	}
	if l.Cost != nil {
		h.InitialAmount = *l.Cost
	}
	if l.Region != nil && l.Region.Name != nil {
		h.Region = *l.Region.Name
	}
	if l.LotBuy != nil {
		lb := l.LotBuy
		if lb.EndDate != nil {
			t := parseTP(*lb.EndDate)
			h.EndDate = t
			if t != nil && t.Before(time.Now()) {
				h.Status = "completed"
			}
		}
		if lb.BeginDate != nil {
			h.StartDate = parseTP(*lb.BeginDate)
		}
		if lb.LotStatus != nil && lb.LotStatus.Name != nil {
			h.PurchaseType = *lb.LotStatus.Name
		}
		if lb.Partner != nil && lb.Partner.Name != nil {
			h.OrganizerName = *lb.Partner.Name
		}
	}
	if strings.TrimSpace(h.CustomerName) == "" {
		h.CustomerName = h.OrganizerName
	}
	return h
}

func parseTP(s string) *time.Time {
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, lay := range layouts {
		if t, err := time.Parse(lay, s); err == nil {
			return &t
		}
	}
	return nil
}

func extractRegion(address string) string {
	cities := []string{
		"Алматы", "Астана", "Нур-Султан", "Шымкент", "Актобе",
		"Атырау", "Актау", "Тараз", "Павлодар", "Усть-Каменогорск",
		"Семей", "Костанай", "Петропавловск", "Уральск", "Кокшетау",
		"Талдыкорган", "Туркестан", "Кызылорда", "Жезказган", "Балхаш",
	}
	for _, city := range cities {
		if strings.Contains(address, city) {
			return city
		}
	}
	return ""
}

func parseKeywords(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
