package analytics

import (
	"math"
	"strconv"
	"strings"
	"time"
)

func formatReportTenge(value float64) string {
	amount := int64(math.Round(value))
	negative := amount < 0
	if negative {
		amount = -amount
	}
	digits := strconv.FormatInt(amount, 10)
	parts := make([]string, 0, (len(digits)+2)/3)
	for len(digits) > 3 {
		cut := len(digits) - 3
		parts = append([]string{digits[cut:]}, parts...)
		digits = digits[:cut]
	}
	parts = append([]string{digits}, parts...)
	formatted := strings.Join(parts, "\u00a0")
	if negative {
		formatted = "-" + formatted
	}
	return formatted + " тг"
}

func formatReportDate(value *time.Time) string {
	if value == nil || value.IsZero() {
		return "—"
	}
	return value.In(reportLocation).Format("02.01.2006")
}

func formatReportDateInput(value string) string {
	parsed, err := time.ParseInLocation("2006-01-02", value, reportLocation)
	if err != nil {
		return "—"
	}
	return parsed.Format("02.01.2006")
}
