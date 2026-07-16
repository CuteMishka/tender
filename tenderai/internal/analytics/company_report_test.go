package analytics

import (
	"testing"

	"github.com/dauren/tender/internal/tenderplus"
)

func reportStringPointer(value string) *string  { return &value }
func reportIntPointer(value int) *int           { return &value }
func reportFloatPointer(value float64) *float64 { return &value }

func TestCompanyTenderFromLotMapsReportFields(t *testing.T) {
	lot := tenderplus.Lot{
		ID:          77,
		Lot:         reportStringPointer(" L-77 () "),
		LotSourceID: reportStringPointer("lot-source-77"),
		Title:       reportStringPointer("Услуги связи"),
		Cost:        reportFloatPointer(1234567),
		BuyID:       reportIntPointer(9001),
		Category:    &tenderplus.LotName{Name: reportStringPointer("Услуги")},
		SubjectType: &tenderplus.LotName{Name: reportStringPointer("Работа")},
		Enstru: &tenderplus.LotEnstru{
			Code:  reportStringPointer("61.10.1"),
			Title: reportStringPointer("Телекоммуникационные услуги"),
		},
		Region: &tenderplus.LotName{Name: reportStringPointer("Кызылординская область")},
		LotBuy: &tenderplus.LotBuy{
			BeginDate: reportStringPointer("2026-07-01T09:00:00"),
			EndDate:   reportStringPointer("2026-07-15T18:00:00"),
			PubDate:   reportStringPointer("2026-06-30"),
			Buy:       reportStringPointer("BUY-77"),
			SourceID:  reportStringPointer("buy-source-77"),
			Organizer: reportStringPointer("АО Заказчик"),
			Partner:   &tenderplus.LotName{Name: reportStringPointer("Госзакупки РК")},
			Organization: &tenderplus.Organization{
				BinIIN:    reportStringPointer("123456789012"),
				ShortName: reportStringPointer("Заказчик"),
			},
			TenderTypePartner: &tenderplus.LotName{Name: reportStringPointer("Открытый тендер")},
			LotStatus:         &tenderplus.LotName{Name: reportStringPointer("Опубликован")},
		},
	}

	got := companyTenderFromLot(lot)
	if got.ID != 77 || got.LotNumber != "L-77" || got.LotSource != "lot-source-77" {
		t.Errorf("identity fields = %#v", got)
	}
	if got.BuyID != 9001 || got.BuySourceID != "buy-source-77" || got.BuyNumber != "BUY-77" {
		t.Errorf("publication fields = %#v", got)
	}
	if got.Category != "Услуги" || got.SubjectType != "Работа" || got.EnstruCode != "61.10.1" || got.EnstruTitle != "Телекоммуникационные услуги" {
		t.Errorf("classification fields = %#v", got)
	}
	if got.PurchaseType != "Открытый тендер" || got.Platform != "Госзакупки РК" || got.Status != "Опубликован" {
		t.Errorf("tender fields = %#v", got)
	}
	if got.CustomerName != "АО Заказчик" || got.CustomerBIN != "123456789012" || got.Organizer != "АО Заказчик" {
		t.Errorf("organization fields = %#v", got)
	}
	if !got.AmountAvailable || got.Amount != 1234567 {
		t.Errorf("amount fields = %#v", got)
	}
	if got.BeginDate == nil || got.EndDate == nil || got.PublishDate == nil {
		t.Errorf("date fields were not parsed: %#v", got)
	}
}
