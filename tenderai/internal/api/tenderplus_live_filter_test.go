package api

import (
	"testing"

	"github.com/dauren/tender/internal/tenderplus"
)

func TestTenderPlusLotPassesDictionaryFilter(t *testing.T) {
	keywords := []string{
		"VPS",
		"co-location",
		"VMware",
		"Backup",
		"VDC",
		"DLP",
		"информационная безопасность",
	}
	stopWords := []string{
		"катетер",
		"лицензия",
		"поддержка",
		"приобретение",
		"диски",
	}

	tests := []struct {
		name string
		lot  tenderplus.Lot
		want bool
	}{
		{
			name: "vps service",
			lot: tenderplus.Lot{
				Title:       strPtr("Услуги по аренде виртуального выделенного сервера (VPS)"),
				Description: strPtr("Услуги по предоставлению серверных мощностей ЦОД"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Услуга"),
				},
				Enstru: &tenderplus.LotEnstru{
					Title: strPtr("Услуги по аренде виртуального выделенного сервера (VPS)"),
				},
			},
			want: true,
		},
		{
			name: "co-location service",
			lot: tenderplus.Lot{
				Title:       strPtr("Услуги по предоставлению системы хранения данных и co-location"),
				Description: strPtr("Услуги по аренде стойко-мест"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Услуга"),
				},
			},
			want: true,
		},
		{
			name: "dlp projector is noise",
			lot: tenderplus.Lot{
				Title:       strPtr("Видеопроектор DLP-проектор"),
				Description: strPtr("Поставка проектора для актового зала"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Товар"),
				},
			},
			want: false,
		},
		{
			name: "dlp projector without subject type is noise",
			lot: tenderplus.Lot{
				Title:       strPtr("Видеопроектор DLP-проектор"),
				Description: strPtr("Поставка проектора для актового зала"),
			},
			want: false,
		},
		{
			name: "document processing educational infosec noise",
			lot: tenderplus.Lot{
				Title:       strPtr("Услуги по научно-технической обработке документов"),
				Description: strPtr("Экспертиза образовательных программ по специальности Системы информационной безопасности"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Услуга"),
				},
			},
			want: false,
		},
		{
			name: "vdc voltage goods",
			lot: tenderplus.Lot{
				Title:       strPtr("Оборудование системы пожарной сигнализации"),
				Description: strPtr("Напряжение питания: 24 VDC"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Товар"),
				},
				Enstru: &tenderplus.LotEnstru{
					Title: strPtr("Оборудование системы пожарной сигнализации"),
				},
			},
			want: false,
		},
		{
			name: "vmware license support",
			lot: tenderplus.Lot{
				Title:       strPtr("Услуги по технической поддержке лицензионного программного обеспечения"),
				Description: strPtr("Продление технической поддержки программы виртуализации VMware"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Услуга"),
				},
			},
			want: false,
		},
		{
			name: "backup medical item",
			lot: tenderplus.Lot{
				Title:       strPtr("Катетер проводниковый с кончиком МР"),
				Description: strPtr("Backup документ к медицинскому изделию"),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Услуга"),
				},
			},
			want: false,
		},
		{
			name: "medical item with storage phrase",
			lot: tenderplus.Lot{
				Title:       strPtr("3/7/12-канальный регистратор из комплекта электрокардиограф"),
				Description: strPtr("Медицинское изделие для пациента. Хранение данных - внутренняя память."),
				SubjectType: &tenderplus.LotName{
					Name: strPtr("Услуга"),
				},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tenderPlusLotPassesDictionaryFilter(tt.lot, keywords, stopWords)
			if got != tt.want {
				t.Fatalf("tenderPlusLotPassesDictionaryFilter() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestContainsExcludedTenderTermKeepsProfileExceptions(t *testing.T) {
	tests := []struct {
		name      string
		text      string
		stopWords []string
		want      bool
	}{
		{
			name:      "plain audit is excluded",
			text:      "Услуги по аудиту финансовой отчетности",
			stopWords: []string{"аудит"},
			want:      true,
		},
		{
			name:      "security audit is kept",
			text:      "Услуги по аудиту безопасности информационных систем",
			stopWords: []string{"аудит"},
			want:      false,
		},
		{
			name:      "penetration testing is kept",
			text:      "Услуги по тестированию на проникновение информационных систем",
			stopWords: []string{"тестирование"},
			want:      false,
		},
		{
			name:      "plain license is excluded",
			text:      "Поставка лицензий офисного программного обеспечения",
			stopWords: []string{"лицензия"},
			want:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := containsExcludedTenderTerm(normalizeSearchText(tt.text), tt.stopWords)
			if got != tt.want {
				t.Fatalf("containsExcludedTenderTerm() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTenderPlusAPIQueryKeywordsKeepsUsefulDictionaryTerms(t *testing.T) {
	keywords := []string{
		"VPS",
		"Облачные услуги",
		"Центр обработки данных",
		"Резервное копирование",
		"DC",
		"KVM",
		"сервер",
		"MDR",
	}

	got := tenderPlusAPIQueryKeywords(keywords, "dictionary")
	wantPresent := []string{"VPS", "Облачные услуги", "Центр обработки данных", "Резервное копирование"}
	for _, want := range wantPresent {
		if !containsString(got, want) {
			t.Fatalf("tenderPlusAPIQueryKeywords() missing %q in %#v", want, got)
		}
	}
	for _, noisy := range []string{"DC", "KVM", "сервер", "MDR"} {
		if containsString(got, noisy) {
			t.Fatalf("tenderPlusAPIQueryKeywords() kept noisy keyword %q in %#v", noisy, got)
		}
	}
}

func TestTenderPlusLotToDTOUsesOrganizationAsCompany(t *testing.T) {
	fullName := "АКЦИОНЕРНОЕ ОБЩЕСТВО \"ТЕСТОВЫЙ ЗАКАЗЧИК\""
	lot := tenderplus.Lot{
		ID:    1,
		Title: strPtr("Услуги облачного сервиса"),
		LotBuy: &tenderplus.LotBuy{
			Organizer: strPtr("Fallback organizer"),
			Partner:   &tenderplus.LotName{Name: strPtr("TenderPlus API")},
			Organization: &tenderplus.Organization{
				ShortName: strPtr(fullName),
				BinIIN:    strPtr("123456789012"),
			},
			TenderTypePartner: &tenderplus.LotName{Name: strPtr("Открытый конкурс")},
		},
	}

	dto := tenderPlusLotToDTO(lot)
	if dto.CustomerName == nil || *dto.CustomerName != fullName {
		t.Fatalf("CustomerName = %#v, want full organization name", dto.CustomerName)
	}
	if dto.OrganizerName == nil || *dto.OrganizerName != fullName {
		t.Fatalf("OrganizerName = %#v, want full organization name", dto.OrganizerName)
	}
	if dto.PurchaseType == nil || *dto.PurchaseType != "Открытый конкурс" {
		t.Fatalf("PurchaseType = %#v, want tenderTypePartner name", dto.PurchaseType)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
