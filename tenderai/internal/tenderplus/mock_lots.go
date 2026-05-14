package tenderplus

import "time"

// MockActiveLots возвращает тестовые активные тендеры с актуальными датами.
func MockActiveLots() []Lot {
	now := time.Now()

	str := func(s string) *string { return &s }
	f64 := func(f float64) *float64 { return &f }
	ptr := func(n int) *int { return &n }
	date := func(t time.Time) *string { s := t.Format("2006-01-02T15:04:05"); return &s }

	active := &LotName{Name: str("Объявлен")}

	return []Lot{
		{
			ID:          90001,
			Lot:         str("1"),
			LotSourceID: str("KZ-2025-90001"),
			Title:       str("Поставка IaaS серверного оборудования для ЦОД"),
			Description: str("Закупка высокопроизводительных серверов для развертывания IaaS платформы. Требуется поставка, монтаж и ввод в эксплуатацию оборудования в соответствии с техническим заданием заказчика."),
			Cost:        f64(24500000),
			OneCost:     f64(8166666),
			Counts:      ptr(3),
			Region:      &LotName{Name: str("г. Алматы")},
			LotBuy: &LotBuy{
				BeginDate: date(now.AddDate(0, 0, -10)),
				EndDate:   date(now.AddDate(0, 0, 25)),
				LotStatus: active,
				Partner:   &LotName{Name: str("АО «KazakhTelecom»")},
			},
		},
		{
			ID:          90002,
			Lot:         str("1"),
			LotSourceID: str("KZ-2025-90002"),
			Title:       str("Аренда облачной IaaS инфраструктуры на 24 месяца"),
			Description: str("Аренда виртуальных серверов (IaaS) для размещения информационных систем государственного органа. SLA не менее 99.9%, резервное копирование, техническая поддержка 24/7."),
			Cost:        f64(18750000),
			OneCost:     f64(781250),
			Counts:      ptr(24),
			Region:      &LotName{Name: str("г. Астана")},
			LotBuy: &LotBuy{
				BeginDate: date(now.AddDate(0, 0, -5)),
				EndDate:   date(now.AddDate(0, 0, 18)),
				LotStatus: active,
				Partner:   &LotName{Name: str("ГКП «Astana IT»")},
			},
		},
		{
			ID:          90003,
			Lot:         str("1"),
			LotSourceID: str("KZ-2025-90003"),
			Title:       str("Хостинг и администрирование серверов"),
			Description: str("Предоставление услуг хостинга, размещение и администрирование серверного оборудования в дата-центре исполнителя. Наличие сертифицированного ЦОД уровня не ниже Tier III обязательно."),
			Cost:        f64(9200000),
			OneCost:     f64(9200000),
			Counts:      ptr(1),
			Region:      &LotName{Name: str("Карагандинская обл.")},
			LotBuy: &LotBuy{
				BeginDate: date(now.AddDate(0, 0, -3)),
				EndDate:   date(now.AddDate(0, 0, 35)),
				LotStatus: active,
				Partner:   &LotName{Name: str("ТОО «Digital Systems KZ»")},
			},
		},
		{
			ID:          90004,
			Lot:         str("1"),
			LotSourceID: str("KZ-2025-90004"),
			Title:       str("Поставка и настройка серверов для IaaS кластера высокой доступности"),
			Description: str("Поставка 10 серверов класса 2U, объединение в кластер высокой доступности, настройка системы управления IaaS. Включает обучение технического персонала заказчика (40 часов)."),
			Cost:        f64(42000000),
			OneCost:     f64(4200000),
			Counts:      ptr(10),
			Region:      &LotName{Name: str("г. Астана")},
			LotBuy: &LotBuy{
				BeginDate: date(now.AddDate(0, 0, -7)),
				EndDate:   date(now.AddDate(0, 0, 42)),
				LotStatus: active,
				Partner:   &LotName{Name: str("МИО Акимата г. Астана")},
			},
		},
		{
			ID:          90005,
			Lot:         str("1"),
			LotSourceID: str("KZ-2025-90005"),
			Title:       str("Техническое обслуживание серверного оборудования (ТО)"),
			Description: str("Ежегодный технический осмотр, диагностика и плановое обслуживание серверного парка заказчика. Замена расходных компонентов, обновление firmware, оптимизация производительности."),
			Cost:        f64(5600000),
			OneCost:     f64(5600000),
			Counts:      ptr(1),
			Region:      &LotName{Name: str("г. Алматы")},
			LotBuy: &LotBuy{
				BeginDate: date(now.AddDate(0, 0, -2)),
				EndDate:   date(now.AddDate(0, 0, 28)),
				LotStatus: active,
				Partner:   &LotName{Name: str("АО «НТЦ»")},
			},
		},
	}
}
