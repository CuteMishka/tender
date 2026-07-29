package api

import (
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestParserAIVisibilityFilterKeepsAllFeedIndependentFromAI(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  "host=localhost user=test dbname=test sslmode=disable",
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DryRun:               true,
		DisableAutomaticPing: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	allSQL := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyParserAIVisibilityFilter(tx.Model(&ParserLot{}), false).Find(&[]ParserLot{})
	})
	if strings.Contains(allSQL, "ai_score") || strings.Contains(allSQL, "local-llm") {
		t.Fatalf("all feed unexpectedly depends on AI scoring: %s", allSQL)
	}

	suitableSQL := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyParserAIVisibilityFilter(tx.Model(&ParserLot{}), true).Find(&[]ParserLot{})
	})
	for _, required := range []string{"ai_score", "is_suitable", "ai_passed"} {
		if !strings.Contains(suitableSQL, required) {
			t.Fatalf("suitable feed query is missing %q: %s", required, suitableSQL)
		}
	}
	if strings.Contains(suitableSQL, "local-llm") {
		t.Fatalf("suitable feed unexpectedly rejects valid non-local AI providers: %s", suitableSQL)
	}
}

func TestParserLotIsServiceCandidate(t *testing.T) {
	tests := []struct {
		name        string
		title       string
		subjectType string
		want        bool
	}{
		{name: "hard drive product", title: "Диск жесткий интерфейс SATA", subjectType: "Товар", want: false},
		{name: "scanner product", title: "Сканер лазерный, двухлучевой", subjectType: "Товар", want: false},
		{name: "computer product", title: "Компьютер офисный", subjectType: "Товар", want: false},
		{name: "ups product", title: "Источник бесперебойного питания резервный", subjectType: "Товар", want: false},
		{name: "metal lathe product", title: "Станок для обработки металла токарный", subjectType: "Товар", want: false},
		{name: "dlp projector product", title: "Видеопроектор DLP-проектор", subjectType: "Товар", want: false},
		{name: "dlp projector without subject type", title: "Видеопроектор DLP-проектор", subjectType: "", want: false},
		{name: "bare server without service type", title: "Сервер", subjectType: "", want: false},
		{name: "ssl certificate service", title: "Услуги по предоставлению SSL сертификата для домена", subjectType: "Услуга", want: false},
		{name: "generic information access service", title: "Услуги по предоставлению доступа к информационным ресурсам", subjectType: "Услуга", want: false},
		{name: "document processing educational infosec noise", title: "Услуги по научно-технической обработке документов по экспертизе образовательных программ по специальности Системы информационной безопасности", subjectType: "Услуга", want: false},
		{name: "infosec service", title: "Услуги по обеспечению информационной безопасности", subjectType: "Услуга", want: true},
		{name: "penetration testing service", title: "Услуги по тестированию на проникновение информационных систем", subjectType: "Услуга", want: true},
		{name: "vps service", title: "Услуги по аренде виртуального выделенного сервера (VPS)", subjectType: "Услуга", want: true},
		{name: "colocation service", title: "Услуги по предоставлению системы хранения данных и co-location", subjectType: "Услуга", want: true},
		{name: "hosting without subject type", title: "Предоставление вычислительных мощностей (хостинг)", subjectType: "", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]interface{}{"subject_type": tt.subjectType})
			if err != nil {
				t.Fatal(err)
			}
			row := ParserLot{Title: tt.title, Raw: raw}
			if got := parserLotIsServiceCandidate(row); got != tt.want {
				t.Fatalf("parserLotIsServiceCandidate() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParserLotToListDTOPreservesCompanyFields(t *testing.T) {
	customer := "АО Тестовый заказчик"
	organizer := "Организатор тендера"
	purchaseType := "Открытый конкурс"
	row := ParserLot{
		ID:            42,
		StableID:      "tenderplus:42",
		Source:        "tenderplus",
		ExternalID:    "42",
		Title:         "Услуги облачного сервиса",
		CustomerName:  &customer,
		OrganizerName: &organizer,
		PurchaseType:  &purchaseType,
	}

	dto := parserLotToListDTO(row)
	if dto.CustomerName == nil || *dto.CustomerName != customer {
		t.Fatalf("CustomerName = %#v, want %q", dto.CustomerName, customer)
	}
	if dto.OrganizerName == nil || *dto.OrganizerName != organizer {
		t.Fatalf("OrganizerName = %#v, want %q", dto.OrganizerName, organizer)
	}
	if dto.PurchaseType == nil || *dto.PurchaseType != purchaseType {
		t.Fatalf("PurchaseType = %#v, want %q", dto.PurchaseType, purchaseType)
	}
}
