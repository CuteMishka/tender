package tenderplus

import "testing"

func TestLotAmountFallback(t *testing.T) {
	oneCost := 1250.0
	counts := 4.0
	lot := Lot{OneCost: &oneCost, Counts: &counts}
	if got := LotAmount(lot); got != 5000 {
		t.Fatalf("LotAmount() = %v, want 5000", got)
	}
}

func TestLotOrganizationNamePrefersFullOrganizer(t *testing.T) {
	organizer := "РГП на ПХВ \"Национальный центр тестирования\""
	shortName := "РГП НЦТ"
	platform := "Государственные закупки"
	lot := Lot{
		LotBuy: &LotBuy{
			Organizer: &organizer,
			Partner:   &LotName{Name: &platform},
			Organization: &Organization{
				ShortName: &shortName,
			},
		},
	}
	if got := LotOrganizationName(lot); got != organizer {
		t.Fatalf("LotOrganizationName() = %q, want %q", got, organizer)
	}
}

func TestLotOrganizationNamePrefersFullOrganizationName(t *testing.T) {
	organizer := "ТОО \"Мобильный мир\""
	shortName := "ТОВАРИЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ \"TENDER MOBILE\""
	platform := "ETS тендер"
	lot := Lot{
		LotBuy: &LotBuy{
			Organizer: &organizer,
			Partner:   &LotName{Name: &platform},
			Organization: &Organization{
				ShortName: &shortName,
			},
		},
	}
	if got := LotOrganizationName(lot); got != shortName {
		t.Fatalf("LotOrganizationName() = %q, want %q", got, shortName)
	}
}

func TestLotOrganizationNameSkipsPlatformOrganizer(t *testing.T) {
	organizer := "Государственные закупки"
	shortName := "ТОО Тестовый заказчик"
	lot := Lot{
		LotBuy: &LotBuy{
			Organizer: &organizer,
			Partner:   &LotName{Name: &organizer},
			Organization: &Organization{
				ShortName: &shortName,
			},
		},
	}
	if got := LotOrganizationName(lot); got != shortName {
		t.Fatalf("LotOrganizationName() = %q, want %q", got, shortName)
	}
}
