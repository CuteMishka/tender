package database

import (
	"log"
	"os"
	"strings"

	analyticsModels "github.com/dauren/tender/internal/analytics"
	"github.com/dauren/tender/internal/domain"
	"github.com/dauren/tender/internal/tenderplus"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// InitDB подключается к PostgreSQL и применяет миграции.
// DSN берётся из DATABASE_URL или LOCAL_DB_DSN; если не задана — используется дефолтное значение для Docker.
func InitDB() *gorm.DB {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("LOCAL_DB_DSN")
	}
	if dsn == "" {
		dsn = "host=localhost user=tender password=tender dbname=tender port=5433 sslmode=disable TimeZone=Asia/Almaty"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Ошибка подключения к базе данных: %v", err)
	}

	if err := db.AutoMigrate(&domain.User{}, &domain.RegistrationRequest{}, &domain.DictionaryItem{}, &tenderplus.SavedLot{}, &analyticsModels.HistoricalLot{}, &analyticsModels.TrackedCustomer{}); err != nil {
		log.Fatalf("Ошибка AutoMigrate: %v", err)
	}
	ensureAdminUser(db)

	log.Println("База данных подключена и мигрирована")
	return db
}

func ensureAdminUser(db *gorm.DB) {
	email := strings.TrimSpace(os.Getenv("ADMIN_EMAIL"))
	if email == "" {
		email = "admin@tender.local"
	}
	password := os.Getenv("ADMIN_PASSWORD")
	if password == "" {
		password = "admin"
	}
	var count int64
	if err := db.Model(&domain.User{}).Where("role = ?", "admin").Count(&count).Error; err != nil || count > 0 {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return
	}
	user := domain.User{
		Email:        strings.ToLower(email),
		PasswordHash: string(hash),
		Name:         "Администратор",
		Role:         "admin",
		Status:       "active",
	}
	_ = db.Create(&user).Error
}
