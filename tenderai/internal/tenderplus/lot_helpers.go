package tenderplus

import "strings"

// LotAmount returns the usable lot budget. TenderPlus sometimes leaves cost empty
// while one_cost and counts still contain the real total.
func LotAmount(lot Lot) float64 {
	if lot.Cost != nil && *lot.Cost > 0 {
		return *lot.Cost
	}
	if lot.OneCost != nil && *lot.OneCost > 0 {
		if lot.Counts != nil && *lot.Counts > 0 {
			return *lot.OneCost * *lot.Counts
		}
		return *lot.OneCost
	}
	return 0
}

func LotOrganizationName(lot Lot) string {
	if lot.LotBuy == nil {
		return ""
	}
	organizer := strings.TrimSpace(derefLotString(lot.LotBuy.Organizer))
	shortName := ""
	if lot.LotBuy.Organization != nil {
		shortName = strings.TrimSpace(derefLotString(lot.LotBuy.Organization.ShortName))
	}
	platform := LotPlatformName(lot)
	organizerOK := organizer != "" && !looksLikePlatformName(organizer) && !sameFold(organizer, platform)
	shortNameOK := shortName != "" && !looksLikePlatformName(shortName) && !sameFold(shortName, platform)
	if organizerOK && shortNameOK {
		return fullerCompanyName(organizer, shortName)
	}
	if shortNameOK {
		return shortName
	}
	if organizerOK {
		return organizer
	}
	if shortName != "" {
		return shortName
	}
	return organizer
}

func LotOrganizationBIN(lot Lot) string {
	if lot.LotBuy == nil || lot.LotBuy.Organization == nil {
		return ""
	}
	return strings.TrimSpace(derefLotString(lot.LotBuy.Organization.BinIIN))
}

func LotStatusName(lot Lot) string {
	if lot.LotBuy == nil || lot.LotBuy.LotStatus == nil {
		return ""
	}
	return strings.TrimSpace(derefLotString(lot.LotBuy.LotStatus.Name))
}

func LotPurchaseType(lot Lot) string {
	if lot.LotBuy != nil && lot.LotBuy.TenderTypePartner != nil {
		if value := strings.TrimSpace(derefLotString(lot.LotBuy.TenderTypePartner.Name)); value != "" {
			return value
		}
	}
	if lot.SubjectType != nil {
		if value := strings.TrimSpace(derefLotString(lot.SubjectType.Name)); value != "" {
			return value
		}
	}
	if lot.Category != nil {
		if value := strings.TrimSpace(derefLotString(lot.Category.Name)); value != "" {
			return value
		}
	}
	if lot.LotBuy != nil {
		return strings.TrimSpace(derefLotString(lot.LotBuy.TitleBuy))
	}
	return ""
}

func LotPlatformName(lot Lot) string {
	if lot.LotBuy == nil || lot.LotBuy.Partner == nil {
		return ""
	}
	return strings.TrimSpace(derefLotString(lot.LotBuy.Partner.Name))
}

func derefLotString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func sameFold(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	return a != "" && b != "" && strings.EqualFold(a, b)
}

func looksLikePlatformName(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return false
	}
	markers := []string{
		"tenderplus", "goszakup", "госзак", "государственные закуп",
		"samruk", "самрук", "kazyna", "қазына", "mp.kz", "omarket",
		"store", "sic.kz", "zakup", "zakupki",
	}
	for _, marker := range markers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func fullerCompanyName(a, b string) string {
	if companyNameScore(b) > companyNameScore(a) {
		return b
	}
	return a
}

func companyNameScore(value string) int {
	normalized := strings.ToLower(strings.TrimSpace(value))
	score := len([]rune(normalized))
	for _, marker := range []string{
		"товарищество", "ограниченной", "ответственностью", "акционерное", "общество",
		"республиканское", "государственное", "предприятие", "учреждение",
	} {
		if strings.Contains(normalized, marker) {
			score += 20
		}
	}
	return score
}
