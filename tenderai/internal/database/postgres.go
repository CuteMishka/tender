package database

import (
	"log"
	"os"

	analyticsModels "github.com/dauren/tender/internal/analytics"
	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/tenderplus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// InitDB подключается к PostgreSQL и применяет миграции.
// DSN берётся из переменной окружения LOCAL_DB_DSN; если не задана — используется дефолтное значение для Docker.
func InitDB() *gorm.DB {
	dsn := os.Getenv("LOCAL_DB_DSN")
	if dsn == "" {
		dsn = "host=localhost user=tender password=tender dbname=tender port=5433 sslmode=disable TimeZone=Asia/Almaty"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Ошибка подключения к базе данных: %v", err)
	}

	if err := db.AutoMigrate(&domain.User{}, &tenderplus.SavedLot{}, &analyticsModels.HistoricalLot{}, &analyticsModels.TrackedCustomer{}); err != nil {
		log.Fatalf("Ошибка AutoMigrate: %v", err)
	}

	log.Println("База данных подключена и мигрирована")
	return db
}
