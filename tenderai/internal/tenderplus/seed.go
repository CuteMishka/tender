package tenderplus

import (
	"log"
	"time"

	"gorm.io/gorm"
)

// SeedTestData заполняет БД тестовыми лотами для Дашборда
func SeedTestData(db *gorm.DB) {
	var count int64
	db.Model(&SavedLot{}).Count(&count)
	now := time.Now()
	if count == 0 {
		dummyLots := []SavedLot{
			{ID: 3901, Title: "Поставка IaaS серверов для дата-центра", Amount: 12450000, Status: "active", Deadline: now.AddDate(0, 0, 5), PurchaseType: "Открытый конкурс"},
			{ID: 3902, Title: "Аренда IaaS инфраструктуры на 12 месяцев", Amount: 8050000, Status: "participating", Deadline: now.AddDate(0, 0, 2), PurchaseType: "Из одного источника"},
			{ID: 3903, Title: "Развертывание отказоустойчивого IaaS кластера", Amount: 15200000, Status: "active", Deadline: now.AddDate(0, 0, 1), PurchaseType: "Запрос ценовых предложений"},
			{ID: 3904, Title: "Поставка серверных стоек под IaaS", Amount: 9800000, Status: "rejected", Deadline: now.AddDate(0, 0, -5), PurchaseType: "Открытый конкурс"},
			{ID: 3905, Title: "Техподдержка IaaS платформы 24/7", Amount: 6720000, Status: "participating", Deadline: now.AddDate(0, 0, 10), PurchaseType: "Открытый конкурс"},
		}

		if err := db.Create(&dummyLots).Error; err != nil {
			log.Printf("Ошибка при добавлении тестовых данных: %v", err)
		} else {
			log.Println("Успешно добавлены тестовые данные для дашборда!")
		}
	}
}
