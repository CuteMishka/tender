package analytics

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"time"
)

// ExportCSV генерирует CSV с UTF-8 BOM (Excel корректно открывает).
func ExportCSV(w http.ResponseWriter, lots []HistoricalLot) {
	filename := fmt.Sprintf("tenders_%s.csv", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)

	// UTF-8 BOM для Excel
	w.Write([]byte("\xEF\xBB\xBF"))

	enc := csv.NewWriter(w)
	_ = enc.Write([]string{
		"ID лота",
		"Наименование",
		"Заказчик",
		"Организатор",
		"Вид закупки",
		"Регион",
		"Нач. цена (₸)",
		"Контр. цена (₸)",
		"Скидка %",
		"Победитель",
		"Статус",
		"Дата начала",
		"Дата окончания",
		"Ссылка",
	})

	for _, l := range lots {
		discount := ""
		if l.InitialAmount > 0 && l.ContractAmount > 0 {
			pct := (l.InitialAmount - l.ContractAmount) / l.InitialAmount * 100
			discount = fmt.Sprintf("%.2f", pct)
		}
		_ = enc.Write([]string{
			fmt.Sprintf("%d", l.LotID),
			l.Title,
			l.CustomerName,
			l.OrganizerName,
			l.PurchaseType,
			l.Region,
			formatAmount(l.InitialAmount),
			formatAmount(l.ContractAmount),
			discount,
			l.WinnerName,
			l.Status,
			formatDate(l.StartDate),
			formatDate(l.EndDate),
			l.PartnerLink,
		})
	}
	enc.Flush()
}

func formatAmount(v float64) string {
	if v == 0 {
		return ""
	}
	return fmt.Sprintf("%.2f", v)
}

func formatDate(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("02.01.2006")
}
