package database

import (
	"log"
	"os"
	"strings"
	"unicode"

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

	if err := db.AutoMigrate(&domain.User{}, &domain.RegistrationRequest{}, &domain.DictionaryItem{}, &domain.ParserRunRequest{}, &domain.TelegramSettings{}, &domain.UserTelegramBinding{}, &tenderplus.SavedLot{}, &tenderplus.TenderActivity{}, &tenderplus.TenderComment{}, &tenderplus.TenderTask{}, &analyticsModels.HistoricalLot{}, &analyticsModels.TrackedCustomer{}); err != nil {
		log.Fatalf("Ошибка AutoMigrate: %v", err)
	}
	ensureParserRuntimeSchema(db)
	ensureAdminUser(db)

	log.Println("База данных подключена и мигрирована")
	return db
}

func ensureParserRuntimeSchema(db *gorm.DB) {
	statements := []string{
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS complaints_count integer`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS winner_bin varchar(32)`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS winner_name text`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS is_suitable boolean`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS matched_keyword text`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS match_score numeric(6,4)`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS ai_score integer`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS ai_status varchar(64)`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS ai_provider varchar(64)`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS documents_fingerprint varchar(64)`,
		`ALTER TABLE IF EXISTS parser_lots ADD COLUMN IF NOT EXISTS raw jsonb`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS kind varchar(64) DEFAULT 'document' NOT NULL`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS content_type varchar(255)`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS sha256 varchar(64)`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS text_chars integer`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS rag_indexed boolean DEFAULT false NOT NULL`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL`,
		`ALTER TABLE IF EXISTS parser_documents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL`,
		`DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = current_schema()
					AND table_name = 'parser_lots'
					AND column_name = 'raw'
					AND udt_name <> 'jsonb'
			) THEN
				ALTER TABLE parser_lots ALTER COLUMN raw TYPE jsonb USING raw::jsonb;
			END IF;
		END $$;`,
	}
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			log.Printf("parser schema compatibility migration skipped: %v", err)
		}
	}
}

func ensureAdminUser(db *gorm.DB) {
	email := strings.TrimSpace(os.Getenv("ADMIN_EMAIL"))
	if email == "" {
		email = "admin@tender.local"
	}
	var count int64
	if err := db.Model(&domain.User{}).Where("role = ?", "admin").Count(&count).Error; err != nil || count > 0 {
		return
	}
	password := os.Getenv("ADMIN_PASSWORD")
	if password == "" {
		log.Print("ADMIN_PASSWORD is empty; default admin user was not created")
		return
	}
	if !isStrongAdminPassword(password) {
		log.Print("ADMIN_PASSWORD is too weak; default admin user was not created")
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

func isStrongAdminPassword(password string) bool {
	var hasUpper, hasLower, hasDigit, hasSymbol bool
	if len([]rune(password)) < 12 {
		return false
	}
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		default:
			hasSymbol = true
		}
	}
	return hasUpper && hasLower && hasDigit && hasSymbol
}
