package analytics

import (
	"log"
	"time"

	"gorm.io/gorm"
)

// SeedHistoricalDemoData заполняет БД демо-тендерами (активные + исторические),
// если таблица historical_lots пустая.
func SeedHistoricalDemoData(db *gorm.DB) {
	var count int64
	db.Model(&HistoricalLot{}).Count(&count)
	if count > 0 {
		return
	}

	now := time.Now()
	pt := func(t time.Time) *time.Time { return &t }

	lots := []HistoricalLot{
		{LotID: 91001, Title: "Аренда облачной IaaS инфраструктуры для eGov", Description: "Виртуальные серверы, резервное копирование, мониторинг 24/7", InitialAmount: 18500000, Status: "active", CustomerName: "АО Национальные информационные технологии", CustomerID: "000140000001", OrganizerName: "АО НИТ", Region: "Астана", PurchaseType: "Открытый конкурс", StartDate: pt(now.AddDate(0, 0, -1)), EndDate: pt(now.AddDate(0, 0, 14)), PartnerLink: "https://example.local/tenders/91001", LotSource: "demo-active"},
		{LotID: 91002, Title: "Поставка серверов и СХД для резервного ЦОДа", Description: "Серверное оборудование, дисковые массивы, монтаж и пусконаладка", InitialAmount: 42700000, Status: "active", CustomerName: "ТОО Smart City Almaty", CustomerID: "990240000002", OrganizerName: "ТОО Smart City Almaty", Region: "Алматы", PurchaseType: "Запрос ценовых предложений", StartDate: pt(now.AddDate(0, 0, -2)), EndDate: pt(now.AddDate(0, 0, 6)), PartnerLink: "https://example.local/tenders/91002", LotSource: "demo-active"},
		{LotID: 91003, Title: "Техническая поддержка корпоративной виртуализации", Description: "Поддержка VMware/Proxmox, SLA, реагирование на инциденты", InitialAmount: 9600000, Status: "active", CustomerName: "ГУ Управление цифровизации Астаны", CustomerID: "120340000003", OrganizerName: "ГУ Управление цифровизации Астаны", Region: "Астана", PurchaseType: "Открытый конкурс", StartDate: pt(now.AddDate(0, 0, -3)), EndDate: pt(now.AddDate(0, 0, 3)), PartnerLink: "https://example.local/tenders/91003", LotSource: "demo-active"},
		{LotID: 90001, Title: "Модернизация сетевой инфраструктуры", Description: "Коммутаторы, маршрутизаторы, настройка защищенных каналов", InitialAmount: 21200000, ContractAmount: 19800000, Status: "completed", CustomerName: "АО Национальные информационные технологии", CustomerID: "000140000001", OrganizerName: "АО НИТ", Region: "Астана", PurchaseType: "Открытый конкурс", WinnerName: "ТОО Cloud Integrator", WinnerID: "880140000100", StartDate: pt(now.AddDate(0, -3, 0)), EndDate: pt(now.AddDate(0, -2, 0)), PartnerLink: "https://example.local/tenders/90001", LotSource: "demo-history"},
		{LotID: 90002, Title: "Закупка услуг резервного копирования", Description: "Backup-as-a-Service, хранение копий, ежемесячные отчёты", InitialAmount: 7800000, ContractAmount: 7200000, Status: "completed", CustomerName: "ТОО Smart City Almaty", CustomerID: "990240000002", OrganizerName: "ТОО Smart City Almaty", Region: "Алматы", PurchaseType: "Из одного источника", WinnerName: "ТОО Freedom Cloud", WinnerID: "771140000200", StartDate: pt(now.AddDate(0, -2, -10)), EndDate: pt(now.AddDate(0, -1, -15)), PartnerLink: "https://example.local/tenders/90002", LotSource: "demo-history"},
	}

	if err := db.Create(&lots).Error; err != nil {
		log.Printf("Ошибка при добавлении demo-истории тендеров: %v", err)
	} else {
		log.Println("Успешно добавлены demo активные и исторические тендеры!")
	}
}
